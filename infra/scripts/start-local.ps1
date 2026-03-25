param(
  [switch]$SkipInfra
)

. "$PSScriptRoot/local-env.ps1"
$runtime = Use-LocalRuntimeEnv ".env"

if (-not $SkipInfra) {
  docker compose --env-file .env up -d
}

pnpm.cmd install
pnpm.cmd --filter @reselleros/db db:generate

Write-Host "Local infrastructure:"
Write-Host "  Postgres host port: $($runtime.PostgresHostPort)"
Write-Host "  Redis host port: $($runtime.RedisHostPort)"
Write-Host "  DATABASE_URL: $($runtime.DatabaseUrl)"
Write-Host "  REDIS_URL: $($runtime.RedisUrl)"
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
