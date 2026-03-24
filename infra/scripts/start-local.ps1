param(
  [switch]$SkipInfra
)

if (-not $SkipInfra) {
  docker compose up -d
}

Copy-Item .env.example .env -ErrorAction SilentlyContinue
pnpm install
pnpm --filter @reselleros/db db:generate

Write-Host "Run these in separate terminals:"
Write-Host "  pnpm dev:api"
Write-Host "  pnpm dev:worker"
Write-Host "  pnpm dev:connector"
Write-Host "  pnpm dev:web"
Write-Host ""
Write-Host "Optional first-time DB setup:"
Write-Host "  pnpm db:migrate"
Write-Host "  pnpm db:seed"
