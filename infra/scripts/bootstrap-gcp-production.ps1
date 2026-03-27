param(
  [string]$PrimaryProjectId = "mollie-prod",
  [string]$FallbackProjectId = "mollie-prod-20260326",
  [string]$ProjectName = "Mollie Production",
  [string]$Region = "us-central1",
  [string]$ArtifactRepository = "reselleros",
  [string]$Domain = "mollie.biz",
  [string]$ApiDomain = "api.mollie.biz",
  [string]$SqlInstanceName = "reselleros",
  [string]$DatabaseName = "reselleros",
  [string]$DatabaseUser = "reselleros",
  [string]$RedisInstanceName = "reselleros",
  [string]$VpcConnectorName = "reselleros-serverless",
  [string]$VpcConnectorRange = "10.8.0.0/28",
  [string]$Network = "default",
  [string]$ImageTag = "prod",
  [string]$BillingAccountId,
  [switch]$SkipDeploy,
  [switch]$SkipDomainMappings
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repoRoot

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Resolve-PythonForGcloud() {
  if ($env:CLOUDSDK_PYTHON) {
    return $env:CLOUDSDK_PYTHON
  }

  $candidates = @(
    "C:\Users\john_\AppData\Local\Python\bin\python.exe",
    "python.exe",
    "py.exe"
  )

  foreach ($candidate in $candidates) {
    try {
      if ($candidate -like "*.exe" -and $candidate.Contains("\")) {
        if (Test-Path $candidate) {
          return $candidate
        }
      } else {
        $null = & $candidate --version 2>$null
        if ($LASTEXITCODE -eq 0) {
          return $candidate
        }
      }
    } catch {
    }
  }

  throw "Could not find a Python executable for gcloud. Set CLOUDSDK_PYTHON first."
}

$env:CLOUDSDK_PYTHON = Resolve-PythonForGcloud

function Invoke-Gcloud {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [object[]]$Args
  )

  $flatArgs = @()
  foreach ($arg in $Args) {
    if ($arg -is [System.Array]) {
      $flatArgs += $arg
    } else {
      $flatArgs += [string]$arg
    }
  }

  & gcloud.cmd @flatArgs

  if ($LASTEXITCODE -ne 0) {
    throw "gcloud command failed: gcloud $($flatArgs -join ' ')"
  }
}

function Try-GcloudJson {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [object[]]$Args
  )

  try {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $flatArgs = @()
    foreach ($arg in $Args) {
      if ($arg -is [System.Array]) {
        $flatArgs += $arg
      } else {
        $flatArgs += [string]$arg
      }
    }

    $output = & gcloud.cmd @flatArgs 2>$null

    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($output)) {
      return $null
    }

    return $output | ConvertFrom-Json
  } catch {
    return $null
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

function Test-GcloudSuccess {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [object[]]$Args
  )

  $flatArgs = @()
  foreach ($arg in $Args) {
    if ($arg -is [System.Array]) {
      $flatArgs += $arg
    } else {
      $flatArgs += [string]$arg
    }
  }

  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  try {
    & gcloud.cmd @flatArgs *> $null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

function Get-OpenBillingAccountId() {
  if ($BillingAccountId) {
    return $BillingAccountId
  }

  $accountName = (& gcloud.cmd billing accounts list --format="value(name)" --filter="open=true" |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ }) |
    Select-Object -First 1

  if (-not $accountName) {
    throw "No open billing account was found for the active gcloud identity."
  }

  return ($accountName -replace "^billingAccounts/", "")
}

function Ensure-Project([string]$PreferredId, [string]$FallbackId, [string]$DisplayName) {
  $existingProjects = & gcloud.cmd projects list --format="value(projectId)"

  if ($existingProjects -contains $PreferredId) {
    return $PreferredId
  }

  if ($existingProjects -contains $FallbackId) {
    return $FallbackId
  }

  & gcloud.cmd projects create $PreferredId --name $DisplayName

  if ($LASTEXITCODE -eq 0) {
    return $PreferredId
  }

  & gcloud.cmd projects create $FallbackId --name $DisplayName

  if ($LASTEXITCODE -eq 0) {
    return $FallbackId
  }

  throw "Could not create project '$PreferredId' or fallback '$FallbackId'."
}

function Ensure-ServiceEnabled([string]$ProjectId, [string[]]$Services) {
  Invoke-Gcloud services enable @Services --project $ProjectId
}

function Ensure-ServiceAccount([string]$ProjectId, [string]$Name, [string]$DisplayName) {
  $email = "$Name@$ProjectId.iam.gserviceaccount.com"

  if (-not (Test-GcloudSuccess "iam", "service-accounts", "describe", $email, "--project", $ProjectId)) {
    Invoke-Gcloud iam service-accounts create $Name --display-name $DisplayName --project $ProjectId
  }

  return $email
}

function Ensure-ProjectIamBinding([string]$ProjectId, [string]$Member, [string]$Role) {
  Invoke-Gcloud projects add-iam-policy-binding $ProjectId --member $Member --role $Role --quiet
}

function Ensure-ArtifactRegistry([string]$ProjectId, [string]$Region, [string]$Repository) {
  if (-not (Test-GcloudSuccess "artifacts", "repositories", "describe", $Repository, "--location", $Region, "--project", $ProjectId)) {
    Invoke-Gcloud artifacts repositories create $Repository --repository-format docker --location $Region --project $ProjectId
  }
}

function Ensure-Bucket([string]$ProjectId, [string]$BucketName, [string]$Location) {
  if (-not (Test-GcloudSuccess "storage", "buckets", "describe", "gs://$BucketName", "--project", $ProjectId)) {
    Invoke-Gcloud storage buckets create "gs://$BucketName" --location $Location --uniform-bucket-level-access --project $ProjectId
  }
}

function Ensure-BucketIamBinding([string]$BucketName, [string]$Member, [string]$Role) {
  Invoke-Gcloud storage buckets add-iam-policy-binding "gs://$BucketName" --member $Member --role $Role
}

function Ensure-CloudSql([string]$ProjectId, [string]$Region, [string]$InstanceName) {
  if (-not (Test-GcloudSuccess "sql", "instances", "describe", $InstanceName, "--project", $ProjectId)) {
    Invoke-Gcloud sql instances create $InstanceName `
      --project $ProjectId `
      --database-version POSTGRES_15 `
      --tier db-custom-1-3840 `
      --region $Region `
      --availability-type zonal `
      --storage-size 20 `
      --backup-start-time 03:00
  }

  $instance = Try-GcloudJson "sql", "instances", "describe", $InstanceName, "--project", $ProjectId, "--format=json"

  if (-not $instance) {
    throw "Could not describe Cloud SQL instance '$InstanceName'."
  }

  return $instance
}

function Ensure-CloudSqlDatabase([string]$ProjectId, [string]$InstanceName, [string]$DatabaseName) {
  if (-not (Test-GcloudSuccess "sql", "databases", "describe", $DatabaseName, "--instance", $InstanceName, "--project", $ProjectId)) {
    Invoke-Gcloud sql databases create $DatabaseName --instance $InstanceName --project $ProjectId
  }
}

function Ensure-CloudSqlUser([string]$ProjectId, [string]$InstanceName, [string]$DatabaseUser, [string]$Password) {
  if (Test-GcloudSuccess "sql", "users", "describe", $DatabaseUser, "--instance", $InstanceName, "--project", $ProjectId) {
    Invoke-Gcloud sql users set-password $DatabaseUser --instance $InstanceName --password $Password --project $ProjectId
    return
  }

  Invoke-Gcloud sql users create $DatabaseUser --instance $InstanceName --password $Password --project $ProjectId
}

function Ensure-VpcConnector([string]$ProjectId, [string]$Region, [string]$ConnectorName, [string]$Network, [string]$Range) {
  if (-not (Test-GcloudSuccess "compute", "networks", "vpc-access", "connectors", "describe", $ConnectorName, "--region", $Region, "--project", $ProjectId)) {
    Invoke-Gcloud compute networks vpc-access connectors create $ConnectorName `
      --region $Region `
      --project $ProjectId `
      --network $Network `
      --range $Range `
      --min-instances 2 `
      --max-instances 3
  }
}

function Ensure-Redis([string]$ProjectId, [string]$Region, [string]$InstanceName, [string]$Network) {
  if (-not (Test-GcloudSuccess "redis", "instances", "describe", $InstanceName, "--region", $Region, "--project", $ProjectId)) {
    Invoke-Gcloud redis instances create $InstanceName `
      --region $Region `
      --project $ProjectId `
      --size 1 `
      --tier basic `
      --redis-version redis_7_2 `
      --network $Network
  }

  $instance = Try-GcloudJson "redis", "instances", "describe", $InstanceName, "--region", $Region, "--project", $ProjectId, "--format=json"

  if (-not $instance) {
    throw "Could not describe Redis instance '$InstanceName'."
  }

  return $instance
}

function Read-DotEnv([string]$PathValue) {
  $map = @{}

  if (-not (Test-Path $PathValue)) {
    return $map
  }

  foreach ($line in Get-Content $PathValue) {
    $trimmed = $line.Trim()

    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }

    $parts = $trimmed -split "=", 2

    if ($parts.Count -eq 2) {
      $map[$parts[0]] = $parts[1]
    }
  }

  return $map
}

function Ensure-SecretAndVersion([string]$ProjectId, [string]$SecretName, [string]$Value) {
  if (-not (Test-GcloudSuccess "secrets", "describe", $SecretName, "--project", $ProjectId)) {
    Invoke-Gcloud secrets create $SecretName --replication-policy automatic --project $ProjectId
  }

  $tempFile = [System.IO.Path]::GetTempFileName()
  try {
    [System.IO.File]::WriteAllText($tempFile, $Value)
    Invoke-Gcloud secrets versions add $SecretName --data-file $tempFile --project $ProjectId
  } finally {
    Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
  }
}

function Get-ObjectPropertyValue([object]$InputObject, [string]$PropertyName) {
  if ($null -eq $InputObject) {
    return $null
  }

  if ($InputObject -is [System.Collections.IDictionary]) {
    if ($InputObject.Contains($PropertyName)) {
      return $InputObject[$PropertyName]
    }

    return $null
  }

  $property = $InputObject.PSObject.Properties[$PropertyName]
  if ($property) {
    return $property.Value
  }

  return $null
}

function Get-RequiredObjectPropertyValue([object]$InputObject, [string]$PropertyName, [string]$Context) {
  $value = Get-ObjectPropertyValue $InputObject $PropertyName
  if ([string]::IsNullOrWhiteSpace([string]$value)) {
    throw "$Context is missing required property '$PropertyName'."
  }

  return [string]$value
}

function ConvertTo-UrlEncoded([string]$Value) {
  return [System.Uri]::EscapeDataString($Value)
}

function Write-YamlFile([string]$PathValue, [hashtable]$Entries) {
  $lines = foreach ($key in $Entries.Keys) {
    $value = [string]$Entries[$key]
    $escapedValue = $value.Replace('"', '\"')
    "${key}: ""$escapedValue"""
  }

  Set-Content -LiteralPath $PathValue -Value ($lines -join [Environment]::NewLine)
}

function Write-LinesFile([string]$PathValue, [string[]]$Lines) {
  Set-Content -LiteralPath $PathValue -Value ($Lines -join [Environment]::NewLine)
}

function Get-RunToken() {
  return (& gcloud.cmd auth print-access-token).Trim()
}

function Ensure-DomainMapping([string]$ProjectId, [string]$Region, [string]$DomainName, [string]$ServiceName) {
  $token = Get-RunToken
  $baseUri = "https://run.googleapis.com/apis/domains.cloudrun.com/v1/namespaces/$ProjectId/domainmappings/$DomainName"
  $headers = @{
    Authorization = "Bearer $token"
    "Content-Type" = "application/json"
  }

  $existing = $null
  try {
    $existing = Invoke-RestMethod -Method Get -Uri $baseUri -Headers $headers
  } catch {
    $existing = $null
  }

  if (-not $existing) {
    $body = @{
      apiVersion = "domains.cloudrun.com/v1"
      kind = "DomainMapping"
      metadata = @{
        name = $DomainName
        namespace = $ProjectId
      }
      spec = @{
        routeName = $ServiceName
      }
    } | ConvertTo-Json -Depth 6

    Invoke-RestMethod -Method Post -Uri "https://run.googleapis.com/apis/domains.cloudrun.com/v1/namespaces/$ProjectId/domainmappings" -Headers $headers -Body $body | Out-Null
  }

  return Invoke-RestMethod -Method Get -Uri $baseUri -Headers $headers
}

$projectId = $null
$billingId = $null
$runtimeDir = Join-Path $repoRoot "tmp\gcp-production"
$dotEnv = Read-DotEnv (Join-Path $repoRoot ".env")

Write-Step "Checking gcloud account"
$activeAccount = (& gcloud.cmd auth list --filter=status:ACTIVE --format="value(account)").Trim()
if ($activeAccount -ne "admin@terapixel.games") {
  throw "Active gcloud account is '$activeAccount'. Re-auth or switch to admin@terapixel.games first."
}

Write-Step "Selecting billing account"
$billingId = Get-OpenBillingAccountId
Write-Host "Using billing account $billingId"

Write-Step "Creating or selecting project"
$projectId = Ensure-Project $PrimaryProjectId $FallbackProjectId $ProjectName
Write-Host "Using project $projectId"
Invoke-Gcloud billing projects link $projectId --billing-account $billingId

Write-Step "Enabling required services"
Ensure-ServiceEnabled $projectId @(
  "run.googleapis.com",
  "cloudbuild.googleapis.com",
  "artifactregistry.googleapis.com",
  "secretmanager.googleapis.com",
  "sqladmin.googleapis.com",
  "compute.googleapis.com",
  "vpcaccess.googleapis.com",
  "redis.googleapis.com",
  "cloudscheduler.googleapis.com",
  "iam.googleapis.com",
  "servicenetworking.googleapis.com",
  "storage.googleapis.com"
)

$uploadsBucket = "$projectId-uploads"
$artifactsBucket = "$projectId-artifacts"
$sqlPassword = [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N").Substring(0, 8)

Write-Step "Creating runtime service accounts"
$serviceAccounts = @{
  web = Ensure-ServiceAccount $projectId "reselleros-web" "ResellerOS Web"
  api = Ensure-ServiceAccount $projectId "reselleros-api" "ResellerOS API"
  worker = Ensure-ServiceAccount $projectId "reselleros-worker" "ResellerOS Worker"
  connector = Ensure-ServiceAccount $projectId "reselleros-connector" "ResellerOS Connector"
  jobs = Ensure-ServiceAccount $projectId "reselleros-jobs" "ResellerOS Jobs"
}

Write-Step "Creating Artifact Registry"
Ensure-ArtifactRegistry $projectId $Region $ArtifactRepository

Write-Step "Creating storage buckets"
Ensure-Bucket $projectId $uploadsBucket $Region
Ensure-Bucket $projectId $artifactsBucket $Region
Ensure-BucketIamBinding $uploadsBucket "serviceAccount:$($serviceAccounts.api)" "roles/storage.objectAdmin"
Ensure-BucketIamBinding $artifactsBucket "serviceAccount:$($serviceAccounts.connector)" "roles/storage.objectAdmin"

Write-Step "Creating Cloud SQL"
$sqlInstance = Ensure-CloudSql $projectId $Region $SqlInstanceName
Ensure-CloudSqlDatabase $projectId $SqlInstanceName $DatabaseName
Ensure-CloudSqlUser $projectId $SqlInstanceName $DatabaseUser $sqlPassword
$cloudSqlInstanceConnection = Get-RequiredObjectPropertyValue $sqlInstance "connectionName" "Cloud SQL instance '$SqlInstanceName'"

Write-Step "Creating VPC connector"
Ensure-VpcConnector $projectId $Region $VpcConnectorName $Network $VpcConnectorRange
$vpcConnectorResource = "projects/$projectId/locations/$Region/connectors/$VpcConnectorName"

Write-Step "Creating Memorystore Redis"
$redis = Ensure-Redis $projectId $Region $RedisInstanceName $Network
$redisHost = Get-RequiredObjectPropertyValue $redis "host" "Redis instance '$RedisInstanceName'"
$redisPortValue = Get-ObjectPropertyValue $redis "port"
$redisPort = if ($redisPortValue) { [string]$redisPortValue } else { "6379" }

$encodedPassword = ConvertTo-UrlEncoded $sqlPassword
$databaseUrl = "postgresql://${DatabaseUser}:$encodedPassword@localhost:5432/${DatabaseName}?host=/cloudsql/$cloudSqlInstanceConnection"
$directUrl = $databaseUrl
$redisUrl = "redis://${redisHost}:$redisPort"
$apiBaseUrl = "https://$ApiDomain"
$appBaseUrl = "https://$Domain"
$uploadsPublicBaseUrl = $apiBaseUrl
$hasOpenAiKey = $dotEnv.ContainsKey("OPENAI_API_KEY") -and -not [string]::IsNullOrWhiteSpace($dotEnv["OPENAI_API_KEY"])
$hasStripeSecret = $dotEnv.ContainsKey("STRIPE_SECRET_KEY") -and -not [string]::IsNullOrWhiteSpace($dotEnv["STRIPE_SECRET_KEY"])
$hasStripeWebhook = $dotEnv.ContainsKey("STRIPE_WEBHOOK_SECRET") -and -not [string]::IsNullOrWhiteSpace($dotEnv["STRIPE_WEBHOOK_SECRET"])
$hasEbayClientId = $dotEnv.ContainsKey("EBAY_CLIENT_ID") -and -not [string]::IsNullOrWhiteSpace($dotEnv["EBAY_CLIENT_ID"])
$hasEbayClientSecret = $dotEnv.ContainsKey("EBAY_CLIENT_SECRET") -and -not [string]::IsNullOrWhiteSpace($dotEnv["EBAY_CLIENT_SECRET"])
$ebayConfigured = $hasEbayClientId -and $hasEbayClientSecret

Write-Step "Granting project roles"
foreach ($serviceAccountEmail in @($serviceAccounts.api, $serviceAccounts.worker, $serviceAccounts.connector, $serviceAccounts.jobs)) {
  Ensure-ProjectIamBinding $projectId "serviceAccount:$serviceAccountEmail" "roles/secretmanager.secretAccessor"
  Ensure-ProjectIamBinding $projectId "serviceAccount:$serviceAccountEmail" "roles/cloudsql.client"
}

Write-Step "Writing Secret Manager values"
$requiredEnvSecrets = @("SESSION_SECRET")
foreach ($key in $requiredEnvSecrets) {
  if (-not $dotEnv.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($dotEnv[$key])) {
    throw "Required value '$key' is missing from .env for production bootstrap."
  }
}

Ensure-SecretAndVersion $projectId "reselleros-database-url" $databaseUrl
Ensure-SecretAndVersion $projectId "reselleros-direct-database-url" $directUrl
Ensure-SecretAndVersion $projectId "reselleros-redis-url" $redisUrl
Ensure-SecretAndVersion $projectId "reselleros-session-secret" $dotEnv["SESSION_SECRET"]
if ($hasOpenAiKey) {
  Ensure-SecretAndVersion $projectId "reselleros-openai-api-key" $dotEnv["OPENAI_API_KEY"]
}
if ($hasStripeSecret) {
  Ensure-SecretAndVersion $projectId "reselleros-stripe-secret-key" $dotEnv["STRIPE_SECRET_KEY"]
}
if ($hasStripeWebhook) {
  Ensure-SecretAndVersion $projectId "reselleros-stripe-webhook-secret" $dotEnv["STRIPE_WEBHOOK_SECRET"]
}
if ($hasEbayClientId) {
  Ensure-SecretAndVersion $projectId "reselleros-ebay-client-id" $dotEnv["EBAY_CLIENT_ID"]
}
if ($hasEbayClientSecret) {
  Ensure-SecretAndVersion $projectId "reselleros-ebay-client-secret" $dotEnv["EBAY_CLIENT_SECRET"]
}

Write-Step "Generating production env files"
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

$webEnvFile = Join-Path $runtimeDir "web.env.yaml"
$apiEnvFile = Join-Path $runtimeDir "api.env.yaml"
$workerEnvFile = Join-Path $runtimeDir "worker.env.yaml"
$connectorEnvFile = Join-Path $runtimeDir "connector-runner.env.yaml"
$jobsEnvFile = Join-Path $runtimeDir "jobs.env.yaml"
$apiSecretsFile = Join-Path $runtimeDir "api.secrets.txt"
$workerSecretsFile = Join-Path $runtimeDir "worker.secrets.txt"
$connectorSecretsFile = Join-Path $runtimeDir "connector-runner.secrets.txt"
$jobsSecretsFile = Join-Path $runtimeDir "jobs.secrets.txt"

$apiSecretLines = @(
  "DATABASE_URL=reselleros-database-url:latest",
  "DIRECT_URL=reselleros-direct-database-url:latest",
  "REDIS_URL=reselleros-redis-url:latest",
  "SESSION_SECRET=reselleros-session-secret:latest"
)
if ($hasOpenAiKey) {
  $apiSecretLines += "OPENAI_API_KEY=reselleros-openai-api-key:latest"
}
if ($hasStripeSecret) {
  $apiSecretLines += "STRIPE_SECRET_KEY=reselleros-stripe-secret-key:latest"
}
if ($hasStripeWebhook) {
  $apiSecretLines += "STRIPE_WEBHOOK_SECRET=reselleros-stripe-webhook-secret:latest"
}
if ($hasEbayClientId) {
  $apiSecretLines += "EBAY_CLIENT_ID=reselleros-ebay-client-id:latest"
}
if ($hasEbayClientSecret) {
  $apiSecretLines += "EBAY_CLIENT_SECRET=reselleros-ebay-client-secret:latest"
}

$workerSecretLines = @(
  "DATABASE_URL=reselleros-database-url:latest",
  "DIRECT_URL=reselleros-direct-database-url:latest",
  "REDIS_URL=reselleros-redis-url:latest",
  "SESSION_SECRET=reselleros-session-secret:latest"
)
if ($hasOpenAiKey) {
  $workerSecretLines += "OPENAI_API_KEY=reselleros-openai-api-key:latest"
}

$connectorSecretLines = @(
  "DATABASE_URL=reselleros-database-url:latest",
  "DIRECT_URL=reselleros-direct-database-url:latest",
  "REDIS_URL=reselleros-redis-url:latest",
  "SESSION_SECRET=reselleros-session-secret:latest"
)

$jobsSecretLines = @(
  "DATABASE_URL=reselleros-database-url:latest",
  "DIRECT_URL=reselleros-direct-database-url:latest",
  "REDIS_URL=reselleros-redis-url:latest",
  "SESSION_SECRET=reselleros-session-secret:latest"
)
if ($hasOpenAiKey) {
  $jobsSecretLines += "OPENAI_API_KEY=reselleros-openai-api-key:latest"
}

Write-LinesFile $apiSecretsFile $apiSecretLines
Write-LinesFile $workerSecretsFile $workerSecretLines
Write-LinesFile $connectorSecretsFile $connectorSecretLines
Write-LinesFile $jobsSecretsFile $jobsSecretLines

Write-YamlFile $webEnvFile ([ordered]@{
  NODE_ENV = "production"
  NEXT_PUBLIC_API_BASE_URL = $apiBaseUrl
})

Write-YamlFile $apiEnvFile ([ordered]@{
  NODE_ENV = "production"
  API_PORT = "4000"
  OPENAI_MODEL = "gpt-4.1-mini"
  APP_BASE_URL = $appBaseUrl
  API_PUBLIC_BASE_URL = $apiBaseUrl
  EBAY_REDIRECT_URI = "$apiBaseUrl/api/marketplace-accounts/ebay/oauth/callback"
  EBAY_ENVIRONMENT = "production"
  EBAY_LIVE_PUBLISH_ENABLED = $(if ($ebayConfigured) { "true" } else { "false" })
  STORAGE_BACKEND = "gcs"
  GCS_BUCKET_UPLOADS = $uploadsBucket
  GCS_BUCKET_ARTIFACTS = $artifactsBucket
  GCS_UPLOAD_PUBLIC_BASE_URL = $uploadsPublicBaseUrl
})

Write-YamlFile $workerEnvFile ([ordered]@{
  NODE_ENV = "production"
  WORKER_CONCURRENCY = "5"
  OPENAI_MODEL = "gpt-4.1-mini"
  APP_BASE_URL = $appBaseUrl
  STORAGE_BACKEND = "gcs"
  GCS_BUCKET_UPLOADS = $uploadsBucket
  GCS_BUCKET_ARTIFACTS = $artifactsBucket
  GCS_UPLOAD_PUBLIC_BASE_URL = $uploadsPublicBaseUrl
})

Write-YamlFile $connectorEnvFile ([ordered]@{
  NODE_ENV = "production"
  API_PORT = "4010"
  CONNECTOR_CONCURRENCY = "1"
  CONNECTOR_FAILURE_THRESHOLD = "3"
  ARTIFACT_BASE_DIR = "/tmp/reselleros-artifacts"
  APP_BASE_URL = $appBaseUrl
  STORAGE_BACKEND = "gcs"
  GCS_BUCKET_UPLOADS = $uploadsBucket
  GCS_BUCKET_ARTIFACTS = $artifactsBucket
  GCS_UPLOAD_PUBLIC_BASE_URL = $uploadsPublicBaseUrl
})

Write-YamlFile $jobsEnvFile ([ordered]@{
  NODE_ENV = "production"
  WORKER_CONCURRENCY = "1"
  OPENAI_MODEL = "gpt-4.1-mini"
  APP_BASE_URL = $appBaseUrl
  STORAGE_BACKEND = "gcs"
  GCS_BUCKET_UPLOADS = $uploadsBucket
  GCS_BUCKET_ARTIFACTS = $artifactsBucket
  GCS_UPLOAD_PUBLIC_BASE_URL = $uploadsPublicBaseUrl
})

Write-Step "Validating generated config"
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "validate-cloudrun-config.ps1") -App web -EnvFile $webEnvFile
if ($LASTEXITCODE -ne 0) { throw "Web config validation failed." }
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "validate-cloudrun-config.ps1") -App api -EnvFile $apiEnvFile -SecretsFile $apiSecretsFile -ServiceAccount $serviceAccounts.api -VpcConnector $vpcConnectorResource
if ($LASTEXITCODE -ne 0) { throw "API config validation failed." }
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "validate-cloudrun-config.ps1") -App worker -EnvFile $workerEnvFile -SecretsFile $workerSecretsFile -ServiceAccount $serviceAccounts.worker -VpcConnector $vpcConnectorResource
if ($LASTEXITCODE -ne 0) { throw "Worker config validation failed." }
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "validate-cloudrun-config.ps1") -App connector-runner -EnvFile $connectorEnvFile -SecretsFile $connectorSecretsFile -ServiceAccount $serviceAccounts.connector -VpcConnector $vpcConnectorResource
if ($LASTEXITCODE -ne 0) { throw "Connector config validation failed." }
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "validate-cloudrun-config.ps1") -App jobs -EnvFile $jobsEnvFile -SecretsFile $jobsSecretsFile -ServiceAccount $serviceAccounts.jobs -VpcConnector $vpcConnectorResource
if ($LASTEXITCODE -ne 0) { throw "Jobs config validation failed." }

Write-Step "Writing deployment summary"
$summary = [ordered]@{
  projectId = $projectId
  region = $Region
  billingAccountId = $billingId
  cloudSqlInstance = $cloudSqlInstanceConnection
  uploadsBucket = $uploadsBucket
  artifactsBucket = $artifactsBucket
  redisHost = $redisHost
  redisPort = $redisPort
  vpcConnector = $vpcConnectorResource
  webEnvFile = $webEnvFile
  apiEnvFile = $apiEnvFile
  workerEnvFile = $workerEnvFile
  connectorEnvFile = $connectorEnvFile
  jobsEnvFile = $jobsEnvFile
  apiSecretsFile = $apiSecretsFile
  workerSecretsFile = $workerSecretsFile
  connectorSecretsFile = $connectorSecretsFile
  jobsSecretsFile = $jobsSecretsFile
  runtimeDir = $runtimeDir
  ebayConfigured = $ebayConfigured
}
$summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $runtimeDir "summary.json")

if ($SkipDeploy) {
  Write-Host ""
  Write-Host "Bootstrap complete. Deployment skipped." -ForegroundColor Yellow
  Write-Host "Summary file: $(Join-Path $runtimeDir 'summary.json')"
  exit 0
}

Write-Step "Building API image for migration job"
$apiImage = "$Region-docker.pkg.dev/$projectId/$ArtifactRepository/api`:$ImageTag"
docker build -f "apps/api/Dockerfile" -t $apiImage .
if ($LASTEXITCODE -ne 0) {
  throw "API image build failed."
}

docker push $apiImage
if ($LASTEXITCODE -ne 0) {
  throw "API image push failed."
}

Write-Step "Deploying and executing migration job"
$migrationSecretSpec = "DATABASE_URL=reselleros-database-url:latest,DIRECT_URL=reselleros-direct-database-url:latest"
Invoke-Gcloud run jobs deploy "reselleros-db-migrate" `
  --project $projectId `
  --region $Region `
  --image $apiImage `
  --command "pnpm" `
  "--args=--dir,/app/node_modules/@reselleros/db,exec,prisma,migrate,deploy,--schema,prisma/schema.prisma" `
  --set-secrets $migrationSecretSpec `
  --service-account $serviceAccounts.api `
  --set-cloudsql-instances $cloudSqlInstanceConnection `
  --vpc-connector $vpcConnectorResource `
  --vpc-egress "private-ranges-only" `
  --tasks "1" `
  --max-retries "1" `
  --cpu "1" `
  --memory "512Mi"
Invoke-Gcloud run jobs execute "reselleros-db-migrate" --project $projectId --region $Region --wait

Write-Step "Deploying API"
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "deploy-cloudrun.ps1") `
  -ProjectId $projectId `
  -App api `
  -Region $Region `
  -ImageTag $ImageTag `
  -ArtifactRepository $ArtifactRepository `
  -EnvFile $apiEnvFile `
  -SecretsFile $apiSecretsFile `
  -ServiceAccount $serviceAccounts.api `
  -CloudSqlInstance $cloudSqlInstanceConnection `
  -VpcConnector $vpcConnectorResource `
  -VpcEgress "private-ranges-only"
if ($LASTEXITCODE -ne 0) { throw "API deploy failed." }

Write-Step "Deploying worker"
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "deploy-cloudrun.ps1") `
  -ProjectId $projectId `
  -App worker `
  -Region $Region `
  -ImageTag $ImageTag `
  -ArtifactRepository $ArtifactRepository `
  -EnvFile $workerEnvFile `
  -SecretsFile $workerSecretsFile `
  -ServiceAccount $serviceAccounts.worker `
  -CloudSqlInstance $cloudSqlInstanceConnection `
  -VpcConnector $vpcConnectorResource `
  -VpcEgress "private-ranges-only"
if ($LASTEXITCODE -ne 0) { throw "Worker deploy failed." }

Write-Step "Deploying connector runner"
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "deploy-cloudrun.ps1") `
  -ProjectId $projectId `
  -App connector-runner `
  -Region $Region `
  -ImageTag $ImageTag `
  -ArtifactRepository $ArtifactRepository `
  -EnvFile $connectorEnvFile `
  -SecretsFile $connectorSecretsFile `
  -ServiceAccount $serviceAccounts.connector `
  -CloudSqlInstance $cloudSqlInstanceConnection `
  -VpcConnector $vpcConnectorResource `
  -VpcEgress "private-ranges-only"
if ($LASTEXITCODE -ne 0) { throw "Connector deploy failed." }

Write-Step "Deploying jobs"
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "deploy-cloudrun.ps1") `
  -ProjectId $projectId `
  -App jobs `
  -Region $Region `
  -ImageTag $ImageTag `
  -ArtifactRepository $ArtifactRepository `
  -EnvFile $jobsEnvFile `
  -SecretsFile $jobsSecretsFile `
  -ServiceAccount $serviceAccounts.jobs `
  -CloudSqlInstance $cloudSqlInstanceConnection `
  -VpcConnector $vpcConnectorResource `
  -VpcEgress "private-ranges-only"
if ($LASTEXITCODE -ne 0) { throw "Jobs deploy failed." }

Write-Step "Deploying web"
& powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "deploy-cloudrun.ps1") `
  -ProjectId $projectId `
  -App web `
  -Region $Region `
  -ImageTag $ImageTag `
  -ArtifactRepository $ArtifactRepository `
  -EnvFile $webEnvFile `
  -SecretsFile "infra/cloudrun/web.secrets.example.txt"
if ($LASTEXITCODE -ne 0) { throw "Web deploy failed." }

if (-not $SkipDomainMappings) {
  Write-Step "Creating Cloud Run domain mappings"
  try {
    $webMapping = Ensure-DomainMapping $projectId $Region $Domain "reselleros-web"
    $apiMapping = Ensure-DomainMapping $projectId $Region $ApiDomain "reselleros-api"
    $domainOutput = [ordered]@{
      web = $webMapping
      api = $apiMapping
    }
    $domainOutput | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $runtimeDir "domain-mappings.json")
  } catch {
    Write-Warning "Domain mapping creation failed. You may need domain verification in Google Search Console first. Error: $($_.Exception.Message)"
  }
}

Write-Step "Deployment complete"
Write-Host "Project: $projectId"
Write-Host "Web: $appBaseUrl"
Write-Host "API: $apiBaseUrl"
Write-Host "Summary: $(Join-Path $runtimeDir 'summary.json')"
