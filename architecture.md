# ResellerOS MVP — `architecture.md`

## 1. Purpose

This document turns `tasks.md` into a deployable system design for the MVP.

The MVP supports:
- Mac.bid lot ingestion and valuation
- inventory normalization into canonical `InventoryItem` records
- AI listing generation
- eBay publishing
- Depop publishing through browser automation
- review queue, audit logs, and execution logs
- basic sales sync and P&L
- deployment on Google Cloud Run with Terraform

The goal is a **small, production-capable, auditable system** that can onboard pilot users quickly without prematurely building a huge marketplace platform.

---

## 2. Architectural Principles

1. **Canonical inventory first**
   - Every workflow revolves around `InventoryItem`
   - marketplace listings are projections of the canonical item, not independent records

2. **All external side effects are asynchronous**
   - no direct connector mutations inside request/response paths
   - publishing, syncing, image transforms, AI generation, and scraping are queued

3. **Connectors are isolated**
   - eBay and Depop failures must not take down the core API
   - browser automation runs in a dedicated runtime

4. **Cloud Run friendly design**
   - request-serving containers are stateless
   - long-running or batch work moves to workers or jobs
   - shared state lives in managed services

5. **Auditable automation**
   - every action writes an execution log
   - every connector action is correlated to a user request, job, and marketplace account

6. **Human-in-the-loop for MVP**
   - AI recommends, user approves
   - auto-bidding is not in MVP
   - manual fallback exists for sync and sold state

---

## 3. System Context

```text
User Browser
  -> Cloud Run: web
  -> Cloud Run: api
       -> Cloud SQL Postgres
       -> Memorystore Redis / BullMQ
       -> Cloud Storage
       -> Secret Manager
       -> OpenAI API
       -> eBay APIs
       -> Cloud Run: connector-runner (internal)

Cloud Scheduler
  -> Cloud Run jobs / internal endpoints

Cloud Run: worker
  -> Redis queue
  -> Cloud SQL
  -> Cloud Storage
  -> Secret Manager
  -> OpenAI API
  -> eBay APIs

Cloud Run: connector-runner
  -> Redis queue or authenticated internal API
  -> Depop via Playwright
  -> Cloud Storage for screenshots
  -> Secret Manager for session material
```

---

## 4. Runtime Topology

### 4.1 Services

#### `reselleros-web`
Purpose:
- Next.js dashboard
- authenticated UI
- user workflows for lots, items, review queue, publishing, execution logs, P&L

Characteristics:
- public ingress
- stateless
- can call `reselleros-api` over HTTPS
- minimal server-side business logic

#### `reselleros-api`
Purpose:
- main application API
- auth/session verification
- workspace and account CRUD
- lot ingestion endpoints
- review/publish orchestration
- audit log read APIs
- webhook receivers if needed

Characteristics:
- public ingress
- stateless
- writes to Postgres
- enqueues async jobs into Redis
- never runs browser automation in-process

#### `reselleros-worker`
Purpose:
- consumes queue jobs
- AI listing generation
- image transformation
- eBay publish and sync jobs
- normalization and valuation jobs
- notifications and retries

Characteristics:
- internal-only ingress or no public traffic
- can be long-lived service polling Redis
- can scale separately from API

#### `reselleros-connector-runner`
Purpose:
- Playwright automation for Depop
- future browser-driven marketplaces
- screenshot and trace capture for failures

Characteristics:
- internal-only ingress
- isolated CPU/memory profile
- isolated IAM and secrets surface
- separate deploy cadence from API and worker

### 4.2 Jobs

#### `reselleros-db-migrate`
Purpose:
- schema migrations during deploy

#### `reselleros-sync-job`
Purpose:
- scheduled listing syncs and stale state reconciliation

#### `reselleros-backfill-job`
Purpose:
- lot backfills, recompute, reindex, repair tasks

Cloud Run supports both services and run-to-completion jobs, which is why the architecture separates request-serving apps from migrations and batch workloads. citeturn823373search8turn823373search14

---

## 5. Data Plane

### 5.1 Primary Database: Cloud SQL for PostgreSQL

Use Postgres for:
- users and workspaces
- marketplace accounts metadata
- source lots
- inventory items
- listing drafts
- platform listings
- sales
- execution logs
- audit logs
- billing state

Design notes:
- use UUID primary keys
- add `workspace_id` to all tenant-owned tables
- soft-delete where recovery matters
- use JSONB for raw marketplace payloads and AI reasoning blobs
- use explicit state enums for workflows

Cloud Run can connect to Cloud SQL directly, and Google documents Cloud Run-to-Cloud SQL integration patterns for production deployments. citeturn823373search0turn823373search23

### 5.2 Queue and Ephemeral State: Memorystore Redis

Use Redis for:
- BullMQ queues
- delayed retries
- job leases / locks
- light cache
- rate-limiting counters

Queues:
- `lot-ingestion`
- `lot-analysis`
- `item-normalization`
- `listing-generation`
- `image-processing`
- `publish-ebay`
- `publish-depop`
- `sync-ebay`
- `sync-depop`
- `notifications`
- `repairs`

### 5.3 Object Storage: Cloud Storage

Buckets:
- `reselleros-${env}-uploads`
- `reselleros-${env}-artifacts`

Store:
- user uploaded images
- transformed images
- AI intermediate exports if needed
- Playwright screenshots/traces
- CSV import files

Lifecycle rules:
- screenshots/traces: 14–30 days
- transformed images: retain unless item deleted
- temporary imports: 7 days

### 5.4 Secrets: Secret Manager

Store:
- app secrets
- Stripe keys
- OpenAI API keys
- eBay client credentials
- encryption master key reference
- marketplace account refresh tokens or references
- connector-runner session material

Secret Manager is the right managed location for application secrets and integrates cleanly with Cloud Run deployments. citeturn823373search13turn823373search6

---

## 6. Network and Security Topology

### 6.1 Ingress

Public:
- `web`
- `api`

Internal only:
- `worker`
- `connector-runner`

### 6.2 Egress

Preferred design:
- public internet egress for OpenAI and eBay
- managed path to Cloud SQL
- managed path to Redis
- direct VPC egress only if private networking requirements force it

Google currently recommends Direct VPC egress over Serverless VPC Access connectors when sending Cloud Run traffic to a VPC, so default to that only when needed rather than introducing a connector by habit. citeturn823373search5turn823373search21

### 6.3 IAM

Create dedicated service accounts:
- `sa-web`
- `sa-api`
- `sa-worker`
- `sa-connector-runner`
- `sa-job-runner`

Grant least privilege:
- web: invoke api if needed, read minimal secrets if any
- api: Cloud SQL client, Secret Manager accessor, Storage object admin on app buckets, Logging write
- worker: same as api plus broader bucket write
- connector-runner: limited secret access, bucket write for screenshots, Logging write
- jobs: Cloud SQL client, secret access, bucket read/write as needed

### 6.4 Encryption

- enable default Google-managed encryption at rest
- optionally add CMEK later, not MVP-critical
- encrypt marketplace credentials before persistence; store ciphertext and secret refs, never plaintext

---

## 7. Application Architecture

### 7.1 Monorepo Layout

```text
/apps
  web/
  api/
  worker/
  connector-runner/
  jobs/

/packages
  config/
  db/
  auth/
  billing/
  queue/
  ai/
  images/
  macbid/
  marketplaces/
  marketplaces-ebay/
  marketplaces-depop/
  observability/
  types/
  ui/

/infra/terraform
  envs/
  modules/
```

### 7.2 Package Boundaries

#### `packages/db`
- schema
- migrations
- typed query helpers
- transactional units of work

#### `packages/queue`
- BullMQ queue factories
- job names and payload schema
- dead-letter handling
- idempotency helpers

#### `packages/macbid`
- ingestion client or scraper
- lot normalization
- lot-to-item extraction heuristics
- valuation prompts

#### `packages/ai`
- prompt templates
- structured outputs
- retry and timeout policy
- model selection policy

#### `packages/marketplaces`
Defines common interfaces:
- `publishListing()`
- `updateListing()`
- `delistListing()`
- `syncListing()`
- `testConnection()`

#### `packages/marketplaces-ebay`
- official API adapter
- OAuth/token rotation
- category/attribute mapping

#### `packages/marketplaces-depop`
- form-filling automation
- DOM selector maps
- screenshot and trace capture
- anti-flake wait strategy

---

## 8. Canonical Domain Model

### 8.1 Core Entity Relationships

```text
Workspace
  -> MarketplaceAccount[]
  -> SourceLot[]
  -> InventoryItem[]

SourceLot
  -> InventoryItem[]

InventoryItem
  -> ListingDraft[]
  -> PlatformListing[]
  -> Sale?
  -> ExecutionLog[]

MarketplaceAccount
  -> PlatformListing[]
  -> ConnectorSession?
```

### 8.2 MVP Tables

#### `workspaces`
- id
- owner_user_id
- name
- plan
- billing_customer_id
- created_at

#### `marketplace_accounts`
- id
- workspace_id
- platform
- display_name
- status
- secret_ref
- last_sync_at
- created_at

#### `source_lots`
- id
- workspace_id
- source_platform
- external_id
- title
- source_url
- raw_metadata_json
- estimated_resale_min
- estimated_resale_max
- recommended_max_bid
- confidence_score
- status
- created_at

#### `inventory_items`
- id
- workspace_id
- source_lot_id nullable
- sku
- title
- brand
- category
- condition
- size nullable
- color nullable
- attributes_json
- image_manifest_json
- quantity
- cost_basis
- estimated_resale_min
- estimated_resale_max
- price_recommendation
- status
- created_at
- updated_at

#### `listing_drafts`
- id
- inventory_item_id
- platform
- generated_title
- generated_description
- generated_price
- generated_tags_json
- attributes_json
- review_status
- created_at

#### `platform_listings`
- id
- inventory_item_id
- marketplace_account_id
- platform
- external_listing_id nullable
- status
- published_title
- published_price
- external_url nullable
- last_sync_at
- raw_last_response_json
- created_at

#### `sales`
- id
- inventory_item_id
- platform_listing_id nullable
- sold_price
- fees
- shipping_cost nullable
- sold_at
- payout_status

#### `execution_logs`
- id
- workspace_id
- inventory_item_id nullable
- platform_listing_id nullable
- job_name
- connector
- status
- attempt
- correlation_id
- request_payload_json
- response_payload_json
- artifact_urls_json
- started_at
- finished_at

#### `audit_logs`
- id
- workspace_id
- actor_user_id nullable
- action
- target_type
- target_id
- metadata_json
- created_at

---

## 9. Request and Job Flows

### 9.1 Mac.bid Lot Ingestion

```text
User clicks "Import lot"
  -> API validates workspace and source URL/id
  -> API creates source_lot in PENDING state
  -> API enqueues `lot-ingestion`
  -> Worker fetches raw data
  -> Worker stores raw metadata
  -> Worker enqueues `lot-analysis`
  -> Worker generates resale estimate + recommended max bid
  -> UI shows analyzed lot
```

### 9.2 Convert Lot to Inventory Items

```text
User clicks "Create inventory items"
  -> API enqueues `item-normalization`
  -> Worker extracts item candidates
  -> Worker persists inventory_items in DRAFT state
  -> UI presents editable item records
```

### 9.3 AI Listing Generation

```text
User selects item + platform(s)
  -> API enqueues `listing-generation`
  -> Worker reads item data and images
  -> Worker calls AI for structured listing draft
  -> Worker persists listing_drafts
  -> UI review queue updates
```

### 9.4 Publish to eBay

```text
User clicks publish
  -> API validates approved review state
  -> API creates execution_log and enqueues `publish-ebay`
  -> Worker calls eBay adapter
  -> Worker persists platform_listing status
  -> Worker updates execution_log
```

### 9.5 Publish to Depop

```text
User clicks publish
  -> API validates approved review state
  -> API creates execution_log and enqueues `publish-depop`
  -> Connector-runner receives job
  -> Playwright opens session
  -> fills listing form and uploads images
  -> stores screenshot/traces in Cloud Storage
  -> persists result via API or DB
  -> updates execution_log
```

### 9.6 Sync and Reconciliation

```text
Cloud Scheduler triggers sync job
  -> Cloud Run sync job enumerates accounts/listings by due time
  -> enqueues sync jobs
  -> worker runs sync-ebay
  -> connector-runner runs sync-depop only where feasible
  -> stale/failed states surface in dashboard
```

---

## 10. Failure Handling and Reliability

### 10.1 Idempotency

Every queued action gets:
- `correlation_id`
- `idempotency_key`
- bounded retry policy
- execution log row before side effect

Recommended key examples:
- `publish:${platform}:${draft_id}:${revision}`
- `sync:${platform_listing_id}:${sync_window}`

### 10.2 Retries

- network failures: retry with exponential backoff
- auth failures: mark account `needs_reauth`
- selector failures in Depop: capture screenshot and promote to actionable operator error
- AI validation failures: one repair pass, then mark for manual review

### 10.3 Dead Letter Handling

Jobs exceeding retry budget go to DLQ metadata state in Redis and are mirrored into `execution_logs` with status `DEAD_LETTERED`.

### 10.4 Operator Visibility

For every failed connector action expose:
- timestamp
- platform
- item
- attempt count
- normalized error code
- human-readable next step
- screenshot link if browser automation

---

## 11. Cloud Run Sizing Guidance

### 11.1 `web`
- CPU: 1
- Memory: 512Mi–1Gi
- Min instances: 0 for dev, 1 for prod if latency matters
- Concurrency: 40–80

### 11.2 `api`
- CPU: 1–2
- Memory: 1Gi
- Min instances: 0 dev, 1 prod
- Concurrency: 20–40

### 11.3 `worker`
- CPU: 1–2
- Memory: 1Gi–2Gi
- Min instances: 1 in prod if polling Redis continuously
- Concurrency: 1 if one process handles multiple queues internally; otherwise low concurrency

### 11.4 `connector-runner`
- CPU: 2
- Memory: 2Gi–4Gi
- Min instances: 0 or 1 depending on throughput
- Concurrency: 1

Cloud Run supports tuning concurrency and minimum instances for services, which is why these services are split rather than merged into a single catch-all container. citeturn823373search15turn823373search17turn823373search8

---

## 12. CI/CD Architecture

### 12.1 Build

Use GitHub Actions to:
- run lint, typecheck, tests
- build service images
- push images to Artifact Registry
- run Terraform plan/apply per environment
- run DB migrations as Cloud Run job
- deploy Cloud Run services

### 12.2 Environment Strategy

Environments:
- `dev`
- `staging`
- `prod`

Recommended project pattern:
- `reselleros-dev`
- `reselleros-staging`
- `reselleros-prod`

### 12.3 Deploy Order

1. Terraform plan/apply infra changes
2. build images and push to Artifact Registry
3. update migration job image
4. execute migration job
5. deploy api
6. deploy worker
7. deploy connector-runner
8. deploy web
9. smoke tests

---

## 13. Terraform Layout

```text
infra/terraform/
  versions.tf
  providers.tf
  variables.tf
  main.tf
  outputs.tf
  terraform.tfvars.example
  modules/
    cloud_run_service/
    cloud_run_job/
  envs/
    dev.tfvars
    staging.tfvars
    prod.tfvars
```

### 13.1 Managed Resources

- Service enablement
- Artifact Registry repository
- Cloud SQL instance + database + user
- Memorystore Redis instance
- Cloud Storage buckets
- Secret Manager secrets
- service accounts and IAM bindings
- Cloud Run services
- Cloud Run jobs
- Cloud Scheduler jobs

### 13.2 Resource Notes

Use `google_cloud_run_v2_service` for services because HashiCorp recommends the v2 resource and it supports modern Cloud Run features better than the older v1 resource. citeturn823373search3turn823373search9

---

## 14. Observability

### 14.1 Logging

All apps log structured JSON with:
- severity
- service
- environment
- correlation_id
- workspace_id where available
- user_id where available
- job_name where available
- connector and platform where relevant

### 14.2 Metrics

Track:
- queue depth per queue
- job latency per job type
- publish success rate by platform
- sync success rate by platform
- AI generation latency and failure rate
- connector-runner failure rate
- error rate by service

### 14.3 Alerting

Basic prod alerts:
- API 5xx spike
- worker heartbeat absent
- Redis unavailable
- Cloud SQL connection saturation
- connector-runner failures above threshold

---

## 15. Security and Compliance Notes

- do not store plaintext marketplace passwords in DB rows
- prefer OAuth where available
- session material for browser automation must be encrypted and rotated
- sanitize logs to avoid leaking secrets and tokens
- all internal endpoints require IAM-authenticated invocation where possible
- bucket access should not be public
- use signed URLs for screenshot access if exposed to users

---

## 16. MVP Deployment Recommendation

### 16.1 First Production Cut

Deploy:
- 1 Cloud SQL Postgres instance
- 1 Redis instance
- 2 GCS buckets
- 4 Cloud Run services
- 3 Cloud Run jobs
- 2–3 Cloud Scheduler jobs
- 1 Artifact Registry repo
- Secret Manager for all app and third-party credentials

### 16.2 Explicit Non-Goals for MVP Infra

Do not add yet:
- GKE
- service mesh
- Pub/Sub fanout complexity unless Redis polling proves insufficient
- Kubernetes operators
- multi-region active/active
- advanced private networking unless required by org policy

---

## 17. Decisions Locked for Codex

1. Build the system as a TypeScript monorepo.
2. Use Cloud Run as the primary compute substrate.
3. Use Cloud SQL Postgres as system of record.
4. Use Redis/BullMQ for orchestration.
5. Use Cloud Storage for images and connector artifacts.
6. Isolate Playwright in `connector-runner`.
7. Make all marketplace mutations async and auditable.
8. Keep user approval in the publish flow.
9. Ship eBay + Depop only for MVP.
10. Treat live marketplace as post-MVP.

