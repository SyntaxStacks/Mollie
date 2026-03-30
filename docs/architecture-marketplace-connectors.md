# Marketplace Connectors Architecture

## Purpose

Mollie is a universal resale operations layer. Its job is to normalize sourcing, inventory, drafts, listings, execution logs, and operator workflows even when the underlying marketplaces have very different integration quality.

That means the connector architecture cannot assume every marketplace has:

- a stable public API
- OAuth
- the same listing lifecycle
- the same operator workflows
- the same compliance or automation boundaries

The repo already reflects this reality:

- eBay is the strongest API-oriented integration and already has OAuth, readiness evaluation, policy defaults, and a live publish direction.
- Depop, Poshmark, and Whatnot are currently automation-class connectors routed through `apps/connector-runner`.
- Publish flows are queue-backed and auditable.
- Health and readiness are already surfaced in `/marketplaces`, `/inventory/[id]`, and `/executions`.

This document formalizes how that current approach should scale.

## Core Product Thesis

Mollie should separate:

- shared operational primitives
- marketplace-specific feature families

Shared operational primitives are the common resale actions Mollie can reason about across markets, such as:

- connect an account
- validate auth or session state
- publish a listing
- sync listing state
- record connector health
- surface retries and artifacts

Marketplace-specific feature families are native workflows that matter to operators but do not fit a lowest-common-denominator model. Examples:

- eBay business policies and aspect validation
- Poshmark closet and social actions
- Depop bump and promotion mechanics
- Whatnot live show and auction workflows

Mollie should not flatten those native behaviors into generic listing CRUD. Doing so would erase product value and create misleading abstractions.

## Architectural Principles

### Canonical Internal Model

Mollie owns the internal operational model, but the repo is not starting from a blank schema. This architecture should distinguish between:

- current repo entities that already exist in code or persistence
- conceptual future entities that are useful design targets but not yet first-class tables or modules

Current repo entities include:

- `Workspace`
- `InventoryItem`
- `ListingDraft`
- `MarketplaceListing` or listing records associated with a marketplace account
- `ExecutionLog`
- `AuditLog`

Conceptual future entities include:

- `MarketplaceCredential`
- `MarketplaceSession`
- `ListingRevision`
- `Offer`
- `Order`
- `Conversation`
- `AutomationRule`
- `ConnectorHealthSnapshot`
- `MarketplaceFeatureState`

External marketplaces map into the current internal model first. The connector layer exists to translate between Mollie's canonical model and each marketplace's native behaviors without requiring every conceptual future entity to be implemented immediately.

### Capability-First Design

Each connector should explicitly declare which shared capabilities it supports rather than relying on ad hoc route or worker assumptions.

### Multiple Connection Modes

The architecture must support multiple connection modes because marketplaces differ materially in how they can be accessed.

### Degraded but Observable Execution

A connector can be partially useful even when it is degraded. Mollie should surface that truth clearly instead of pretending every connected account is equally ready.

### Auditable Automation

Every external mutation should stay queue-backed and leave:

- an `ExecutionLog`
- an `AuditLog`
- artifacts when automation-class execution fails

### Manual Fallback as a First-Class Mode

Manual fallback is not a temporary embarrassment. It is a valid operating mode for pilot and long-tail marketplaces when live automation is not trustworthy enough.

## Shared Capability Model

Mollie should formalize a capability matrix per marketplace account or adapter. The matrix should answer whether a connector supports, does not support, or only partially supports a shared action.

Capability support should use explicit support states:

- `SUPPORTED`: implemented and intended for normal operator use
- `UNSUPPORTED`: not available for this marketplace or connector mode
- `MANUAL_ONLY`: Mollie can prepare or track the action, but a human must finish it
- `SIMULATED`: currently exercised through a non-live placeholder path that preserves workflow shape
- `PLANNED`: intentionally not implemented yet, but part of the target connector surface

Suggested shared capability set:

| Capability | Meaning | Current repo examples |
| --- | --- | --- |
| `CONNECT_ACCOUNT` | Create or attach a marketplace account inside Mollie | eBay OAuth, manual secret-ref connections, automation session references |
| `VALIDATE_AUTH` | Confirm current credentials/session are still usable | eBay readiness, automation readiness |
| `REFRESH_AUTH` | Refresh OAuth or other renewable auth state | eBay token refresh |
| `SYNC_ACCOUNT_STATE` | Pull account-level state into Mollie | eBay account profile, future automation session validation |
| `SYNC_LISTINGS` | Pull listing state and status | existing sync job shape |
| `SYNC_ORDERS` | Pull sold/order state | future order sync work |
| `CREATE_LISTING` | Publish a new listing | current queued publish jobs |
| `UPDATE_LISTING` | Revise an existing listing | planned |
| `DELIST_LISTING` | End a listing | planned |
| `RELIST_LISTING` | Recreate or relist an ended listing | planned |
| `SEND_OFFER` | Send offers to watchers/buyers where supported | planned |
| `FETCH_MESSAGES` | Pull or interact with buyer/operator conversations | planned |
| `RECORD_HEALTH` | Emit connector status and failure state | current readiness + error handling |
| `FETCH_ANALYTICS` | Pull activity, reputation, or marketplace analytics | future eBay-led work |

The matrix should be data-driven and operator-visible.

Example:

- eBay may support `CONNECT_ACCOUNT`, `VALIDATE_AUTH`, `REFRESH_AUTH`, `CREATE_LISTING`, and eventually `UPDATE_LISTING`.
- Poshmark may support `CREATE_LISTING` via `BROWSER_SESSION`, but not `REFRESH_AUTH` in the OAuth sense.
- Whatnot may support `CREATE_LISTING` for catalog setup and a separate live-selling feature family for show workflows.

## Marketplace-Native Feature Families

Shared capabilities are not enough. Mollie also needs a feature-family layer so native workflows can be modeled cleanly without distorting the base connector contract.

### `POSHMARK_SOCIAL`

Examples:

- self-share
- community-share
- party-share
- closet follow/unfollow
- bundle/comment workflows

These are not generic listing updates. They are Poshmark-native growth and engagement actions.

### `DEPOP_PROMOTION`

Examples:

- bump/relist patterns
- shop-level promotional mechanics
- buyer messaging behaviors

These should not be forced into the same contract as `CREATE_LISTING`.

### `WHATNOT_LIVE_SELLING`

Examples:

- live show inventory assignment
- auction controls
- stream-event reconciliation

These are operationally distinct from static listing workflows.

### `EBAY_POLICY_CONFIGURATION`

Examples:

- business policies
- category and aspect validation
- listing defaults and merchant settings

This already has a visible footprint in the repo through eBay live defaults and readiness checks.

Feature families should be modeled separately because:

- they have different operator surfaces
- they have different failure modes
- they often require different execution environments
- they frequently have different compliance and support requirements

Feature-family readiness should also use explicit state vocabulary so UI and execution logs can stay deterministic:

- `AVAILABLE`: feature family exists and can be used now
- `CONFIGURED`: feature family is enabled and operator/account configuration is complete
- `BLOCKED`: required config, policy, or session state is missing
- `DEGRADED`: the family exists but is impaired by transient or repeated failures
- `SIMULATED`: the family is represented through a pilot-safe placeholder path
- `MANUAL_ONLY`: the family is intentionally human-assisted even if adjacent connector actions are automated

## Connector Execution Modes

Mollie should make execution mode explicit per connector and per action.

### `API`

Direct API usage without delegated user OAuth.

Appropriate for:

- app-level reads
- provider APIs that do not require user grant

### `OAUTH_API`

API usage on behalf of a user or seller account via OAuth tokens.

Appropriate for:

- eBay seller account connections
- listing and policy operations on behalf of sellers

### `BROWSER_SESSION`

Automation against an authenticated browser/session boundary.

Appropriate for:

- Depop
- Poshmark
- Whatnot

when stable public APIs are unavailable or insufficient.

### `LOCAL_AGENT`

A user-operated local runtime for actions that cannot safely run in shared cloud automation.

Appropriate later for:

- high-risk browser workflows
- device-bound session flows
- operator-side manual automation assistance

### `SIMULATED`

A non-live adapter path used to preserve end-to-end workflow shape while the connector is being hardened.

This is already how Depop, Poshmark, and Whatnot are represented today.

### `MANUAL`

An explicit mode where Mollie prepares the work, records intent, and expects a human to complete the marketplace action.

This should stay available as a fallback even after live connectors exist.

## Canonical Domain Model

The current repo already contains a partial connector domain in Prisma and runtime types. The long-term connector model should be thought of using the following conceptual entities:

- `Workspace`
  - operator boundary and tenant scope
- `MarketplaceAccount`
  - current repo entity for a marketplace connection inside a workspace
- `MarketplaceCredential`
  - conceptual credential object; today represented through `secretRef`, `credentialType`, `credentialPayloadJson`, and `credentialMetadataJson`
- `MarketplaceSession`
  - conceptual session state for automation connectors; today mostly represented by manual `secretRef` and account health fields
- `InventoryItem`
  - canonical product/inventory object
- `PlatformListing`
  - current listing object mapped to a marketplace account
- `ListingRevision`
  - not currently modeled, but needed if revise/relist features expand
- `Offer`
  - not currently modeled, but should exist conceptually for offer workflows
- `Order`
  - not currently modeled, but needed for fuller post-sale sync
- `Conversation`
  - not currently modeled, but needed for messaging-capable marketplaces
- `AutomationRule`
  - future operator-configured automation settings beyond the current workspace kill switch
- `AutomationJob`
  - currently represented operationally by queue payloads and `ExecutionLog`
- `ExecutionLog`
  - current auditable connector execution record
- `ConnectorHealthSnapshot`
  - not currently a first-class table; today health is spread across `MarketplaceAccount` status/error/failure counters
- `MarketplaceFeatureState`
  - not currently modeled; needed to track readiness for native feature families independently of baseline account readiness

The key point is not to add all of these immediately. The key point is to have a stable conceptual model so new connector work is additive instead of ad hoc.

## Adapter Contract

Every marketplace adapter should implement a consistent contract, even if some methods are no-ops or explicitly unsupported.

Required contract concepts:

- `connect`
- `validateAuth` or `validateSession`
- `refreshAuth`
- `syncAccountState`
- `publishListing`
- `reviseListing`
- `delistListing`
- `relistListing`
- `sendOffer`
- `runFeatureAction`
- `reportHealth`
- `emitArtifacts`

Required adapter declarations:

- supported shared capabilities
- supported feature families
- execution mode
- risk level
- fallback mode
- rate-limit strategy

`riskLevel` should not be treated as a generic severity label. It should reflect the connector's operational fragility and support cost, including:

- session volatility
- selector or browser fragility
- provider policy sensitivity
- mutation blast radius when actions go wrong
- operator support burden during degraded states

For example:

- eBay is likely `MEDIUM`: strong APIs exist, but auth/policy mistakes can still block publishing
- automation-class browser connectors are often `HIGH`: they have more fragile execution environments and higher support cost
- a read-only provider integration could eventually be `LOW`

Suggested shape:

```ts
type ConnectorDescriptor = {
  platform: Platform;
  executionMode: "API" | "OAUTH_API" | "BROWSER_SESSION" | "LOCAL_AGENT" | "SIMULATED" | "MANUAL";
  supportedCapabilities: {
    capability: ConnectorCapability;
    support: "SUPPORTED" | "UNSUPPORTED" | "MANUAL_ONLY" | "SIMULATED" | "PLANNED";
  }[];
  supportedFeatureFamilies: {
    family: ConnectorFeatureFamily;
    support: "SUPPORTED" | "UNSUPPORTED" | "MANUAL_ONLY" | "SIMULATED" | "PLANNED";
    readiness?: "AVAILABLE" | "CONFIGURED" | "BLOCKED" | "DEGRADED" | "SIMULATED" | "MANUAL_ONLY";
  }[];
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  fallbackMode: "MANUAL" | "SIMULATED" | "NONE";
  rateLimitStrategy: "PROVIDER" | "SESSION_PACED" | "MANUAL_ONLY";
};
```

The current repo does not have this descriptor layer yet, but it does already have the beginnings of it:

- `packages/marketplaces/src/index.ts` defines shared adapter types
- eBay has richer runtime behavior in `packages/marketplaces-ebay`
- automation-class markets are already segregated operationally

## Connector-Runner Role

`apps/connector-runner` should remain the isolated execution environment for automation-class marketplace jobs.

In the current repo it already owns:

- Depop publish jobs
- Poshmark publish jobs
- Whatnot publish jobs
- workspace automation kill switch handling
- artifact capture on failures
- connector health degradation and reset

That isolation should remain because automation-class jobs tend to have:

- higher failure rates
- session fragility
- more environmental dependencies
- different concurrency requirements
- different support and compliance needs

They should not share failure domains with:

- lot analysis
- draft generation
- eBay API-oriented worker flows
- general queue fanout

## Health, Degradation, and Observability

Mollie should formalize connector health separately from generic publish success.

Suggested connector health taxonomy:

- `READY`
- `DEGRADED`
- `SESSION_EXPIRED`
- `AUTH_BLOCKED`
- `RATE_LIMITED`
- `SELECTOR_DRIFT`
- `MANUAL_ONLY`
- `ERROR`

Current repo reality:

- eBay uses an operator truth model:
  - `SIMULATED`
  - `OAUTH_CONNECTED`
  - `LIVE_CONFIG_MISSING`
  - `LIVE_READY`
  - `LIVE_BLOCKED`
  - `LIVE_ERROR`
- automation-class markets use:
  - `AUTOMATION_READY`
  - `AUTOMATION_BLOCKED`
  - `AUTOMATION_ERROR`

That is a good start, but the architecture should let those roll up into a broader connector health model without losing marketplace-specific detail.

Observable execution requirements:

- capture screenshots or artifacts for automation-class failures
- redact operator-facing payloads at the API boundary
- classify retryable vs non-retryable failures
- pause or degrade unsafe connectors instead of repeatedly hammering them
- surface support/debug information through `/executions`

## Product Implications

The product surfaces should expose both connector readiness and feature-family readiness.

### `/marketplaces`

Should show:

- account connection mode
- connector readiness
- health/degradation state
- feature-family availability

Example:

- eBay account is connected, but `EBAY_POLICY_CONFIGURATION` is incomplete
- Poshmark account is connected for cross-listing, but `POSHMARK_SOCIAL` is not configured
- Whatnot account is connected for catalog actions, but `WHATNOT_LIVE_SELLING` is unavailable or manual-only

### `/executions`

Should show:

- connector action executed
- execution mode involved
- feature family if applicable
- artifacts and redacted payloads
- retry suitability

### Item and listing screens

Should show:

- generic publish readiness
- platform-specific readiness
- native feature readiness when relevant

The current inventory detail eBay preflight is the best reference pattern already in the repo.

## Operator Guidance, Copy, and Hints

Connector architecture is not only a backend concern. Mollie must guide operators through setup, readiness, publishing, troubleshooting, and recovery with plain-language copy and contextual hints.

This is especially important for automation-class connectors, where system states can otherwise feel opaque, fragile, or alarming. A technically accurate state model is necessary, but not sufficient. Operators also need to know:

- what happened
- why it matters
- whether they can continue
- what to do next

### User-Centric Copy

System state names should not be dumped directly into the UI without explanation.

Bad:

- `AUTOMATION_BLOCKED`

Better:

- `Poshmark needs attention before this account can publish. Reconnect the account or switch this workflow to manual review.`

Every blocked, degraded, simulated, manual-only, or configured state should be expressed in plain operator language.

### Next-Step Guidance

Every meaningful state should map to recommended next actions.

Examples:

- reconnect account
- add missing marketplace defaults
- upload required photos
- approve draft before publishing
- retry later
- switch to manual handling
- review execution artifacts

The operator should not need to infer the next step from a raw status code.

### Contextual Hints

Hints should appear where the operator is making a decision, not only in logs or support tooling.

Examples:

- `/marketplaces`
  - explain whether a connector is live, simulated, degraded, or manual-only
  - explain what the operator should do next when the account is blocked or incomplete
- `/inventory/[id]`
  - explain why an item cannot publish
  - suggest the next field, photo, approval step, or marketplace config to fix
- `/executions`
  - explain failures in operator terms
  - suggest retry, reconnect, wait, or manual fallback as appropriate

### Marketplace-Specific Guidance

Hints must respect marketplace-native feature families instead of collapsing into generic connector copy.

Examples:

- eBay policy configuration guidance should identify which default or mapping is missing and where to fix it
- Poshmark social guidance should explain what a social action does and whether it is configured or manual-only
- Depop promotion guidance should explain whether promotion actions are available, simulated, or blocked
- Whatnot live-selling guidance should distinguish catalog-style actions from live show workflows

### Progressive Disclosure

Default copy should be concise, actionable, and calm. Detailed technical context should remain available in:

- execution detail views
- support/debug surfaces
- artifacts and logs

Operators should get the shortest message that still helps them make the next correct decision.

### Trustworthy State Communication

If an action is simulated, manual-only, blocked, or degraded, say so clearly.

Mollie should not imply that an operator is fully live-ready when only part of the workflow is actually ready. This applies to both connector readiness and feature-family readiness.

### Conceptual Hint Model

The product should eventually standardize around a hint payload shape that can be reused across marketplace, inventory, and execution surfaces.

Conceptually, each hint should be able to carry:

- status label
- plain-language explanation
- severity
- next recommended actions
- optional deep-link target
- optional feature-family context
- optional learn-more or support text

This does not require a full schema redesign immediately. It does require the architecture to treat operator guidance as a core connector responsibility rather than a cosmetic layer added later.

## Rollout Strategy

### Phase 1: Formalize abstractions and docs

- add connector architecture docs
- define capability and feature-family vocabulary
- align terminology across README, routes, workers, and UI

### Phase 2: Capability matrix in code

- introduce capability declarations in shared types
- require each adapter to declare supported capabilities and execution mode
- use those declarations in API serialization and UI

### Phase 3: Marketplace feature-family support

- add first-class feature-family enums and readiness states
- start with eBay policy configuration and simple automation-family declarations for Depop, Poshmark, and Whatnot

### Phase 4: Browser/session runtime hardening

- standardize automation health capture
- classify session drift, selector drift, and manual-only transitions
- improve connector-runner artifacts and recovery logic

### Phase 5: Local-agent/manual fallback where needed

- add explicit operator-assisted flows when cloud automation is too risky
- preserve auditability and execution visibility

## Current Repo Fit

This architecture is intentionally compatible with the current MVP:

- it keeps eBay as the strongest API-oriented reference integration
- it keeps Depop, Poshmark, and Whatnot as intentional automation-class connectors
- it preserves `connector-runner` isolation
- it extends the existing readiness and execution-log surfaces instead of replacing them

It is not a greenfield rewrite. It is a formalization path for the connector direction Mollie is already taking.
