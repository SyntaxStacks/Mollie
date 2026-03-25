param(
  [Parameter(Mandatory = $true)] [ValidateSet("web", "api", "worker", "connector-runner", "jobs")] [string]$App,
  [string]$EnvFile,
  [string]$SecretsFile,
  [string]$ServiceAccount
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

Write-Host "Cloud Run config looks complete for $App"
Write-Host "  Dockerfile: $dockerfile"
Write-Host "  Env file: $resolvedEnvFile"
Write-Host "  Secrets file: $resolvedSecretsFile"
if ($ServiceAccount) {
  Write-Host "  Service account: $ServiceAccount"
}
