param(
  [switch]$SkipInfra,
  [switch]$SkipInstall,
  [switch]$SkipMigrate
)

. "$PSScriptRoot/local-env.ps1"
$null = Use-LocalRuntimeEnv ".env"

if (-not $SkipInfra) {
  docker compose --env-file .env up -d
}

if (-not $SkipInstall) {
  pnpm.cmd install
}

pnpm.cmd --filter @reselleros/db db:generate

if (-not $SkipMigrate) {
  packages/db/node_modules/.bin/prisma.cmd migrate deploy --schema packages/db/prisma/schema.prisma
}

pnpm.cmd test:e2e
