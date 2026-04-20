# Extension Strategy

## Current Repo Findings

Mollie already has the core reseller workflow primitives needed for a browser-extension layer:

- `apps/web`
  - mobile-first operator UI with `Scan`, `Inventory`, `Sell`, and `Activity`
  - item detail, sell queue, marketplace accounts, and imports screens already exist
- `apps/api`
  - authenticated Fastify API with routes for inventory, listings, marketplace accounts, imports, logs, and sales
- `apps/worker`
  - queue-backed draft generation, lot analysis, and eBay publish path
- `apps/connector-runner`
  - isolated automation worker for browser-session marketplaces
- `packages/marketplaces*`
  - existing marketplace adapter split for eBay, Depop, Poshmark, and Whatnot
- `packages/queue`
  - queue names and payload schemas for publish and import jobs
- `packages/db`
  - current source-of-truth models for:
    - `InventoryItem`
    - `ListingDraft`
    - `PlatformListing`
    - `MarketplaceAccount`
    - `InventoryImportRun`
    - `InventoryImportItem`
    - `ExecutionLog`

The repo now has:
- `apps/extension`
  - Manifest V3 browser extension
  - Mollie web-to-extension bridge
  - extension task runner
  - eBay import and draft-prep execution slice
  - Depop browser-session draft-prep execution slice
- `ExtensionTask`
  - queue-backed browser execution state that complements listings and imports

## Product Role of the Extension

The extension is not a second inventory system. Mollie remains the canonical system of record for:

- scanned and manually created inventory
- universal listing preparation
- queue state
- publish intent
- marketplace status and failure history

The extension exists to add desktop-grade marketplace operations where API coverage is missing or incomplete:

- import listing data from marketplace pages into Mollie
- push Mollie listing payloads into marketplace forms
- let operators sign in on a normal marketplace tab, then recheck and save that browser session into Mollie
- support browser-assisted publish/update/relist/delist flows
- return actionable results and failures back into Mollie

## Architecture Direction

### Keep the current app split

- `apps/web`
  - owns operator-facing status, queue orchestration, item detail, and extension connectivity UI
- `apps/api`
  - owns extension authentication handoff, extension task creation, result ingestion, import persistence, and marketplace linkage updates
- `apps/worker`
  - continues to own API-first marketplace jobs
- `apps/connector-runner`
  - continues to own isolated browser-session runtimes
- `apps/extension`
  - new Manifest V3 Chrome extension

### Add a thin extension task layer

Instead of replacing `ExecutionLog`, `ListingDraft`, or `PlatformListing`, add a dedicated extension task model that can represent:

- queued extension work
- in-browser execution
- needs-input pauses
- task-level failure reasons
- result payloads

This lets Mollie show extension-driven state without overloading existing listing or import records.

### Reuse current import and listing models

For the first pass:

- imported marketplace data should still end up as:
  - `InventoryImportRun`
  - `InventoryImportItem`
  - `InventoryItem`
- published marketplace outcomes should still end up as:
  - `PlatformListing`
  - `ExecutionLog`

The extension task acts as the bridge, not the final record.

## First Delivery Slice

The repo already has the strongest current support around eBay, so the first real extension slice should be:

1. Mollie can detect whether the extension is installed
2. Mollie can authorize the extension with the current operator session
3. Mollie can hand off a prepared eBay listing payload to the extension
4. The extension can import a single eBay listing page into Mollie
5. The extension can report success or failure back into Mollie
6. Mollie surfaces extension task state in Sell and item detail

That is a realistic first step because:

- eBay already exists in platform enums, queue jobs, listing routes, and account flows
- Sell and item detail already know how to render per-marketplace state
- imports already have a dedicated run/item model

## Marketplace Scope for This Pass

Implemented end-to-end first:

- `EBAY`
  - extension install detection
  - extension auth handoff
  - single-page import from eBay listing/detail pages
  - Mollie-to-extension listing handoff payload
  - task result feedback into Mollie

Scaffolded only:

- `POSHMARK`
- `WHATNOT`

Implemented narrowly next:

- `DEPOP`
  - browser-tab login recheck
  - extension-native draft prep
  - browser-session-aware item-row UX

Not added yet:

- Facebook Marketplace
- Mercari

Those are not current repo targets, so adding fake support badges would be misleading.

## Security Model

The extension must:

- use Manifest V3
- request only minimal permissions
- scope host permissions to supported marketplace domains plus Mollie app domains
- keep automation inside the user’s own browser
- require explicit user-triggered actions for publish-like flows
- keep Mollie as source of truth for task and listing state

For the current pass, extension auth reuses the current Mollie operator bearer token through an explicit user-approved bridge initiated from Mollie. The UI must still distinguish:
- extension installed
- extension connected to Mollie
- marketplace session/account ready for execution

Those are different states and should not be collapsed into a single “connected” message.

## Marketplace-row UI alignment

The extension should not live behind a detached global status card alone. The better pattern is per-marketplace workflow visibility on the item page.

Mollie should therefore surface extension state inside marketplace rows:
- execution mode:
  - `API`
  - `Extension`
- login model:
  - `Open marketplace in another tab`
  - `Recheck login`
- extension required or not
- extension installed/connected state
- marketplace account/session health
- task lifecycle:
  - `QUEUED`
  - `RUNNING`
  - `NEEDS_INPUT`
  - `FAILED`
  - `SUCCEEDED`
- row-level actions:
  - `Open in extension`
  - `Finish in Depop tab`
  - `Check again`
  - `Reconnect`
  - `Generate draft`
  - `Publish`

The extension status card remains useful, but secondary. The marketplace row is the primary operator control surface.

## Honest queue behavior

The extension task lifecycle must stay operationally honest:
- `QUEUED`
  - Mollie has created the work and handed it to the browser extension
- `RUNNING`
  - the extension has claimed the work and started marketplace-side execution
- `NEEDS_INPUT`
  - execution is paused waiting on the operator, marketplace session, or other browser-only input
- `FAILED`
  - execution ended with a structured actionable error
- `SUCCEEDED`
  - execution finished and reported results back into Mollie

Queued in the browser extension is not the same as actively running. Mollie’s UI must keep that distinction visible.

## Why This Fits Mollie

This approach reinforces Mollie’s product loop instead of fragmenting it:

- `scan item`
  - mobile-first intake remains unchanged
- `enrich item`
  - listing preparation stays in Mollie
- `inventory`
  - canonical item record stays in Mollie
- `cross-post`
  - extension helps on desktop where API gaps exist
- `manage`
  - state and failures still render in Mollie Sell and item detail
- `sell`
  - per-marketplace listing outcomes remain tied to the same item lifecycle
