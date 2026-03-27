param(
  [Parameter(Mandatory = $true)] [string]$ProjectId,
  [Parameter(Mandatory = $true)] [ValidateSet("web", "api", "worker", "connector-runner", "jobs")] [string]$App,
  [string]$Region = "us-central1",
  [string]$ImageTag = "latest",
  [string]$ArtifactRepository = "reselleros",
  [string]$EnvFile,
  [string]$SecretsFile,
  [string]$ServiceAccount,
  [string]$CloudSqlInstance,
  [string]$VpcConnector,
  [ValidateSet("all-traffic", "private-ranges-only")] [string]$VpcEgress = "private-ranges-only",
  [int]$MinInstances = -1,
  [int]$MaxInstances = -1,
  [string]$Cpu,
  [string]$Memory
)

$serviceMap = @{
  "web" = "reselleros-web"
  "api" = "reselleros-api"
  "worker" = "reselleros-worker"
  "connector-runner" = "reselleros-connector-runner"
  "jobs" = "reselleros-sync-job"
}

$defaultEnvFiles = @{
  "web" = "infra/cloudrun/web.env.example.yaml"
  "api" = "infra/cloudrun/api.env.example.yaml"
  "worker" = "infra/cloudrun/worker.env.example.yaml"
  "connector-runner" = "infra/cloudrun/connector-runner.env.example.yaml"
  "jobs" = "infra/cloudrun/jobs.env.example.yaml"
}

$defaultSecretsFiles = @{
  "web" = "infra/cloudrun/web.secrets.example.txt"
  "api" = "infra/cloudrun/api.secrets.example.txt"
  "worker" = "infra/cloudrun/worker.secrets.example.txt"
  "connector-runner" = "infra/cloudrun/connector-runner.secrets.example.txt"
  "jobs" = "infra/cloudrun/jobs.secrets.example.txt"
}

$defaultConcurrency = @{
  "web" = 40
  "api" = 40
  "worker" = 5
  "connector-runner" = 1
}

$defaultMinInstances = @{
  "web" = 0
  "api" = 0
  "worker" = 0
  "connector-runner" = 0
  "jobs" = 0
}

$defaultMaxInstances = @{
  "web" = 10
  "api" = 10
  "worker" = 5
  "connector-runner" = 3
  "jobs" = 1
}

$defaultCpu = @{
  "web" = "1"
  "api" = "1"
  "worker" = "1"
  "connector-runner" = "1"
  "jobs" = "1"
}

$defaultMemory = @{
  "web" = "512Mi"
  "api" = "512Mi"
  "worker" = "512Mi"
  "connector-runner" = "1Gi"
  "jobs" = "512Mi"
}

function Resolve-ConfigPath([string]$PathValue) {
  if ([string]::IsNullOrWhiteSpace($PathValue)) {
    return $null
  }

  if (-not (Test-Path $PathValue)) {
    throw "Config file not found: $PathValue"
  }

  return (Resolve-Path $PathValue).Path
}

function Get-SecretSpec([string]$PathValue) {
  $resolved = Resolve-ConfigPath $PathValue

  if (-not $resolved) {
    return $null
  }

  $entries = Get-Content $resolved |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -and -not $_.StartsWith("#") }

  if ($entries.Count -eq 0) {
    return $null
  }

  return ($entries -join ",")
}

function Get-EnvValue([string]$PathValue, [string]$Key) {
  $resolved = Resolve-ConfigPath $PathValue

  if (-not $resolved) {
    return $null
  }

  foreach ($line in (Get-Content $resolved)) {
    $trimmed = $line.Trim()

    if (-not $trimmed -or $trimmed.StartsWith("#")) {
      continue
    }

    if ($trimmed -match "^(?<name>[A-Z0-9_]+)\s*:\s*(?<value>.+)$" -and $matches["name"] -eq $Key) {
      return $matches["value"].Trim().Trim("'`"")
    }
  }

  return $null
}

$dockerfile = "apps/$App/Dockerfile"
$image = "$Region-docker.pkg.dev/$ProjectId/$ArtifactRepository/$App`:$ImageTag"
$serviceName = $serviceMap[$App]
$resolvedEnvFile = Resolve-ConfigPath $(if ($EnvFile) { $EnvFile } else { $defaultEnvFiles[$App] })
$secretSpec = Get-SecretSpec $(if ($SecretsFile) { $SecretsFile } else { $defaultSecretsFiles[$App] })
$resolvedMinInstances = if ($MinInstances -ge 0) { $MinInstances } else { $defaultMinInstances[$App] }
$resolvedMaxInstances = if ($MaxInstances -ge 0) { $MaxInstances } else { $defaultMaxInstances[$App] }
$resolvedCpu = if ($Cpu) { $Cpu } else { $defaultCpu[$App] }
$resolvedMemory = if ($Memory) { $Memory } else { $defaultMemory[$App] }
$dockerBuildArgs = @("build", "-f", $dockerfile, "-t", $image)

if ($App -eq "web") {
  $publicApiBaseUrl = Get-EnvValue $resolvedEnvFile "NEXT_PUBLIC_API_BASE_URL"

  if ($publicApiBaseUrl) {
    $dockerBuildArgs += @("--build-arg", "NEXT_PUBLIC_API_BASE_URL=$publicApiBaseUrl")
  }
}

& docker @dockerBuildArgs .

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

docker push $image

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

if ($App -eq "jobs") {
  $jobArgs = @(
    "run", "jobs", "deploy", $serviceName,
    "--project", $ProjectId,
    "--region", $Region,
    "--image", $image,
    "--tasks", "1",
    "--max-retries", "1",
    "--cpu", $resolvedCpu,
    "--memory", $resolvedMemory
  )

  if ($resolvedEnvFile) {
    $jobArgs += @("--env-vars-file", $resolvedEnvFile)
  }

  if ($secretSpec) {
    $jobArgs += @("--set-secrets", $secretSpec)
  }

  if ($ServiceAccount) {
    $jobArgs += @("--service-account", $ServiceAccount)
  }

  if ($CloudSqlInstance) {
    $jobArgs += @("--set-cloudsql-instances", $CloudSqlInstance)
  }

  if ($VpcConnector) {
    $jobArgs += @("--vpc-connector", $VpcConnector, "--vpc-egress", $VpcEgress)
  }

  & gcloud.cmd @jobArgs
  exit $LASTEXITCODE
}

$ingress = if ($App -eq "web" -or $App -eq "api") { "all" } else { "internal" }
$concurrency = $defaultConcurrency[$App]
$authFlag = if ($App -eq "web" -or $App -eq "api") { "--allow-unauthenticated" } else { "--no-allow-unauthenticated" }
$deployArgs = @(
  "run", "deploy", $serviceName,
  "--project", $ProjectId,
  "--region", $Region,
  "--image", $image,
  $authFlag,
  "--ingress", $ingress,
  "--concurrency", "$concurrency",
  "--cpu", $resolvedCpu,
  "--memory", $resolvedMemory,
  "--min-instances", "$resolvedMinInstances",
  "--max-instances", "$resolvedMaxInstances"
)

if ($resolvedEnvFile) {
  $deployArgs += @("--env-vars-file", $resolvedEnvFile)
}

if ($secretSpec) {
  $deployArgs += @("--set-secrets", $secretSpec)
}

if ($ServiceAccount) {
  $deployArgs += @("--service-account", $ServiceAccount)
}

if ($CloudSqlInstance) {
  $deployArgs += @("--add-cloudsql-instances", $CloudSqlInstance)
}

if ($VpcConnector) {
  $deployArgs += @("--vpc-connector", $VpcConnector, "--vpc-egress", $VpcEgress)
}

& gcloud.cmd @deployArgs
exit $LASTEXITCODE
