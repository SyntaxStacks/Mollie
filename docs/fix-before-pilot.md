# Fix Before Pilot

This backlog converts the current MVP skeleton into a pilot-safe system. The priorities below are ordered by deployment risk, not implementation convenience.

## P0. Replace Placeholder Auth

### Why

Current auth is local-dev quality. It mints a bearer session from email/name alone and stores raw session tokens in the database. This is the primary blocker for any internet-facing pilot.

### Refactors

- Introduce a real auth package at `packages/auth`.
- Replace `POST /api/auth/login` in [apps/api/src/index.ts](c:/code/mollie/apps/api/src/index.ts) with one of:
  - magic-link email flow, or
  - Google OAuth for operator login.
- Store session identifiers hashed at rest instead of storing raw bearer tokens.
- Add session expiry rotation and logout invalidation.
- Move auth route handlers out of [apps/api/src/index.ts](c:/code/mollie/apps/api/src/index.ts) into `apps/api/src/routes/auth.ts`.
- Extend the Prisma schema in [packages/db/prisma/schema.prisma](c:/code/mollie/packages/db/prisma/schema.prisma) with:
  - `workspace_memberships`
  - session metadata such as `last_used_at`, `ip_address`, `user_agent`
- Add auth middleware that resolves `user -> membership -> workspace` instead of assuming one workspace per owner.

### Acceptance Criteria

- Unauthenticated requests to protected routes return `401`.
- A user can only access workspaces they belong to through membership records.
- Session tokens are not stored raw in Postgres.
- Session expiry and logout are enforced server-side.
- Local dev still supports a documented fast path, but it is clearly isolated behind `NODE_ENV=development`.

## P0. Tighten Tenant-Safe Mutation Patterns

### Why

Tenant scoping is present, but mutation paths are still too easy to get wrong if ownership checks and writes are mixed ad hoc.

### Refactors

- Add repository helpers in `packages/db/src/repositories/` for every write path:
  - workspace
  - marketplace accounts
  - source lots
  - inventory
  - drafts
  - listings
  - sales
- Replace inline mutation logic in [apps/api/src/index.ts](c:/code/mollie/apps/api/src/index.ts) with the pattern:
  1. `findFirst` by `id + workspaceId`
  2. assert existence
  3. update by primary key
- Add explicit workspace ownership guards in worker and connector-runner flows before mutating records tied to queue jobs.
- Change `InventoryItem` uniqueness in [packages/db/prisma/schema.prisma](c:/code/mollie/packages/db/prisma/schema.prisma):
  - remove global `@unique` on `sku`
  - add `@@unique([workspaceId, sku])`
- Add a composite index for execution-log query patterns:
  - `@@index([workspaceId, jobName, status, createdAt])`

### Acceptance Criteria

- No API mutation writes using a relation-filter shortcut without a preceding ownership lookup.
- Cross-workspace access attempts fail deterministically.
- `sku` uniqueness is enforced per workspace, not globally.
- Repository helpers are the only place that writes tenant-scoped domain objects.

## P0. Make Deployment Production-Shaped

### Why

The current Cloud Run helpers are deployable, but they still model secrets and runtime config like a dev environment.

### Refactors

- Replace the shared env-only flow in [infra/cloudrun/service.env.example.yaml](c:/code/mollie/infra/cloudrun/service.env.example.yaml) with per-service config files:
  - `web.env.example.yaml`
  - `api.env.example.yaml`
  - `worker.env.example.yaml`
  - `connector-runner.env.example.yaml`
  - `jobs.env.example.yaml`
- Update [infra/scripts/deploy-cloudrun.ps1](c:/code/mollie/infra/scripts/deploy-cloudrun.ps1) to:
  - use Secret Manager bindings for secrets
  - use service-specific env files
  - set explicit CPU, memory, timeout, min/max instances, and concurrency
  - set service accounts per runtime
- Document Cloud SQL connection strategy:
  - Cloud SQL Auth Proxy/connector or private attachment
- Document Redis strategy per environment.
- Split public and internal ingress by service and codify those defaults in deploy scripts.

### Acceptance Criteria

- No production secret is expected to live in plaintext env files.
- `web` and `api` are deployable with public ingress; worker runtimes are internal-only.
- Each Cloud Run service has explicit resource settings and service identity.
- Deployment docs explain how to supply secrets, database access, and artifact buckets.

## P0. Add E2E State-Transition Coverage

### Why

The workflow is coherent, but it still lacks one high-signal test that proves the queue-backed lifecycle actually works.

### Refactors

- Add an end-to-end test suite in `apps/api/test/` or `tests/e2e/`.
- Cover this exact path:
  1. create session
  2. create workspace
  3. import Mac.bid lot
  4. analyze lot
  5. create inventory from lot
  6. generate draft
  7. approve draft
  8. publish listing
  9. assert `execution_log`, `platform_listing`, and `inventory_item.status`
- Provide test-mode worker execution:
  - either in-process handlers, or
  - deterministic queue draining helpers
- Add fixture setup for Postgres and Redis.

### Acceptance Criteria

- One command runs the core operator workflow in CI.
- The test asserts both DB state and API-visible state.
- Publish jobs can be retried in tests without creating duplicate listings.

## P0. Capture Failure Artifacts for Connector Jobs

### Why

The connector runner is isolated correctly, but it still needs operator-grade observability when automation fails.

### Refactors

- Expand [apps/connector-runner/src/index.ts](c:/code/mollie/apps/connector-runner/src/index.ts) to capture:
  - screenshot on failure
  - structured failure classification
  - artifact URLs persisted into `execution_logs`
- Add artifact storage helpers in a shared package, likely `packages/observability` or a new `packages/artifacts`.
- Add account-level health state transitions on repeated failures.
- Add a workspace-level kill switch for connector jobs.
- Define normalized connector errors in `packages/marketplaces/src/`.

### Acceptance Criteria

- Every connector failure stores at least one artifact or an explicit reason why artifact capture failed.
- Execution logs show operator-usable failure summaries.
- Repeated connector failures can disable further automated attempts for an account or workspace.

## P1. Freeze Connector Contracts

### Why

Simulated adapters are fine, but the boundary needs to stop moving before live integrations arrive.

### Refactors

- Expand [packages/marketplaces/src/index.ts](c:/code/mollie/packages/marketplaces/src/index.ts) into a stable contract surface:
  - `publishListing`
  - `syncListing`
  - `testConnection`
  - `validateCredentials`
  - `captureArtifacts`
  - normalized error/result objects
- Add contract tests for eBay and Depop adapter implementations.
- Add idempotency expectations to adapter inputs.

### Acceptance Criteria

- Connector implementations can be swapped from simulated to live without changing API or worker orchestration code.
- Connector errors map into a shared taxonomy.

## P1. Break Up the API God File

### Why

[apps/api/src/index.ts](c:/code/mollie/apps/api/src/index.ts) is already large enough to slow safe iteration.

### Refactors

- Split routes into:
  - `routes/auth.ts`
  - `routes/workspace.ts`
  - `routes/marketplace-accounts.ts`
  - `routes/source-lots.ts`
  - `routes/inventory.ts`
  - `routes/drafts.ts`
  - `routes/listings.ts`
  - `routes/sales.ts`
  - `routes/analytics.ts`
- Move shared auth/workspace resolution into reusable middleware.
- Move orchestration helpers into service modules under `apps/api/src/services/`.

### Acceptance Criteria

- No single API route file owns unrelated domains.
- Route registration remains explicit and discoverable.

## P1. Break Job Logic Into a Typed Registry

### Why

The worker is correct in shape but will become fragile as job count grows.

### Refactors

- Move job handlers out of [apps/worker/src/index.ts](c:/code/mollie/apps/worker/src/index.ts) into `apps/worker/src/jobs/`.
- Register handlers through a typed map keyed by queue job name.
- Add per-job retry/backoff overrides and duration logging.
- Add queue-routing tests for main-worker versus connector-runner jobs.

### Acceptance Criteria

- Each job has a dedicated handler module.
- Job routing is testable and explicit.
- Retry policy can vary by job type.

## P1. Improve Docker and Build Efficiency

### Why

Current Dockerfiles are correct but blunt. They copy the full repo and rebuild more than necessary.

### Refactors

- Convert each Dockerfile under `apps/*/Dockerfile` to multistage builds.
- Use workspace filtering so each image installs/builds only what it needs.
- Reuse generated Prisma client layers where practical.
- Keep final images slim and production-only.

### Acceptance Criteria

- Rebuild times drop materially after non-runtime file changes.
- Final images contain only runtime assets and production dependencies.

## P1. Harden Data Model for Pilot Ops

### Refactors

- Extend `marketplace_accounts` with:
  - credential type
  - validation status
  - last validation error
- Extend `sales` with:
  - `net_proceeds`
- Consider explicit enum-backed state transition guards for:
  - inventory status
  - draft review status
  - listing status

### Acceptance Criteria

- Marketplace account health is queryable without parsing freeform errors.
- Sales analytics can read net proceeds directly.

## Exit Criteria For Pilot

Do not onboard external pilot users until all P0 items are complete and validated:

- real auth
- tenant-safe writes
- production-shaped secret/deploy path
- one full E2E workflow test
- connector failure artifacts

P1 items should start immediately after P0 closes, but they do not need to block a tightly controlled pilot if the P0 set is complete.
