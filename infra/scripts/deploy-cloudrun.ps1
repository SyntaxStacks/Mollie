param(
  [Parameter(Mandatory = $true)] [string]$ProjectId,
  [Parameter(Mandatory = $true)] [ValidateSet("web", "api", "worker", "connector-runner", "jobs")] [string]$App,
  [string]$Region = "us-central1",
  [string]$ImageTag = "latest"
)

$serviceMap = @{
  "web" = "reselleros-web"
  "api" = "reselleros-api"
  "worker" = "reselleros-worker"
  "connector-runner" = "reselleros-connector-runner"
  "jobs" = "reselleros-sync-job"
}

$dockerfile = "apps/$App/Dockerfile"
$image = "$Region-docker.pkg.dev/$ProjectId/reselleros/$App`:$ImageTag"
$serviceName = $serviceMap[$App]

gcloud builds submit . --project $ProjectId --region $Region --tag $image --file $dockerfile

if ($App -eq "jobs") {
  gcloud run jobs deploy $serviceName `
    --project $ProjectId `
    --region $Region `
    --image $image `
    --env-vars-file infra/cloudrun/service.env.example.yaml
}
else {
  $ingress = if ($App -eq "web" -or $App -eq "api") { "all" } else { "internal" }
  $concurrency = if ($App -eq "connector-runner") { "1" } elseif ($App -eq "worker") { "5" } else { "40" }
  $authFlag = if ($App -eq "web" -or $App -eq "api") { "--allow-unauthenticated" } else { "--no-allow-unauthenticated" }

  gcloud run deploy $serviceName `
    --project $ProjectId `
    --region $Region `
    --image $image `
    $authFlag `
    --ingress $ingress `
    --concurrency $concurrency `
    --env-vars-file infra/cloudrun/service.env.example.yaml
}
