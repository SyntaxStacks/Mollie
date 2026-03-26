# Cloud Run Deployment

Use one env file and one Secret Manager mapping file per runnable service. The deploy helper reads both and attaches Cloud SQL, service accounts, and resource limits without editing the command.

## Service Config Files

- `infra/cloudrun/web.env.example.yaml`
- `infra/cloudrun/api.env.example.yaml`
- `infra/cloudrun/worker.env.example.yaml`
- `infra/cloudrun/connector-runner.env.example.yaml`
- `infra/cloudrun/jobs.env.example.yaml`

For the current Mollie production shape, the public URLs should be:

- `APP_BASE_URL=https://mollie.biz`
- `API_PUBLIC_BASE_URL=https://api.mollie.biz`
- `NEXT_PUBLIC_API_BASE_URL=https://api.mollie.biz`
- `EBAY_REDIRECT_URI=https://api.mollie.biz/api/marketplace-accounts/ebay/oauth/callback`

## Secret Mapping Files

Each secret file is line-based:

```text
ENV_VAR=secret-name:version
```

Example:

```text
DATABASE_URL=reselleros-database-url:latest
SESSION_SECRET=reselleros-session-secret:latest
```

The API, worker, connector-runner, and jobs services each have example secret files in `infra/cloudrun`.

Do not put public URL config in Secret Manager mappings. Keep domain and callback values in the env YAML files so they stay visible and reviewable.

## Recommended Service Accounts

- `reselleros-web@PROJECT_ID.iam.gserviceaccount.com`
- `reselleros-api@PROJECT_ID.iam.gserviceaccount.com`
- `reselleros-worker@PROJECT_ID.iam.gserviceaccount.com`
- `reselleros-connector@PROJECT_ID.iam.gserviceaccount.com`
- `reselleros-jobs@PROJECT_ID.iam.gserviceaccount.com`

Grant only the roles each service needs. The API and workers should not share a broad default account.

## Deploy Examples

API:

```powershell
pwsh infra/scripts/deploy-cloudrun.ps1 `
  -ProjectId my-project `
  -App api `
  -EnvFile infra/cloudrun/api.env.example.yaml `
  -SecretsFile infra/cloudrun/api.secrets.example.txt `
  -ServiceAccount reselleros-api@my-project.iam.gserviceaccount.com `
  -CloudSqlInstance my-project:us-central1:reselleros
```

Worker:

```powershell
pwsh infra/scripts/deploy-cloudrun.ps1 `
  -ProjectId my-project `
  -App worker `
  -EnvFile infra/cloudrun/worker.env.example.yaml `
  -SecretsFile infra/cloudrun/worker.secrets.example.txt `
  -ServiceAccount reselleros-worker@my-project.iam.gserviceaccount.com `
  -CloudSqlInstance my-project:us-central1:reselleros `
  -MaxInstances 5
```

Connector runner:

```powershell
pwsh infra/scripts/deploy-cloudrun.ps1 `
  -ProjectId my-project `
  -App connector-runner `
  -EnvFile infra/cloudrun/connector-runner.env.example.yaml `
  -SecretsFile infra/cloudrun/connector-runner.secrets.example.txt `
  -ServiceAccount reselleros-connector@my-project.iam.gserviceaccount.com `
  -CloudSqlInstance my-project:us-central1:reselleros `
  -MaxInstances 3 `
  -Memory 1Gi
```

## Migration Job

Use the API image for Prisma migrations, but do not reuse the API service config directly. Provide database secrets and the Cloud SQL attachment only for the job runtime.

## Config Validation

Use the local validator before deploy to catch missing files or a missing service account on non-public services:

```powershell
pwsh infra/scripts/validate-cloudrun-config.ps1 `
  -App connector-runner `
  -ServiceAccount reselleros-connector@my-project.iam.gserviceaccount.com
```

## Notes

- Keep `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, auth secrets, Stripe secrets, and marketplace secrets in Secret Manager.
- Keep bucket names, concurrency, ports, public URLs, and OAuth callback URLs in the env file.
- Use `internal` ingress for worker-style services.
- Use explicit `-MinInstances`, `-MaxInstances`, `-Cpu`, and `-Memory` overrides when a service needs non-default sizing.

## Custom Domains

After the services are deployed, map:

- `mollie.biz` -> `reselleros-web`
- `api.mollie.biz` -> `reselleros-api`

Then point your DNS at the Cloud Run domain mappings before enabling the production eBay OAuth callback.
