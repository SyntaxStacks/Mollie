param(
  [switch]$SkipInfra,
  [switch]$SkipInstall,
  [switch]$SkipMigrate
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

if (-not $SkipInstall) {
  pnpm.cmd install
}

pnpm.cmd --filter @reselleros/db db:generate

if (-not $SkipMigrate) {
  packages/db/node_modules/.bin/prisma.cmd migrate deploy --schema packages/db/prisma/schema.prisma
}

pnpm.cmd test:e2e
