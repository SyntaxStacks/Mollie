param(
  [Parameter(Mandatory = $true)] [ValidateSet("web", "api", "worker", "connector-runner", "jobs")] [string]$App,
  [string]$EnvFile,
  [string]$SecretsFile,
  [string]$ServiceAccount,
  [string]$VpcConnector
)

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

$resolvedEnvFile = if ($EnvFile) { $EnvFile } else { $defaultEnvFiles[$App] }
$resolvedSecretsFile = if ($SecretsFile) { $SecretsFile } else { $defaultSecretsFiles[$App] }
$dockerfile = "apps/$App/Dockerfile"

if (-not (Test-Path $dockerfile)) {
  throw "Missing Dockerfile: $dockerfile"
}

if (-not (Test-Path $resolvedEnvFile)) {
  throw "Missing env file: $resolvedEnvFile"
}

if (-not (Test-Path $resolvedSecretsFile)) {
  throw "Missing secrets file: $resolvedSecretsFile"
}

if ($App -ne "web" -and -not $ServiceAccount) {
  throw "ServiceAccount is required for $App validation."
}

function Get-KeyValueMap([string]$PathValue) {
  $map = @{}

  Get-Content $PathValue |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -and -not $_.StartsWith("#") } |
    ForEach-Object {
      $parts = $_ -split ":", 2

      if ($parts.Count -eq 2) {
        $map[$parts[0].Trim()] = $parts[1].Trim()
      }
    }

  return $map
}

function Get-SecretKeySet([string]$PathValue) {
  $set = @{}

  Get-Content $PathValue |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -and -not $_.StartsWith("#") } |
    ForEach-Object {
      $parts = $_ -split "=", 2

      if ($parts.Count -eq 2) {
        $set[$parts[0].Trim()] = $true
      }
    }

  return $set
}

$envMap = Get-KeyValueMap $resolvedEnvFile
$secretKeys = Get-SecretKeySet $resolvedSecretsFile

$requiredEnvKeys = switch ($App) {
  "web" { @("NEXT_PUBLIC_API_BASE_URL") }
  "api" { @("APP_BASE_URL", "API_PUBLIC_BASE_URL", "EBAY_REDIRECT_URI") }
  default { @("APP_BASE_URL") }
}

foreach ($key in $requiredEnvKeys) {
  if (-not $envMap.ContainsKey($key) -or [string]::IsNullOrWhiteSpace($envMap[$key])) {
    throw "Env file is missing required key for ${App}: $key"
  }
}

$publicConfigKeys = @("APP_BASE_URL", "API_PUBLIC_BASE_URL", "NEXT_PUBLIC_API_BASE_URL", "EBAY_REDIRECT_URI")

foreach ($key in $publicConfigKeys) {
  if ($secretKeys.ContainsKey($key)) {
    throw "Secrets file should not contain public URL config: $key"
  }
}

$requiresPrivateRedis = @("api", "worker", "connector-runner", "jobs") -contains $App

if ($requiresPrivateRedis) {
  if (-not $secretKeys.ContainsKey("REDIS_URL")) {
    throw "Secrets file is missing REDIS_URL for $App"
  }

  if ([string]::IsNullOrWhiteSpace($VpcConnector)) {
    throw "VpcConnector is required for $App validation because Redis is expected to be private."
  }
}

Write-Host "Cloud Run config looks complete for $App"
Write-Host "  Dockerfile: $dockerfile"
Write-Host "  Env file: $resolvedEnvFile"
Write-Host "  Secrets file: $resolvedSecretsFile"
if ($ServiceAccount) {
  Write-Host "  Service account: $ServiceAccount"
}
if ($VpcConnector) {
  Write-Host "  VPC connector: $VpcConnector"
}
