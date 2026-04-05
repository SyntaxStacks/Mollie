# Marketplace Adapter Model

## Purpose

Mollie already has marketplace adapters for publish and account state. The extension system needs a broader adapter contract that covers:

- API-first behavior
- extension-assisted behavior
- import
- validation
- mapping
- lifecycle actions

## Current Repo Fit

Current adapters already support:

- publish
- sync
- relist/delist hooks
- auth validation
- capability descriptors

The extension model should extend that direction rather than replace it.

## Proposed Adapter Layers

### Connector adapter

Owns account-level and runtime-level behavior:

- connect account
- validate auth
- refresh auth
- sync account state
- publish
- update
- relist
- delist

### Listing adapter

Owns listing-preparation behavior:

- `validateListing(universalListing)`
- `mapToMarketplace(universalListing)`
- `getSupportedCapabilities()`

### Import adapter

Owns extension or API import behavior:

- `importListing(url | listingId | pageContext)`
- `importListings(batchContext)`

### Extension adapter

Owns browser-only marketplace behavior:

- `buildPageMatcher()`
- `extractListingFromPage()`
- `fillListingForm()`
- `submitDraft()`
- `submitPublish()`
- `readPageState()`
- `claimTask()`
- `heartbeatTask()`
- `reportNeedsInput()`

## Adapter Capability Shape

Each marketplace should declare capabilities instead of implying them:

- `api_import`
- `extension_import`
- `api_publish`
- `extension_publish`
- `bulk_import`
- `bulk_publish`
- `relist`
- `delist`
- `update`
- `sold_sync`

That capability map should drive:

- UI affordances
- task creation rules
- operator hints
- extension permissions and page matching
- whether the primary action is `Publish via API`, `Open in extension`, `Generate draft`, or `Unavailable`

## Universal Listing Model

The extension should consume a universal listing model prepared by Mollie, not raw inventory rows.

Required fields:

- title
- description
- category
- brand
- condition
- price
- quantity
- sku
- photos
- tags
- dimensions
- weight
- shipping profile refs
- marketplace overrides
- source metadata

## Failure Model

Extension and adapter failures should normalize to:

- `auth_required`
- `extension_missing`
- `missing_required_field`
- `unsupported_flow`
- `selector_failed`
- `upload_failed`
- `publish_failed`
- `validation_failed`
- `rate_limited`
- `unknown`

These should map cleanly into Mollie operator hints and task states.

## First-Pass Marketplace Support

### Implemented

- `EBAY`
  - extension import
  - extension task handoff
  - universal listing payload mapping
  - extension-driven draft preparation on the seller flow

### Scaffolded

- `DEPOP`
- `POSHMARK`
- `WHATNOT`

The repo already has these platforms as current marketplaces, so scaffolding should align with the current enum and adapter model rather than inventing unrelated marketplaces first.

## Extension Task Execution Contract

The extension-side marketplace executor is now expected to be explicit about lifecycle:

- `QUEUED`
  - Mollie has accepted the task and the extension may pick it up later
- `RUNNING`
  - the extension has claimed the task and marketplace-side work actually started
- `NEEDS_INPUT`
  - the extension reached a real browser-side blocker and needs the operator to intervene
- `FAILED`
  - the executor stopped and retained the failure reason
- `SUCCEEDED`
  - marketplace-side work completed and reported results back into Mollie

This contract is what the per-marketplace UI should reflect. The row state must come from real capability, connection health, and task state, not optimistic assumptions.
