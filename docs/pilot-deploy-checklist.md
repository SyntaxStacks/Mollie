# Pilot Deploy Checklist

Use this before any pilot-facing deploy. The goal is to catch operator mistakes before traffic moves.

## Pre-Deploy

1. Confirm the target commit is on `main` and has passed local verification:
   - `pnpm typecheck`
   - `pnpm test:contracts`
   - `pnpm build`
   - `pnpm test:e2e`
   - `pnpm docker:smoke-build`
   - `pnpm docker:smoke-start`
2. Run `infra/scripts/validate-cloudrun-config.ps1` for every service you intend to deploy.
3. Confirm the target environment secrets exist in Secret Manager and match the service mappings.
4. Confirm the target database is reachable and migrations are ready to run.
5. Confirm Redis, artifact storage, and upload storage are provisioned for the target environment.
6. Confirm service accounts are set correctly for `api`, `worker`, `connector-runner`, and `jobs`.
7. Confirm connector automation policy for pilot workspaces:
   - eBay account state is intentional
   - Depop automation is enabled only for intended workspaces

## Deploy

1. Deploy database changes first:
   - run `prisma migrate deploy`
2. Deploy services in this order:
   - `api`
   - `worker`
   - `connector-runner`
   - `jobs`
   - `web`
3. Record the deployed commit SHA, Cloud Run revision names, and migration result in the release log.

## Post-Deploy

1. Hit service health checks:
   - `GET /health` on `api`
   - `GET /health` on `worker`
   - `GET /health` on `connector-runner`
   - load the `web` root page
2. Complete one smoke workflow in the target environment:
   - request login code
   - create or select workspace
   - connect marketplace account
   - import lot
   - create inventory
   - generate and approve draft
   - publish listing
3. Confirm execution logs and audit logs are writing correctly.
4. Confirm connector artifacts are being written for forced-failure scenarios.
5. Confirm scheduled jobs start cleanly in the environment.

## Rollback

1. If the issue is app-only, roll traffic back to the previous healthy Cloud Run revision.
2. If the issue is connector-specific, disable workspace connector automation first, then investigate.
3. If the issue is migration-related, stop deploys and use the recovery procedure for that migration before re-enabling traffic.
4. Record the failure, rollback target, and user impact in the release log.
