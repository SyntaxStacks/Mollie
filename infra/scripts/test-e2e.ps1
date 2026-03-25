param(
  [switch]$SkipInfra,
  [switch]$SkipInstall,
  [switch]$SkipMigrate
)

if (-not $SkipInfra) {
  docker compose up -d
}

if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
}

Get-Content .env |
  ForEach-Object { $_.Trim() } |
  Where-Object { $_ -and -not $_.StartsWith("#") } |
  ForEach-Object {
    $parts = $_ -split "=", 2
    if ($parts.Length -eq 2) {
      Set-Item -Path "Env:$($parts[0])" -Value $parts[1]
    }
  }

if (-not $SkipInstall) {
  pnpm install
}

pnpm --filter @reselleros/db db:generate

if (-not $SkipMigrate) {
  pnpm --filter @reselleros/db exec -- prisma migrate deploy
}

pnpm test:e2e
