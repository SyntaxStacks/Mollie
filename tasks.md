# ResellerOS MVP — `tasks.md`

## 0. Objective

Build the MVP for a SaaS product that helps liquidation resellers:
- discover and evaluate inventory from Mac.bid,
- turn acquired inventory into normalized items,
- generate marketplace-ready listings with AI,
- publish to eBay and Depop for MVP,
- track listing state, sales state, and basic P&L,
- run on Google Cloud Run with production-grade deployment, secrets, observability, and background workers.

This file is intended for Codex / implementation agents. Default bias: ship the smallest production-capable version that can onboard pilot users quickly.

---

## 1. Product Definition

### 1.1 MVP Promise

**Buy smarter, list faster, track profit automatically.**

### 1.2 Target User

Liquidation and arbitrage resellers who:
- source from Mac.bid or similar auction platforms,
- manually list inventory across marketplaces today,
- want faster listing creation and better resale decisions,
- can tolerate an operator workflow for some steps during MVP.

### 1.3 MVP Scope

In scope:
- User auth and billing skeleton
- Seller account workspace
- Mac.bid lot ingestion / watcher
- AI lot analysis and bid recommendation
- Inventory normalization
- AI listing generation
- eBay connector (primary)
- Depop connector (automation-based)
- Manual review queue before publish
- Listing state tracking
- Basic sales sync / manual mark sold fallback
- P&L dashboard
- Audit logs and execution logs
- Google Cloud Run deployment

Out of scope:
- Live marketplace / streaming
- Buyer-facing auction marketplace
- Mobile app
- Mercari / Poshmark / Whatnot connectors
- Full autonomous bidding
- Advanced repricing engine
- Multi-tenant enterprise features

---

## 2. Success Criteria

### 2.1 Product Success
- User can connect at least one eBay account and one Depop session.
- User can ingest a Mac.bid lot and see estimated resale value + recommended max bid.
- User can convert a lot into one or more inventory items.
- User can generate AI listing drafts with title, description, attributes, price suggestion, and tags.
- User can publish an item to eBay and Depop from one review screen.
- User can see execution status for each publish action.
- User can track sold / unsold inventory and estimated realized profit.

### 2.2 Engineering Success
- System is deployable with one command per environment.
- All external actions are queued, idempotent, and auditable.
- Background jobs can recover from partial failure.
- Connector failures include actionable error detail.
- No secrets are hardcoded.
- Critical services have health checks, logs, and metrics.

---

## 3. Architecture Overview

## 3.1 High-Level Architecture

Use a modular monorepo with clear service boundaries.

### Runtime Components
1. **web-app**
   - Next.js app for dashboard + API routes only where appropriate
   - Deployed to Cloud Run service

2. **api-service**
   - Main backend REST API
   - Handles auth, inventory, listings, workflows, audit logs
   - Deployed to Cloud Run service

3. **worker-service**
   - Background queue worker for AI generation, publish jobs, sync jobs, image processing
   - Deployed to Cloud Run service with no public ingress or to Cloud Run jobs where suitable

4. **connector-runner**
   - Playwright-capable worker for Depop automation and future non-API connectors
   - Separate Cloud Run service or job to isolate browser dependencies and failures

5. **scheduler / cron entrypoints**
   - Scheduled tasks for sync, stale listing checks, Mac.bid watchers
   - Triggered via Cloud Scheduler -> authenticated HTTP endpoint or Cloud Run jobs

6. **db**
   - Cloud SQL for PostgreSQL

7. **cache / queue**
   - Redis-compatible queue store
   - Prefer Memorystore Redis if budget allows; otherwise start with self-hosted Redis only if absolutely necessary

8. **artifact storage**
   - Cloud Storage bucket for uploaded images, transformed images, logs, connector screenshots

9. **secrets**
   - Secret Manager

10. **container registry**
   - Artifact Registry

### Recommended GCP Topology
- Project: `reselleros-{env}`
- Region: `us-central1` or nearest single-region choice for MVP consistency
- Services:
  - `reselleros-web`
  - `reselleros-api`
  - `reselleros-worker`
  - `reselleros-connector-runner`
- Jobs:
  - `reselleros-sync-job`
  - `reselleros-backfill-job`
  - `reselleros-db-migrate`
- Datastores:
  - Cloud SQL Postgres
  - Memorystore Redis
  - Cloud Storage bucket
- Infra support:
  - Secret Manager
  - Cloud Scheduler
  - Artifact Registry
  - Cloud Logging / Monitoring / Error Reporting

---

## 4. Why Cloud Run for MVP

Use Cloud Run because it supports stateless containers for HTTP services and can also run one-off or batch workloads through Cloud Run jobs. Cloud Run services can configure concurrency and minimum instances, while jobs are appropriate for containers that run tasks and exit. Cloud Run also integrates with Secret Manager and Cloud SQL.  

Implementation notes for architecture decisions:
- Keep **web-app** and **api-service** as Cloud Run services.
- Keep long-running async work out of request paths.
- Use **Cloud Run jobs** for migrations, backfills, and heavyweight batch tasks.
- Use **services** for continuously polling workers only if queue semantics require it; otherwise prefer scheduled execution or event-driven triggers.

---

## 5. Monorepo Structure

```text
/apps
  /web                  # Next.js dashboard
  /api                  # Backend API service
  /worker               # Queue consumers / async workflows
  /connector-runner     # Playwright automation service
  /jobs                 # Batch entrypoints (sync, backfill, migrate)

/packages
  /config               # Shared config / env validation
  /db                   # Prisma / Drizzle schema and client
  /auth                 # Auth helpers / session logic
  /billing              # Stripe integration
  /queue                # Queue abstraction
  /events               # Domain events / contracts
  /ai                   # AI client wrappers and prompt templates
  /images               # Image transforms / metadata extraction
  /marketplaces         # Marketplace domain interfaces
  /marketplaces-ebay    # eBay adapter
  /marketplaces-depop   # Depop adapter / automation flows
  /macbid               # Mac.bid scraping + normalization
  /observability        # Logging, tracing, metrics helpers
  /types                # Shared DTOs / types
  /ui                   # Shared UI components

/infra
  /cloudrun             # service YAMLs or terraform modules
  /github-actions       # CI/CD workflows
  /scripts              # deploy / migrate / bootstrap scripts

/docs
  architecture.md
  runbooks.md
  connector-policies.md
```

---

## 6. Technical Stack

### Required Stack
- **TypeScript** across frontend and backend where possible
- **Next.js** for dashboard
- **Node.js** backend API
- **PostgreSQL** for primary DB
- **Redis + BullMQ** or equivalent for queueing
- **Prisma** or Drizzle ORM
- **Playwright** for Depop automation
- **Stripe** for billing
- **OpenAI API** or pluggable LLM provider for listing generation and lot summaries
- **Cloud Storage** for images and screenshots

### Nice-to-have if time allows
- OpenTelemetry tracing
- Zod env validation and DTO validation
- Typed event contracts
- Feature flagging

---

## 7. Domain Model

Design around the canonical object: **InventoryItem**.

### Core Entities

#### User
- id
- email
- name
- created_at
- last_login_at

#### Workspace
- id
- owner_user_id
- name
- plan
- billing_customer_id
- created_at

#### MarketplaceAccount
- id
- workspace_id
- platform (`ebay`, `depop`)
- display_name
- status (`connected`, `needs_reauth`, `error`, `disabled`)
- encrypted_credentials_ref / secret_ref
- last_sync_at

#### SourceLot
- id
- workspace_id
- source_platform (`macbid`)
- external_id
- title
- raw_metadata_json
- source_url
- location
- ends_at
- current_bid
- ai_estimated_resale_low
- ai_estimated_resale_high
- ai_recommended_max_bid
- ai_risk_score
- ingest_status

#### InventoryItem
- id
- workspace_id
- source_lot_id nullable
- sku
- title_canonical
- brand
- category
- condition
- size
- color
- notes
- cost_basis
- quantity
- status (`draft`, `ready`, `listed`, `partially_listed`, `sold`, `archived`)
- image_set_id
- created_at

#### ImageAsset
- id
- workspace_id
- storage_path
- source_type (`upload`, `source_lot`, `generated`, `connector_screenshot`)
- width
- height
- sort_order
- metadata_json

#### ListingDraft
- id
- workspace_id
- inventory_item_id
- ai_title
- ai_description
- ai_price_suggested
- ai_tags_json
- ai_attributes_json
- review_status (`pending`, `approved`, `rejected`, `edited`)
- generated_at

#### PlatformListing
- id
- workspace_id
- inventory_item_id
- marketplace_account_id
- platform
- external_listing_id nullable
- publish_status (`queued`, `publishing`, `live`, `failed`, `ended`, `sold`)
- publish_error_code nullable
- publish_error_message nullable
- listing_url nullable
- listed_price
- raw_response_json
- created_at
- updated_at

#### Sale
- id
- workspace_id
- inventory_item_id
- platform_listing_id
- sold_price
- platform_fees
- shipping_cost nullable
- net_proceeds
- sold_at
- raw_sale_json

#### AutomationExecution
- id
- workspace_id
- job_type
- target_type
- target_id
- status (`queued`, `running`, `succeeded`, `failed`, `cancelled`)
- idempotency_key
- started_at
- finished_at
- log_blob_path nullable
- screenshot_blob_path nullable
- error_summary nullable

#### AuditLog
- id
- workspace_id
- actor_type (`user`, `system`)
- actor_id nullable
- action
- entity_type
- entity_id
- metadata_json
- created_at

---

## 8. System Boundaries

## 8.1 API Service Responsibilities
- auth/session verification
- workspace CRUD
- marketplace account CRUD
- source lot CRUD + analysis retrieval
- inventory CRUD
- listing draft CRUD / review workflow
- enqueue publish jobs
- sales and P&L queries
- audit log queries
- webhook handlers (Stripe, eBay if applicable)

## 8.2 Worker Responsibilities
- run AI enrichment jobs
- run image processing jobs
- run eBay publish jobs
- run sync jobs
- run stale listing checks
- update execution status

## 8.3 Connector Runner Responsibilities
- execute Playwright-based Depop publish flow
- capture screenshots on each important step
- return structured failure reasons
- keep connector logic isolated from business logic

## 8.4 Jobs Responsibilities
- DB migration
- backfill data
- periodic sync / cleanup
- reprocess failed jobs

---

## 9. Marketplace Strategy

## 9.1 eBay (Primary Connector)
Implement first because official APIs reduce fragility.

MVP eBay capabilities:
- connect seller account
- create listing
- update listing status
- fetch sold status or manual sync fallback
- fetch listing URL / external ID

Do not overbuild:
- no full repricer
- no deep category wizard
- no full analytics parity

## 9.2 Depop (Automation Connector)
Implement second as a constrained automation flow.

MVP Depop capabilities:
- store session securely
- create listing through browser automation
- support title, description, price, category, size, brand, hashtags, images
- capture screenshots and logs
- manual retry flow

Important constraints:
- low publish rate
- random delays
- no aggressive bulk automation
- build operator-visible safeguards

---

## 10. Mac.bid Ingestion Strategy

### MVP Approach
Use a watcher / scraper pipeline that can:
- ingest lot page URL manually,
- parse core lot metadata,
- download source images if allowed by current implementation assumptions,
- normalize lot fields,
- run AI summary and price estimation,
- store recommendation.

### Do first
- manual “Add Mac.bid lot URL” flow
- background fetch + parse
- AI output:
  - probable item type
  - resale range low/high
  - risk score
  - recommended max bid
  - reasons summary

### Do later
- persistent watcher for saved searches
- auto-bidding engine

---

## 11. AI Capabilities

## 11.1 Lot Analysis
Inputs:
- lot title
- lot description / manifest
- lot images
- current bid / condition text

Outputs:
- summary
- resale range low/high
- risk score 0-100
- recommended max bid
- explanation bullets

## 11.2 Listing Generation
Inputs:
- canonical inventory attributes
- images
- target platform

Outputs:
- title
- description
- price suggestion
- tags / hashtags
- structured attributes

### Prompting Rules
- platform-specific style transforms
- concise title limits per platform
- no hallucinated condition claims
- no unsupported brand authentication claims
- keep prompts versioned in code

### Acceptance Criteria
- user can regenerate drafts
- user can edit before publish
- original AI output is preserved for audit/debug

---

## 12. UX / App Screens

### Required Screens
1. Auth / onboarding
2. Workspace setup
3. Marketplace account connections
4. Add Mac.bid lot
5. Lot detail + AI valuation
6. Inventory list
7. Inventory item detail
8. Listing draft review
9. Publish modal / screen
10. Execution log screen
11. Sales / P&L dashboard
12. Settings / billing

### UX Requirements
- Every async action has explicit status.
- Every failed automation shows reason + retry path.
- Keep UI operator-centric, not consumer-polished.
- Build for desktop first.

---

## 13. Background Job Design

All external side effects must run through queue jobs.

### Job Types
- `macbid.fetchLot`
- `macbid.analyzeLot`
- `inventory.generateListingDraft`
- `images.processSet`
- `listing.publishEbay`
- `listing.publishDepop`
- `listing.syncStatus`
- `sales.sync`
- `maintenance.retryFailures`

### Queue Requirements
- idempotency keys
- retries with backoff
- dead-letter handling or failed-job view
- correlation IDs for tracing
- persist job payload version

### Acceptance Criteria
- duplicate publish requests do not create duplicate listings
- failed publish jobs are retryable
- logs link back to UI state

---

## 14. Deployment Architecture on Google Cloud Run

## 14.1 Services

### `reselleros-web`
- Cloud Run service
- public ingress
- Next.js production server
- talks only to `reselleros-api`
- min instances: 0 or 1 depending latency budget
- low to moderate concurrency

### `reselleros-api`
- Cloud Run service
- public ingress only if frontend calls directly; otherwise restrict ingress behind load balancer / authenticated callers later
- stateless
- connects to Cloud SQL and Redis
- consumes secrets from Secret Manager
- moderate concurrency

### `reselleros-worker`
- Cloud Run service
- no public ingress preferred
- internal authenticated endpoint for health or admin only
- long-poll or periodic queue consumer depending design
- separate CPU/memory from API

### `reselleros-connector-runner`
- Cloud Run service or job
- browser dependencies installed
- higher memory allocation
- lower concurrency, ideally 1 per instance for browser stability
- store screenshots in Cloud Storage

## 14.2 Jobs

### `reselleros-db-migrate`
- Cloud Run job
- runs schema migrations on deploy

### `reselleros-sync-job`
- Cloud Run job
- periodic status sync for listings / sales

### `reselleros-backfill-job`
- Cloud Run job
- reprocess inventory, regenerate drafts, or bulk fix records

## 14.3 Supporting Services
- Cloud SQL Postgres
- Memorystore Redis
- Cloud Storage bucket(s):
  - `reselleros-{env}-uploads`
  - `reselleros-{env}-artifacts`
- Secret Manager secrets:
  - `DATABASE_URL`
  - `REDIS_URL`
  - `OPENAI_API_KEY`
  - `STRIPE_SECRET_KEY`
  - `SESSION_ENCRYPTION_KEY`
  - `EBAY_CLIENT_ID`
  - `EBAY_CLIENT_SECRET`
  - connector session secrets as needed

## 14.4 Networking / Access
- service accounts per service
- least privilege IAM
- Cloud SQL connection via Cloud Run integration
- bucket IAM restricted by service account
- signed URLs for client image access if needed

---

## 15. CI/CD Requirements

## 15.1 GitHub Actions Pipeline
Create pipelines for:
- typecheck
- lint
- test
- build containers
- push to Artifact Registry
- deploy to Cloud Run
- run DB migration job

### Branch Strategy
- `main` -> staging or production depending team preference
- `develop` optional
- tagged releases optional for prod later

### Required Workflows
1. `ci.yml`
2. `deploy-staging.yml`
3. `deploy-production.yml`

### Deployment Steps
1. install deps
2. run lint/test/typecheck
3. build Docker images
4. push images to Artifact Registry
5. deploy `api`, `web`, `worker`, `connector-runner`
6. execute migration job
7. smoke test health endpoints

---

## 16. Security Requirements

### Application Security
- server-side auth checks for all workspace data
- row-level ownership enforcement in app layer at minimum
- CSRF-safe mutation strategy
- secure cookie settings
- encrypt external credentials and session material

### Secret Management
- all secrets in Secret Manager
- local dev uses `.env.local` only outside production
- secret versions pinned where appropriate

### Connector Safety
- explicit operator approval for publish
- optional dry-run mode for automation connectors
- action kill switch per workspace
- max publish rate limits

### Auditability
- record who triggered each publish action
- record job correlation ID
- record external listing IDs

---

## 17. Observability Requirements

### Logging
- structured JSON logs
- include `workspace_id`, `job_id`, `correlation_id`, `service_name`
- redact secrets and raw tokens

### Metrics
- publish success rate by platform
- queue latency
- connector failure rate
- AI generation latency / error rate
- sales sync latency

### Error Reporting
- capture exceptions centrally
- attach connector screenshot path if applicable

### Runbooks
Document operational responses for:
- eBay auth failures
- Depop session expiry
- Redis outage
- Cloud SQL connection exhaustion
- stuck queue

---

## 18. Testing Strategy

## 18.1 Unit Tests
- schema validation
- pricing helpers
- prompt rendering
- queue payload creation
- state transitions

## 18.2 Integration Tests
- DB CRUD for core entities
- publish workflow enqueue -> complete
- Stripe webhook handling
- eBay connector mocked API integration

## 18.3 E2E Tests
- sign up
- create workspace
- add inventory item
- generate draft
- approve draft
- publish to mocked connector path

## 18.4 Connector Tests
- Playwright flow tests against controlled pages or fixtures
- screenshot assertions where useful
- resilient selector strategy

---

## 19. Delivery Plan / Task Breakdown

## Phase 0 — Repo Bootstrap

### Tasks
- [ ] Initialize monorepo with apps/packages layout.
- [ ] Set up pnpm or npm workspaces.
- [ ] Add TypeScript, linting, formatting, shared tsconfig.
- [ ] Add env validation package.
- [ ] Add Dockerfiles for each app/service.
- [ ] Add base README with dev bootstrap.

### Acceptance Criteria
- local install works
- all packages build
- `docker build` succeeds for all runnable apps

---

## Phase 1 — Infrastructure Foundation

### Tasks
- [ ] Create infrastructure definitions for Cloud Run services, jobs, Cloud SQL, Redis, Storage, Artifact Registry, Secret Manager.
- [ ] Create per-service service accounts with IAM bindings.
- [ ] Create staging environment first.
- [ ] Configure domain / HTTPS only if needed for MVP.
- [ ] Add GitHub Actions workload identity or deploy credentials.
- [ ] Add migration job wiring.

### Acceptance Criteria
- staging infra can be provisioned cleanly
- all services can deploy hello-world images
- migration job can run successfully

---

## Phase 2 — Database + Core Domain

### Tasks
- [ ] Implement schema for all core entities.
- [ ] Add DB migrations.
- [ ] Add seed script for local dev.
- [ ] Create repositories / data access layer.
- [ ] Add audit log helper.
- [ ] Add idempotency helper for external actions.

### Acceptance Criteria
- migrations run locally and in Cloud Run job
- basic CRUD works for workspace, inventory, listing draft, platform listing

---

## Phase 3 — Auth + Workspace + Billing Skeleton

### Tasks
- [ ] Implement auth provider and session management.
- [ ] Build onboarding flow.
- [ ] Create workspace creation flow.
- [ ] Add Stripe customer bootstrap and subscription placeholders.
- [ ] Add plan guard middleware.

### Acceptance Criteria
- new user can create workspace
- billing customer is provisioned
- authenticated routes are protected

---

## Phase 4 — File Uploads + Image Pipeline

### Tasks
- [ ] Implement image upload to Cloud Storage.
- [ ] Persist image metadata.
- [ ] Add image ordering.
- [ ] Implement square crop / resize pipeline.
- [ ] Store derived images.
- [ ] Support item image gallery in UI.

### Acceptance Criteria
- user can upload images for inventory item
- transformed images are accessible in app

---

## Phase 5 — Inventory Core

### Tasks
- [ ] Build inventory list UI.
- [ ] Build inventory detail UI.
- [ ] Implement create/edit/delete inventory item APIs.
- [ ] Generate SKU if absent.
- [ ] Add inventory statuses and transitions.

### Acceptance Criteria
- user can manage inventory manually before Mac.bid integration exists

---

## Phase 6 — Mac.bid Manual Ingestion

### Tasks
- [ ] Build “Add Mac.bid lot URL” flow.
- [ ] Implement fetch/parse pipeline.
- [ ] Store raw lot metadata and images.
- [ ] Normalize lot fields.
- [ ] Show lot detail screen.
- [ ] Add “Create inventory from lot” action.

### Acceptance Criteria
- a valid lot URL creates a SourceLot record with parsed data
- user can convert source lot into at least one inventory item

---

## Phase 7 — AI Lot Analysis

### Tasks
- [ ] Build prompt templates for lot valuation.
- [ ] Implement AI enrichment job.
- [ ] Store resale range, risk score, max bid recommendation, summary.
- [ ] Show recommendation UI with rationale.
- [ ] Add regenerate action.

### Acceptance Criteria
- lot detail page shows AI analysis within async workflow
- errors are visible and retryable

---

## Phase 8 — AI Listing Draft Generation

### Tasks
- [ ] Implement platform-aware listing prompt templates.
- [ ] Add draft generation job.
- [ ] Generate title, description, price suggestion, tags, attributes.
- [ ] Build review/edit UI.
- [ ] Persist user edits separately from raw AI output.

### Acceptance Criteria
- user can generate and edit listing drafts for eBay and Depop

---

## Phase 9 — eBay Connector

### Tasks
- [ ] Implement eBay account connection.
- [ ] Store tokens/secrets securely.
- [ ] Build eBay publish adapter.
- [ ] Create platform listing records.
- [ ] Add status sync job.
- [ ] Show listing URL and external ID in UI.

### Acceptance Criteria
- approved inventory item can publish to eBay and reflect success/failure in UI

---

## Phase 10 — Depop Connector Runner

### Tasks
- [ ] Set up Playwright runtime in isolated service.
- [ ] Implement secure session loading.
- [ ] Build listing publish flow with selectors encapsulated.
- [ ] Support required fields: title, description, price, size, brand, category, images.
- [ ] Capture screenshots per major step.
- [ ] Build retry / failure classification.
- [ ] Add operator warnings and rate limits.

### Acceptance Criteria
- approved inventory item can publish to Depop through automation in controlled MVP flow
- failures show logs/screenshots

---

## Phase 11 — Execution Logs + Audit UX

### Tasks
- [ ] Build execution detail page.
- [ ] Show queue state, timestamps, error summaries, screenshot links.
- [ ] Expose audit trail per inventory item and listing.

### Acceptance Criteria
- operator can understand what happened for every publish attempt

---

## Phase 12 — Sales + P&L

### Tasks
- [ ] Implement sale model and basic ingestion paths.
- [ ] Add eBay sold sync or manual sold entry fallback.
- [ ] Compute gross sales, fees, net proceeds, margin.
- [ ] Build dashboard summary.

### Acceptance Criteria
- user can see per-item and aggregate P&L

---

## Phase 13 — Sync / Maintenance Jobs

### Tasks
- [ ] Create periodic sync job entrypoints.
- [ ] Integrate Cloud Scheduler triggers.
- [ ] Reconcile listing statuses.
- [ ] Retry transient failures.
- [ ] Alert on repeated connector failures.

### Acceptance Criteria
- system self-heals basic stale states without manual DB edits

---

## Phase 14 — Hardening for Pilot Users

### Tasks
- [ ] Add rate limiting.
- [ ] Add request validation everywhere.
- [ ] Add health endpoints.
- [ ] Add structured logging.
- [ ] Add alerting dashboards.
- [ ] Review IAM, secret access, and storage ACLs.
- [ ] Add seed demo data and support tooling.

### Acceptance Criteria
- system is ready for first 3–10 pilot users

---

## 20. API Surface (Initial)

### Auth / Workspace
- `POST /api/auth/*`
- `GET /api/workspace`
- `POST /api/workspace`

### Marketplace Accounts
- `GET /api/marketplace-accounts`
- `POST /api/marketplace-accounts/ebay/connect`
- `POST /api/marketplace-accounts/depop/session`
- `POST /api/marketplace-accounts/:id/disable`

### Source Lots
- `POST /api/source-lots/macbid`
- `GET /api/source-lots`
- `GET /api/source-lots/:id`
- `POST /api/source-lots/:id/analyze`
- `POST /api/source-lots/:id/create-inventory`

### Inventory
- `GET /api/inventory`
- `POST /api/inventory`
- `GET /api/inventory/:id`
- `PATCH /api/inventory/:id`
- `POST /api/inventory/:id/images`

### Listing Drafts
- `POST /api/inventory/:id/generate-drafts`
- `GET /api/inventory/:id/drafts`
- `PATCH /api/drafts/:id`
- `POST /api/drafts/:id/approve`

### Publishing
- `POST /api/inventory/:id/publish/ebay`
- `POST /api/inventory/:id/publish/depop`
- `GET /api/listings/:id`
- `POST /api/listings/:id/retry`

### Sales / Analytics
- `GET /api/sales`
- `GET /api/analytics/pnl`

---

## 21. Cloud Run Implementation Notes for Codex

### Service Container Rules
- Every service must start quickly and listen on the configured `PORT`.
- Keep request handlers stateless.
- Never perform blocking connector automation inside API request path.

### Concurrency Guidance
- API/web can use moderate concurrency.
- Connector runner should use very low concurrency, ideally 1, due to browser automation stability.
- Worker concurrency should be tuned by job type and memory footprint.

### Resource Guidance
- `web`: low CPU / moderate memory
- `api`: moderate CPU / memory
- `worker`: moderate CPU / higher memory if AI/image tasks are local-heavy
- `connector-runner`: higher memory, low concurrency

### Deployment Artifacts
Provide:
- Dockerfile per runnable app
- `.dockerignore`
- Cloud Run deploy scripts
- migration job manifest
- env var documentation

---

## 22. Local Development Requirements

### Tasks
- [ ] `docker-compose` for Postgres + Redis local dev.
- [ ] local storage shim or GCS emulator strategy if needed; otherwise use file-system dev mode.
- [ ] `.env.example` with every required variable.
- [ ] seed script with sample workspace, inventory, and listing drafts.

### Acceptance Criteria
- a new dev can run the stack locally in < 30 minutes

---

## 23. Non-Functional Requirements

- Target p95 API latency for non-AI CRUD routes: < 500ms in staging under light load
- All mutations must be authenticated
- No synchronous publish action should exceed request timeout; enqueue and return immediately
- Every publish attempt must be traceable to a user action or scheduler event
- MVP optimized for correctness and supportability over flashy UI

---

## 24. Product Decisions Locked for MVP

- Primary wedge: **AI-powered sourcing + multi-marketplace listing for liquidation resellers**
- Marketplaces for MVP: **eBay + Depop**
- Source marketplace for MVP: **Mac.bid manual URL ingestion**
- Human-in-the-loop before publish: **required**
- Live marketplace / video: **deferred**
- Autonomous bidding: **deferred**

---

## 25. Stretch Goals (Only After MVP Is Working)

- bulk import from spreadsheets
- saved Mac.bid searches
- auto-relist stale items
- pricing recommendations from sold comps
- connector health dashboard
- multi-user workspaces
- Mercari / Poshmark adapters
- low-inventory / stale-inventory alerts

---

## 26. Final Instruction to Codex

Implement the MVP in the order described above. Favor:
- boring architecture,
- explicit state machines,
- queue-backed side effects,
- observable automation,
- operator trust.

Do **not** overbuild social features, live commerce, or autonomous bidding in MVP.

When uncertain, choose the path that:
1. ships pilot-user value fastest,
2. reduces external integration fragility,
3. makes failures easy to inspect and recover from.
