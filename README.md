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

If `DATABASE_URL`, `DIRECT_URL`, or `REDIS_URL` are blank, the local PowerShell helpers derive them from `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_HOST_PORT`, and `REDIS_HOST_PORT`. Explicit connection URLs still win if you set them.

Helpers that derive local connection URLs automatically:

- `powershell -ExecutionPolicy Bypass -File infra/scripts/start-local.ps1`
- `powershell -ExecutionPolicy Bypass -File infra/scripts/test-e2e.ps1`

## Validation

- `pnpm typecheck`
- `pnpm test:contracts`
- `pnpm build`
- `pnpm test:ui`
- `pnpm test:e2e`
- `pnpm docker:smoke-build`
- `pnpm docker:smoke-start`

`pnpm test:e2e` now loads `.env` or `.env.example`, clears ambient connection leakage, prints the resolved local DB and Redis targets, and fails fast if the effective E2E URLs do not point at local `reselleros` test infrastructure.

The E2E suite covers:

- happy-path eBay publish workflow
- live OAuth eBay publish through the worker path, including token refresh and listing persistence
- Depop failure artifacts and connector health degradation
- cross-workspace inventory isolation

The UI E2E suite covers:

- logged-out onboarding form visibility without a redirect trap
- browser-based operator bootstrap from login code to workspace creation
- post-workspace redirect back to the dashboard shell
- inventory image upload from the browser with preview rendering

The API contract suite covers:

- health contract shape
- auth boundary on every registered route domain
- split route module registration staying wired into the app bootstrap
- eBay OAuth foundation start/callback behavior and encrypted credential persistence

The CI workflow validates:

- Cloud Run config presence for every service
- repo typecheck
- repo build
- Prisma migration deploy on a clean database
- E2E workflow coverage
- isolated browser onboarding/workspace coverage
- full image smoke builds
- runtime container smoke starts for `api`, `worker`, `connector-runner`, `web`, and `jobs`

## Key flows

1. Request and verify a login code on `/onboarding`
2. Create a workspace on `/workspace`
3. Connect eBay and Depop on `/marketplaces`
4. Import a Mac.bid lot on `/lots`
5. Convert a lot into inventory on `/lots/[id]`
6. Upload photos, delete bad ones, and reorder inventory images on `/inventory/[id]`
7. Generate and approve drafts from `/inventory/[id]` and `/drafts`
8. Publish queued listings from `/inventory/[id]`
9. Inspect runs on `/executions`
10. Record sold items on `/sales`

The marketplace screen now surfaces eBay account readiness directly from the connector state, so pilot operators can see whether an OAuth account is live-ready, simulated-only, disabled, or blocked on refresh/error conditions. Blocked OAuth accounts can now be reconnected directly from `/marketplaces` without re-entering the display name manually, the page shows the OAuth return result after redirect, and live eBay location/policy defaults can now be stored on the account instead of relying only on env configuration.

Inventory detail now includes an eBay preflight view that surfaces whether a specific item is ready for simulated or live eBay publish, including blocked checks for images, approved draft, account state, live config, and category mapping. The same screen now lets operators edit the eBay draft title, price, and `ebayCategoryId` without leaving the item detail page.

Inventory detail now also supports direct image upload for pilot users. The API accepts a single multipart image upload, stores it through the storage abstraction, creates the `ImageAsset`, and surfaces the uploaded photo back in the item detail gallery for eBay/Depop preflight and publish flows. Operators can also delete a bad upload or reorder the gallery with simple move-up/move-down controls before publishing.

The executions screen now supports pilot debugging directly from the UI: operators can filter by status, search by full or partial `correlationId`, inspect request/response payloads and artifact paths, review retry attempts and related audit activity, and retry failed publish jobs without leaving `/executions`. Operator-facing execution payloads are redacted at the API boundary so tokens, auth headers, credential payloads, and raw secret refs do not leak into the support surface.

The canonical eBay operator truth model is now:

- `SIMULATED`: manual secret-ref account using the pilot-safe simulated eBay path
- `OAUTH_CONNECTED`: OAuth account is connected, but live publish is disabled
- `LIVE_CONFIG_MISSING`: OAuth account is connected and live is enabled, but required eBay defaults are missing
- `LIVE_READY`: OAuth account is connected, validated, and ready for live publish
- `LIVE_BLOCKED`: OAuth account is disabled, invalid, unverified, or needs refresh
- `LIVE_ERROR`: OAuth account is in a connector error state and should be reconnected or repaired

## Deployment

- Dockerfiles live in each runnable app directory.
- Cloud Run helper files live in `infra/cloudrun`.
- PowerShell deployment helper: `infra/scripts/deploy-cloudrun.ps1`
- Cloud Run config validator: `infra/scripts/validate-cloudrun-config.ps1`
- image smoke-build helper: `infra/scripts/smoke-build-images.ps1`
- container smoke-start helper: `infra/scripts/smoke-start-containers.ps1`
- Local bootstrap helper: `infra/scripts/start-local.ps1`
- Local E2E helper: `infra/scripts/test-e2e.ps1`
- Deterministic E2E runner: `infra/scripts/run-e2e.mjs`
- Isolated UI E2E runner: `infra/scripts/run-ui-e2e.mjs`
- Pilot deploy checklist: `docs/pilot-deploy-checklist.md`
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

- eBay now has a real OAuth foundation: the API can start the authorization-code flow, exchange the callback code, validate the connected eBay account, and store the token set encrypted in the database-backed credential vault path. When live publish is not enabled, OAuth-backed accounts fail closed instead of faking successful listings.
- If `EBAY_LIVE_PUBLISH_ENABLED=true`, OAuth-backed eBay accounts can now use the real Inventory API path. That path expects `ebayCategoryId` on the approved draft attributes plus eBay live defaults for merchant location and listing policies. Those defaults can now be stored on the OAuth account from `/marketplaces`, with env values remaining as fallback.
- eBay state is now derived from one canonical evaluator and reused across `/marketplaces`, inventory preflight, publish routing, queue-backed execution logs, and operator badges/messages.
- The manual eBay secret-ref connector remains in place for simulated pilot publish jobs while the live eBay offer/create path is still being built.
- Depop publishing is still a simulated automation adapter with auditable queue flow and artifact hooks, so the MVP can be exercised before live connector hardening.
- OpenAI usage is optional. If `OPENAI_API_KEY` is unset, deterministic fallback heuristics drive lot analysis and draft generation.
- Connector-runner failures write local artifacts into `ARTIFACT_BASE_DIR` and mark repeated account failures in the database.
- `jobs` includes a dedicated `JOBS_SMOKE_MODE=1` path so one-off container startup can be verified without requiring a live database fanout run.
