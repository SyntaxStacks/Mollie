param(
  [switch]$SkipInfra
)

function Import-EnvFile([string]$PathValue) {
  Get-Content $PathValue |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -and -not $_.StartsWith("#") } |
    ForEach-Object {
      $parts = $_ -split "=", 2
      if ($parts.Length -eq 2) {
        Set-Item -Path "Env:$($parts[0])" -Value $parts[1]
      }
    }
}

if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
}

Import-EnvFile ".env"

if (-not $SkipInfra) {
  docker compose --env-file .env up -d
}

pnpm.cmd install
pnpm.cmd --filter @reselleros/db db:generate

$postgresHostPort = if ($env:POSTGRES_HOST_PORT) { $env:POSTGRES_HOST_PORT } else { "5432" }
$redisHostPort = if ($env:REDIS_HOST_PORT) { $env:REDIS_HOST_PORT } else { "6379" }

Write-Host "Local infrastructure:"
Write-Host "  Postgres host port: $postgresHostPort"
Write-Host "  Redis host port: $redisHostPort"
Write-Host ""
Write-Host "Run these in separate terminals:"
Write-Host "  pnpm.cmd dev:api"
Write-Host "  pnpm.cmd dev:worker"
Write-Host "  pnpm.cmd dev:connector"
Write-Host "  pnpm.cmd dev:web"
Write-Host ""
Write-Host "Optional first-time DB setup:"
Write-Host "  pnpm.cmd db:migrate"
Write-Host "  pnpm.cmd db:seed"
