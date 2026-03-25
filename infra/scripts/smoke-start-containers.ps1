param(
  [switch]$BuildImages
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot/local-env.ps1"

if ($BuildImages) {
  & "$PSScriptRoot/smoke-build-images.ps1"
  if ($LASTEXITCODE -ne 0) {
    throw "Smoke image build failed"
  }
}

$runtime = Use-LocalRuntimeEnv ".env"
$postgresUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "postgres" }
$postgresPassword = if ($env:POSTGRES_PASSWORD) { $env:POSTGRES_PASSWORD } else { "postgres" }
$postgresDatabase = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "reselleros" }
$containerDatabaseUrl = "postgresql://$postgresUser`:$postgresPassword@host.docker.internal:$($runtime.PostgresHostPort)/$postgresDatabase"
$containerRedisUrl = "redis://host.docker.internal:$($runtime.RedisHostPort)"
$commonEnv = @(
  "NODE_ENV=production",
  "DATABASE_URL=$containerDatabaseUrl",
  "DIRECT_URL=$containerDatabaseUrl",
  "REDIS_URL=$containerRedisUrl",
  "SESSION_SECRET=smoke-session-secret",
  "APP_BASE_URL=http://localhost:13000",
  "GCS_BUCKET_UPLOADS=reselleros-smoke-uploads",
  "GCS_BUCKET_ARTIFACTS=reselleros-smoke-artifacts",
  "OPENAI_MODEL=gpt-4.1-mini",
  "WORKER_CONCURRENCY=1",
  "CONNECTOR_CONCURRENCY=1",
  "CONNECTOR_FAILURE_THRESHOLD=3"
)
$containerNames = @()

function Wait-ForHttpOk([string]$Url, [int]$Attempts = 20, [int]$DelaySeconds = 1) {
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
        return
      }
    } catch {
    }

    Start-Sleep -Seconds $DelaySeconds
  }

  throw "Timed out waiting for healthy response from $Url"
}

function Assert-ContainerRunning([string]$Name, [int]$GraceSeconds = 5) {
  Start-Sleep -Seconds $GraceSeconds
  $running = docker inspect -f "{{.State.Running}}" $Name 2>$null
  if ($LASTEXITCODE -ne 0 -or "$running".Trim() -ne "true") {
    docker logs $Name
    throw "Container $Name is not running after grace period"
  }
}

function Start-SmokeContainer(
  [string]$Name,
  [string]$Image,
  [int]$HostPort,
  [int]$ContainerPort,
  [string[]]$ExtraEnv = @()
) {
  $dockerArgs = @(
    "run", "-d",
    "--name", $Name,
    "--add-host", "host.docker.internal:host-gateway",
    "-p", "${HostPort}:${ContainerPort}"
  )

  foreach ($item in ($commonEnv + $ExtraEnv)) {
    $dockerArgs += @("-e", $item)
  }

  $dockerArgs += $Image
  docker @dockerArgs | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to start $Name"
  }

  $script:containerNames += $Name
}

function Remove-ContainerIfPresent([string]$Name) {
  $existingNames = docker container ls -a --format "{{.Names}}"
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to inspect docker container list during cleanup"
  }

  if ($existingNames -contains $Name) {
    docker rm -f $Name 2>$null | Out-Null
  }
}

try {
  Start-SmokeContainer -Name "mollie-smoke-api" -Image "mollie-api:smoke" -HostPort 14000 -ContainerPort 4000
  Assert-ContainerRunning "mollie-smoke-api"
  Wait-ForHttpOk "http://localhost:14000/health"

  Start-SmokeContainer -Name "mollie-smoke-worker" -Image "mollie-worker:smoke" -HostPort 14001 -ContainerPort 4001
  Assert-ContainerRunning "mollie-smoke-worker"
  Wait-ForHttpOk "http://localhost:14001/health"

  Start-SmokeContainer -Name "mollie-smoke-connector" -Image "mollie-connector-runner:smoke" -HostPort 14010 -ContainerPort 4010
  Assert-ContainerRunning "mollie-smoke-connector"
  Wait-ForHttpOk "http://localhost:14010/health"

  Start-SmokeContainer -Name "mollie-smoke-web" -Image "mollie-web:smoke" -HostPort 13000 -ContainerPort 3000 -ExtraEnv @(
    "NEXT_PUBLIC_API_BASE_URL=http://host.docker.internal:14000"
  )
  Assert-ContainerRunning "mollie-smoke-web"
  Wait-ForHttpOk "http://localhost:13000/"

  docker run --rm `
    --add-host host.docker.internal:host-gateway `
    -e "NODE_ENV=production" `
    -e "DATABASE_URL=$containerDatabaseUrl" `
    -e "DIRECT_URL=$containerDatabaseUrl" `
    -e "REDIS_URL=$containerRedisUrl" `
    -e "SESSION_SECRET=smoke-session-secret" `
    -e "APP_BASE_URL=http://localhost:13000" `
    -e "GCS_BUCKET_UPLOADS=reselleros-smoke-uploads" `
    -e "GCS_BUCKET_ARTIFACTS=reselleros-smoke-artifacts" `
    -e "OPENAI_MODEL=gpt-4.1-mini" `
    -e "WORKER_CONCURRENCY=1" `
    -e "JOBS_SMOKE_MODE=1" `
    mollie-jobs:smoke

  if ($LASTEXITCODE -ne 0) {
    throw "Jobs smoke run failed"
  }

  Write-Host "Container smoke tests passed"
} finally {
  foreach ($name in $containerNames) {
    Remove-ContainerIfPresent $name
  }
}
