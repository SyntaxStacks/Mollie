# Marketplace Connectors Task Plan

## Goal

Turn Mollie's current marketplace layer into a scalable connector framework that:

- preserves the existing MVP and queue-backed publish model
- distinguishes shared capabilities from marketplace-native feature families
- keeps automation-class connectors isolated
- makes connector readiness, health, and feature support explicit in code and UI

## Non-Goals

Do not attempt these immediately:

- full live automation for Poshmark, Depop, or Whatnot
- a unified lowest-common-denominator connector that erases marketplace differences
- broad Prisma expansion for every future entity before the runtime needs it
- real-time collaboration or websocket-based connector status streams
- stealth, evasion, or policy-bypassing automation tactics

## Workstreams

### Workstream 1: Connector Domain Model

#### 1.1 Introduce shared connector enums and interfaces

Task:

- add connector-oriented enums and interfaces to `packages/types`
- include capability, feature-family, execution-mode, and health-taxonomy primitives

Acceptance criteria:

- types exist for connector capabilities, feature families, execution modes, and health states
- the types cover eBay, Depop, Poshmark, and Whatnot without forcing feature parity

Repo targets:

- `packages/types/src/index.ts`
- possibly `packages/marketplaces/src/index.ts`

#### 1.2 Add capability matrix types

Task:

- define a typed structure describing whether a connector supports a shared capability
- include support state such as `SUPPORTED`, `UNSUPPORTED`, `MANUAL_ONLY`, `SIMULATED`, `PLANNED`

Acceptance criteria:

- matrix type can be attached to an adapter or serialized to the UI
- matrix covers the shared capability set used in the architecture doc

Repo targets:

- `packages/types/src/index.ts`
- `packages/marketplaces/src/index.ts`

#### 1.3 Add feature-family matrix types

Task:

- define first-class feature-family declarations
- include at minimum:
  - `EBAY_POLICY_CONFIGURATION`
  - `DEPOP_PROMOTION`
  - `POSHMARK_SOCIAL`
  - `WHATNOT_LIVE_SELLING`

Acceptance criteria:

- feature-family types are reusable across API, UI, and adapter code
- feature families are clearly separate from shared capabilities

Repo targets:

- `packages/types/src/index.ts`

#### 1.4 Add execution-mode types

Task:

- define explicit execution mode enums for:
  - `API`
  - `OAUTH_API`
  - `BROWSER_SESSION`
  - `LOCAL_AGENT`
  - `SIMULATED`
  - `MANUAL`

Acceptance criteria:

- every connector can declare its mode in code
- UI and execution logs can reference the same vocabulary

Repo targets:

- `packages/types/src/index.ts`

#### 1.5 Add connector health taxonomy types

Task:

- define connector health states that can unify current eBay and automation readiness models without erasing their details

Acceptance criteria:

- health taxonomy supports current repo states and future degradation reasons
- types support both account-level and feature-family-level readiness

Repo targets:

- `packages/types/src/index.ts`

### Workstream 2: Adapter Contract Refactor

#### 2.1 Normalize adapter interfaces

Task:

- evolve `MarketplaceAdapter` into a richer contract that includes descriptor metadata and optional methods for common lifecycle operations

Acceptance criteria:

- adapters expose a consistent descriptor
- unsupported actions are explicit, not implied by absence

Repo targets:

- `packages/marketplaces/src/index.ts`

#### 2.2 Add capability and feature-family declarations to eBay

Task:

- make `packages/marketplaces-ebay` declare:
  - supported shared capabilities
  - supported feature families
  - execution mode
  - fallback mode

Acceptance criteria:

- eBay clearly advertises itself as the strongest API-oriented connector
- eBay policy/default behavior maps to `EBAY_POLICY_CONFIGURATION`

Repo targets:

- `packages/marketplaces-ebay/src/index.ts`

#### 2.3 Add capability and feature-family declarations to automation markets

Task:

- make Depop, Poshmark, and Whatnot explicitly declare:
  - automation execution mode
  - supported shared capabilities
  - native feature families

Acceptance criteria:

- Depop maps to `DEPOP_PROMOTION`
- Poshmark maps to `POSHMARK_SOCIAL`
- Whatnot maps to `WHATNOT_LIVE_SELLING`
- current simulated status is intentional and visible

Repo targets:

- `packages/marketplaces-depop/src/index.ts`
- `packages/marketplaces-poshmark/src/index.ts`
- `packages/marketplaces-whatnot/src/index.ts`

#### 2.4 Align connector-runner job payloads with the contract

Task:

- extend queue payloads and execution metadata so automation jobs can identify capability and feature-family context

Acceptance criteria:

- connector jobs can say which shared action and which feature family they are executing
- execution logs can trace this without string parsing

Repo targets:

- `packages/queue/src/index.ts`
- `apps/connector-runner/src/jobs.ts`
- `apps/worker/src/jobs.ts`

### Workstream 3: Persistence Model Alignment

#### 3.1 Review Prisma models against connector needs

Task:

- map current `MarketplaceAccount`, `PlatformListing`, and `ExecutionLog` fields to the conceptual connector model
- identify gaps that need real persistence instead of metadata JSON

Acceptance criteria:

- written gap analysis exists in code comments, docs, or follow-up tasks
- no speculative schema churn without a concrete usage path

Repo targets:

- `packages/db/prisma/schema.prisma`
- `packages/db/src/index.ts`

#### 3.2 Add connector health snapshot state if needed

Task:

- decide whether current health data on `MarketplaceAccount` is enough
- if not, introduce a focused snapshot/history model

Acceptance criteria:

- current or new model can represent degraded, blocked, expired, and manual-only states cleanly

Repo targets:

- `packages/db/prisma/schema.prisma`
- `packages/db/src/index.ts`

#### 3.3 Add marketplace feature state if needed

Task:

- add persistence for feature-family readiness only when runtime/UI logic needs durable state beyond transient derivation

Acceptance criteria:

- eBay policy-configuration readiness and future native-family readiness can be represented without overloading freeform metadata

Repo targets:

- `packages/db/prisma/schema.prisma`
- `packages/db/src/index.ts`

#### 3.4 Align execution logs to connector actions

Task:

- ensure `ExecutionLog` can map to:
  - connector action
  - feature-family action
  - execution mode

Acceptance criteria:

- `/executions` can explain what happened in connector terms, not only queue-job names

Repo targets:

- `packages/db/prisma/schema.prisma`
- `apps/api/src/routes/logs.ts`
- `packages/db/src/index.ts`

### Workstream 4: Connector-Runner Hardening

#### 4.1 Standardize automation-class execution handling

Task:

- formalize the connector-runner boundary for all `BROWSER_SESSION` and similar high-risk jobs

Acceptance criteria:

- automation jobs stay out of the normal worker path
- job routing is explicit and test-covered

Repo targets:

- `apps/connector-runner/src/jobs.ts`
- `apps/worker/src/jobs.ts`
- `packages/queue/src/index.ts`

#### 4.2 Define artifact capture standards

Task:

- standardize what automation failures should capture:
  - screenshot
  - selector or step context
  - connector action metadata

Acceptance criteria:

- artifact capture is consistent across automation-class markets
- `/executions` and support tooling can rely on the same fields

Repo targets:

- `packages/artifacts/src/index.ts`
- `apps/connector-runner/src/jobs.ts`
- `apps/api/src/routes/logs.ts`

#### 4.3 Improve retry and pause classification

Task:

- classify failures into retryable, pause-worthy, manual-only, and credential/session repair categories

Acceptance criteria:

- repeated automation failures degrade connector state instead of retrying blindly
- workspace kill switch and account disablement continue to work cleanly

Repo targets:

- `packages/marketplaces/src/index.ts`
- `apps/connector-runner/src/jobs.ts`
- `packages/db/src/index.ts`

#### 4.4 Classify session and auth failures explicitly

Task:

- separate automation session expiry, selector drift, and auth blocking from generic failure states

Acceptance criteria:

- readiness UI can distinguish session refresh work from deeper connector breakage

Repo targets:

- `packages/types/src/index.ts`
- `packages/marketplaces/src/index.ts`
- `apps/api/src/routes/marketplace-accounts.ts`

### Workstream 5: UI Readiness Surfaces

#### 5.1 Extend `/marketplaces`

Task:

- expose both connector readiness and feature-family readiness

Acceptance criteria:

- operators can see not only whether an account is connected, but which marketplace-native features are usable, blocked, simulated, or manual-only

Repo targets:

- `apps/web/app/marketplaces/page.tsx`
- `apps/api/src/routes/marketplace-accounts.ts`

#### 5.2 Show degraded and manual-only states clearly

Task:

- make blocked, degraded, simulated, and manual-only states explicit in operator copy and badges

Acceptance criteria:

- users are not misled into thinking all connected accounts are equally capable

Repo targets:

- `apps/web/app/marketplaces/page.tsx`
- `apps/web/app/inventory/[id]/page.tsx`
- `apps/web/components/inventory-detail-view.tsx`

#### 5.3 Expose marketplace-native actions intentionally

Task:

- when native feature families become real, add them as clearly named operator actions instead of hiding them inside generic listing controls

Acceptance criteria:

- Poshmark social features, Depop promotion actions, Whatnot live actions, and eBay policy configuration each have appropriate surfaces

Repo targets:

- `apps/web/app/marketplaces/page.tsx`
- `apps/web/app/inventory/[id]/page.tsx`
- future marketplace-specific UI helpers under `apps/web/components`

### Workstream 6: Operator Guidance and Copy System

#### 6.1 Define shared operator-state copy vocabulary

Task:

- map connector and feature-family states into plain-language operator messages
- define patterns for:
  - blocked
  - degraded
  - simulated
  - manual-only
  - ready
  - configured

Acceptance criteria:

- engineers can render consistent status copy across marketplaces
- system state names are not dumped directly into the UI without explanation

Repo targets:

- `packages/types/src/index.ts`
- `apps/api/src/routes/marketplace-accounts.ts`
- `apps/web/app/marketplaces/page.tsx`
- `apps/web/app/inventory/[id]/page.tsx`
- `apps/web/app/executions/page.tsx`

#### 6.2 Add contextual hint payload support

Task:

- define how API responses can include operator-friendly hint data
- support:
  - message
  - severity
  - next actions
  - optional route target
  - optional feature-family context

Acceptance criteria:

- marketplace, account, item, and execution surfaces can render hints without duplicating logic in every component

Repo targets:

- `packages/types/src/index.ts`
- `apps/api/src/routes/*`
- relevant serializer or view-model layers in `apps/api`

#### 6.3 Improve `/marketplaces` guidance

Task:

- add copy and hints explaining connection state, readiness, and next actions
- distinguish live, simulated, blocked, degraded, and manual-only states clearly

Acceptance criteria:

- operators know what to do next from the marketplaces screen alone

Repo targets:

- `apps/web/app/marketplaces/page.tsx`
- `apps/api/src/routes/marketplace-accounts.ts`

#### 6.4 Improve `/inventory/[id]` guidance

Task:

- add item-level hints for publish blockers and next steps
- guide operators through missing photos, missing draft approval, missing marketplace config, missing category mapping, and similar blockers

Acceptance criteria:

- blocked item states include actionable next steps, not just failed checks

Repo targets:

- `apps/web/app/inventory/[id]/page.tsx`
- `apps/web/components/inventory-detail-view.tsx`
- relevant API routes returning publish readiness

#### 6.5 Improve `/executions` guidance

Task:

- add operator-centered failure and retry guidance
- tell operators whether they should retry, reconnect, wait, or switch to manual handling

Acceptance criteria:

- execution failures are understandable without reading raw payloads first

Repo targets:

- `apps/web/app/executions/page.tsx`
- `apps/api/src/routes/logs.ts`

#### 6.6 Add marketplace-native hint coverage

Task:

- ensure hints can reflect feature-family context:
  - `EBAY_POLICY_CONFIGURATION`
  - `POSHMARK_SOCIAL`
  - `DEPOP_PROMOTION`
  - `WHATNOT_LIVE_SELLING`

Acceptance criteria:

- hints are not generic when the issue is marketplace-specific

Repo targets:

- `packages/types/src/index.ts`
- `apps/api/src/routes/marketplace-accounts.ts`
- marketplace-specific readiness evaluators if present

#### 6.7 Add test coverage for operator guidance

Task:

- test that blocked, degraded, manual-only, simulated, and configured states produce useful operator copy
- test that secrets are still redacted
- test that hints include next steps when appropriate

Acceptance criteria:

- hint rendering and API hint payloads are covered by contract or UI tests

Repo targets:

- `tests/api/*`
- `tests/e2e/*`
- `tests/ui/*`

### Workstream 7: Documentation and Test Strategy

#### 7.1 Add adapter declaration tests

Task:

- ensure every connector exports descriptor metadata and capability declarations

Acceptance criteria:

- tests fail when a connector forgets to declare capabilities, feature families, execution mode, or fallback mode

Repo targets:

- `tests/api`
- `tests/connectors`

#### 7.2 Add health-state tests

Task:

- verify readiness and degradation mapping for eBay and automation-class markets

Acceptance criteria:

- tests cover blocked, error, simulated, and live-ready/manual-only scenarios

Repo targets:

- `tests/api/ebay-oauth.test.ts`
- `tests/api`
- `tests/e2e/workflow.test.ts`

#### 7.3 Add execution-log redaction and mapping tests

Task:

- ensure connector-action metadata and feature-family metadata are visible while secrets remain redacted

Acceptance criteria:

- `/executions` remains useful without leaking tokens or raw secret refs

Repo targets:

- `tests/api/execution-logs.test.ts`
- `apps/api/src/routes/logs.ts`

#### 7.4 Cross-link docs from README

Task:

- link the connector architecture and task docs from `README.md`

Acceptance criteria:

- a new engineer can find the connector design docs from the main repo entrypoint

Repo targets:

- `README.md`
- `docs/architecture-marketplace-connectors.md`
- `docs/tasks-marketplace-connectors.md`

## Suggested File Touch Points

Likely repo areas for implementation:

- `README.md`
- `docs/*`
- `apps/api/src/routes/*`
- `apps/worker/src/jobs.ts`
- `apps/connector-runner/src/jobs.ts`
- `apps/jobs/*`
- `apps/web/app/marketplaces/page.tsx`
- `apps/web/app/inventory/[id]/page.tsx`
- `apps/web/app/executions/page.tsx`
- `packages/types/src/index.ts`
- `packages/marketplaces/src/index.ts`
- `packages/marketplaces-ebay/src/index.ts`
- `packages/marketplaces-depop/src/index.ts`
- `packages/marketplaces-poshmark/src/index.ts`
- `packages/marketplaces-whatnot/src/index.ts`
- `packages/queue/src/index.ts`
- `packages/db/src/index.ts`
- `packages/db/prisma/schema.prisma`
- `packages/artifacts/src/index.ts`

## Acceptance Checklist

- Shared connector capability vocabulary exists and is documented.
- Marketplace-native feature families are explicit and not flattened into generic listing CRUD.
- eBay remains the strongest API-oriented reference connector.
- Depop, Poshmark, and Whatnot remain intentionally modeled as automation-class connectors.
- `connector-runner` isolation is preserved and documented.
- Health, degradation, and execution observability are first-class in the connector plan.
- UI surfaces for `/marketplaces`, `/executions`, and item flows are called out explicitly.
- The task plan points to real repo locations rather than imaginary modules.
