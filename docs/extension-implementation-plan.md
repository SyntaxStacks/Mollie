# Extension Implementation Plan

## Current Repo Findings

### Existing apps

- `apps/web`
  - mobile-first operator UI
  - sell queue at `/sell`
  - marketplace accounts at `/marketplaces`
  - inventory detail at `/inventory/[id]`
  - import screen at `/imports`
- `apps/api`
  - authenticated API with inventory, listings, imports, logs, and marketplace account routes
- `apps/worker`
  - API-first job execution
- `apps/connector-runner`
  - isolated browser-session automation jobs for non-eBay marketplaces

### Existing domain models

- `InventoryItem`
- `ListingDraft`
- `PlatformListing`
- `MarketplaceAccount`
- `InventoryImportRun`
- `InventoryImportItem`
- `ExecutionLog`

### Current gaps relevant to this project

- no `apps/extension`
- no extension detection bridge in Mollie
- no extension auth/session handoff
- no extension task state model
- no extension-result ingestion routes
- no browser-extension marketplace adapter contract

## Affected Apps and Packages

### Apps

- `apps/web`
- `apps/api`
- `apps/extension` (new)
- `apps/connector-runner`

### Packages

- `packages/types`
- `packages/db`
- `packages/marketplaces`
- `packages/queue`

## Proposed Architecture

### 1. New extension app

Create `apps/extension` as a Manifest V3 Chrome extension containing:

- `manifest.json`
- background service worker
- Mollie bridge content script for `mollie.biz` and local web origins
- marketplace-specific content scripts
- popup UI

### 2. Shared extension task model

Add a dedicated extension task model for browser-mediated work:

- item handoff from Mollie to extension
- import-from-marketplace work
- publish/update/delist/relist orchestration
- task-level states:
  - `QUEUED`
  - `RUNNING`
  - `NEEDS_INPUT`
  - `FAILED`
  - `SUCCEEDED`
  - `CANCELED`

This should not replace `ExecutionLog`; it should complement it.

### 3. Universal listing model

Add shared listing-preparation contracts in `packages/types` for:

- universal listing payload
- per-marketplace validation result
- extension capability declaration
- extension handoff/result payloads

### 4. Marketplace adapter model

Extend marketplace adapter architecture so adapters can describe:

- import capabilities
- extension publish capabilities
- validation and mapping behavior
- relist/delist/update support

### 5. Mollie as source of truth

Extension results should update existing Mollie records:

- imports:
  - `InventoryImportRun`
  - `InventoryImportItem`
  - `InventoryItem`
- publish outcomes:
  - `PlatformListing`
  - `ExecutionLog`

## First Marketplace Slice

### Implemented first

- `EBAY`
  - extension install detection
  - extension auth handoff
  - Mollie item payload handoff
  - single listing import from eBay detail page
  - extension task result round-trip into Mollie

### Scaffolded only

- `DEPOP`
- `POSHMARK`
- `WHATNOT`

## Routes and Screens Affected

### Web routes

- `/sell`
  - show extension queue status and handoff actions
- `/inventory/[id]`
  - show per-marketplace extension task state and extension handoff action
- `/marketplaces`
  - show extension installed / connected status
- `/imports`
  - show extension-driven import runs and launch actions

### API routes

- new `extension` route family:
  - extension status
  - extension auth bridge
  - task creation
  - task result ingestion
  - marketplace import ingestion

## State and Model Changes

### New shared state

- extension install status
- extension browser connection status
- extension task state
- universal listing DTO
- marketplace extension capability map

### New persistence

- `ExtensionTask`
  - workspace
  - inventory item or import run linkage
  - platform
  - action
  - state
  - payload
  - result
  - failure code/message

## Migration Notes

- do not rewrite existing `ListingDraft`, `PlatformListing`, or `ExecutionLog` semantics
- adapt UI state by adding extension task overlays where needed
- keep current queue jobs intact
- use the extension task layer as the new bridge instead of distorting current publish/import models

## Known Risks and Unknowns

- eBay page selectors can drift
- marketplace DOMs vary by locale, experiment flags, and account state
- extension auth needs a reliable operator-approved session handoff
- browser extension behavior differs across Chrome profiles and permissions states
- publish automation beyond the first slice will need tighter per-marketplace isolation

## Test Strategy

- contract tests for new extension API routes
- adapter tests for universal listing validation and capability mapping
- extension unit tests for message handling and marketplace extraction helpers
- UI tests for extension installed / disconnected state
- integration tests for:
  - Mollie handoff -> extension task creation
  - extension result -> Mollie import/listing update

## Phased Checklist

### Phase 1

- [x] write strategy docs and adapter model docs
- [ ] add shared extension contracts
- [ ] add `ExtensionTask` persistence
- [ ] add `apps/extension`
- [ ] add Mollie extension detection
- [ ] add extension auth handoff

### Phase 2

- [ ] implement eBay single listing import from extension
- [ ] persist results into `InventoryImportRun` and `InventoryItem`
- [ ] show extension task state in Mollie

### Phase 3

- [ ] add Mollie item payload handoff to extension
- [ ] add extension-driven eBay listing draft assist
- [ ] report publish/update failures back into Mollie

### Phase 4

- [ ] add additional marketplace adapters
- [ ] bulk import
- [ ] relist/delist/update flows
- [ ] queue pause/cancel/needs-input refinement
