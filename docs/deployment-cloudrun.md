# Cloud Run Deployment

Use one env file and one Secret Manager mapping file per runnable service. The deploy helper reads both and attaches Cloud SQL, service accounts, and resource limits without editing the command.

## Service Config Files

- `infra/cloudrun/web.env.example.yaml`
- `infra/cloudrun/api.env.example.yaml`
- `infra/cloudrun/worker.env.example.yaml`
- `infra/cloudrun/connector-runner.env.example.yaml`
- `infra/cloudrun/jobs.env.example.yaml`

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

## Notes

- Keep `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, auth secrets, Stripe secrets, and marketplace secrets in Secret Manager.
- Keep bucket names, concurrency, ports, and public URLs in the env file.
- Use `internal` ingress for worker-style services.
- Use explicit `-MinInstances`, `-MaxInstances`, `-Cpu`, and `-Memory` overrides when a service needs non-default sizing.
