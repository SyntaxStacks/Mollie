# Mollie MVP

Mollie is a TypeScript monorepo for the ResellerOS MVP: Mac.bid ingestion, AI valuation, inventory normalization, listing draft generation, queued publish flows for eBay and Depop, execution logs, and basic sales/P&L.

## What ships

- `apps/web`: Next.js operator dashboard
- `apps/api`: Fastify API with auth, workspace, lot, inventory, draft, listing, log, and sales routes
- `apps/worker`: BullMQ worker for lot analysis, draft generation, eBay publish, and sync jobs
- `apps/connector-runner`: isolated BullMQ worker for Depop automation-class jobs
- `apps/jobs`: scheduled job entrypoint for sync fanout
- `packages/*`: shared config, auth, artifacts, DB, queue, AI, marketplace adapters, UI, and domain types

## Local setup

1. `docker compose up -d`
2. `Copy-Item .env.example .env`
3. `pnpm install`
4. `pnpm db:generate`
5. `pnpm db:migrate`
6. `pnpm db:seed`
7. In separate terminals run:
   - `pnpm dev:api`
   - `pnpm dev:worker`
   - `pnpm dev:connector`
   - `pnpm dev:web`

The default local ports are:

- web: `http://localhost:3000`
- api: `http://localhost:4000`
- worker health: `http://localhost:4001/health`
- connector-runner health: `http://localhost:4010/health`

Local infra ports are now overrideable through `.env`:

- `POSTGRES_HOST_PORT`
- `REDIS_HOST_PORT`

If you change those host ports, keep `DATABASE_URL`, `DIRECT_URL`, and `REDIS_URL` aligned with the same values.

## Validation

- `pnpm typecheck`
- `pnpm build`
- `pnpm test:e2e`

The E2E suite covers:

- happy-path eBay publish workflow
- Depop failure artifacts and connector health degradation
- cross-workspace inventory isolation

## Key flows

1. Request and verify a login code on `/onboarding`
2. Create a workspace on `/workspace`
3. Connect eBay and Depop on `/marketplaces`
4. Import a Mac.bid lot on `/lots`
5. Convert a lot into inventory on `/lots/[id]`
6. Generate and approve drafts from `/inventory/[id]` and `/drafts`
7. Publish queued listings from `/inventory/[id]`
8. Inspect runs on `/executions`
9. Record sold items on `/sales`

## Deployment

- Dockerfiles live in each runnable app directory.
- Cloud Run helper files live in `infra/cloudrun`.
- PowerShell deployment helper: `infra/scripts/deploy-cloudrun.ps1`
- Cloud Run config validator: `infra/scripts/validate-cloudrun-config.ps1`
- Local bootstrap helper: `infra/scripts/start-local.ps1`
- Local E2E helper: `infra/scripts/test-e2e.ps1`
- Cloud Run deployment guide: `docs/deployment-cloudrun.md`

Cloud Run is now configured around per-service runtime config:

- non-secret env files:
  - `infra/cloudrun/web.env.example.yaml`
  - `infra/cloudrun/api.env.example.yaml`
  - `infra/cloudrun/worker.env.example.yaml`
  - `infra/cloudrun/connector-runner.env.example.yaml`
  - `infra/cloudrun/jobs.env.example.yaml`
- Secret Manager mappings:
  - `infra/cloudrun/web.secrets.example.txt`
  - `infra/cloudrun/api.secrets.example.txt`
  - `infra/cloudrun/worker.secrets.example.txt`
  - `infra/cloudrun/connector-runner.secrets.example.txt`
  - `infra/cloudrun/jobs.secrets.example.txt`

Example deploy:

- `pwsh infra/scripts/deploy-cloudrun.ps1 -ProjectId my-project -App api -EnvFile infra/cloudrun/api.env.example.yaml -SecretsFile infra/cloudrun/api.secrets.example.txt -ServiceAccount reselleros-api@my-project.iam.gserviceaccount.com -CloudSqlInstance my-project:us-central1:reselleros`

## Notes

- eBay and Depop publishing are currently simulated adapters with auditable queue flow and artifact hooks, so the MVP can be exercised before live connector hardening.
- OpenAI usage is optional. If `OPENAI_API_KEY` is unset, deterministic fallback heuristics drive lot analysis and draft generation.
- Connector-runner failures write local artifacts into `ARTIFACT_BASE_DIR` and mark repeated account failures in the database.
