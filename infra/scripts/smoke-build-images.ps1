param(
  [string[]]$Apps = @("api", "worker", "connector-runner", "web", "jobs")
)

$ErrorActionPreference = "Stop"

foreach ($app in $Apps) {
  $tag = "mollie-$app`:smoke"
  Write-Host "Building $app image as $tag"
  docker build -f "apps/$app/Dockerfile" -t $tag .

  if ($LASTEXITCODE -ne 0) {
    throw "Docker build failed for $app"
  }
}
