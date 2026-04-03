# UI Revamp Spec

## Purpose
Mollie should feel like a mobile resale operating system, not a generic operator dashboard. The primary loop is:

`source item -> ingest item -> prepare item -> publish item -> sell item`

The UI must bias toward fast intake in chaotic environments while keeping inventory and sell workflows one tap away.

## Product principles
- Camera first: scanning is the default landing behavior and should stay fast.
- Inventory one tap away: users need immediate confidence that scanned items are saved.
- Sell is queue-based: publishing is framed as work queues, blockers, and retries.
- Every item is a sale opportunity: items move through a lifecycle instead of sitting as static records.
- Progressive enrichment: missing data should not block intake unless absolutely required.
- Always show next action: each screen should guide the operator toward the next profitable step.

## Information architecture
The primary user-facing navigation becomes:
- `Scan`
- `Inventory`
- `Sell`
- `Activity`

Existing routes remain available where needed, but the shell and screen hierarchy should reflect those four areas. Legacy pages like `/drafts`, `/executions`, `/sales`, `/marketplaces`, and `/imports` can remain secondary destinations reachable from the new IA.

## Required screens

### Scan
- Default landing experience
- Fullscreen or near-fullscreen camera-first layout
- Minimal chrome
- Scan reticle
- Flash toggle placeholder if no browser-safe implementation exists yet
- Manual add entry
- Inventory shortcut
- Sell queue shortcut
- Sync indicator
- Small productivity strip:
  - ready to list
  - failed posts
  - listed today
  - sold today

### Scan result sheet
- Opens after a successful scan instead of hard-navigating away
- Lives over the camera flow
- Shows:
  - item image
  - title
  - barcode / identifier
  - estimated market value
  - suggested sell price
  - estimated profit
  - confidence
  - duplicate warning when available
- Primary actions:
  - Add
  - Hold
  - List Later
  - Post Now
  - Skip

### Inventory
- Photo-first inventory management
- Search and filters
- Lifecycle buckets:
  - Unlisted
  - Ready to List
  - Listed
  - Sold
  - Needs Fix
- Card-driven item list, not table-first

### Sell
- Queue-first selling workflow
- Required queues:
  - Ready to List
  - Drafts
  - Publishing
  - Listed
  - Failed
  - Needs Details
- Marketplace rows show state, missing requirements, and action

### Activity
- Lightweight feed of:
  - recent scans
  - publishes
  - failures
  - sold events
  - suggested next actions

### Item detail
- Lifecycle-oriented detail page
- Sections:
  - Snapshot
  - Identification
  - Inventory Info
  - Selling Setup
  - Marketplace Status
  - History
- Sticky action rail on mobile and compact action header on larger screens

## Lifecycle model
The UI should normalize existing backend data into an explicit lifecycle:
- `scanned`
- `review`
- `inventory`
- `ready_to_list`
- `listing_in_progress`
- `listed`
- `sold`
- `archived`
- `error`

Listing readiness flags should be derived where possible:
- `missing_title`
- `missing_photos`
- `missing_condition`
- `missing_category`
- `missing_price`
- `missing_shipping`
- `duplicate_candidate`

Per-marketplace state model for UI:
- `not_started`
- `draft`
- `queued`
- `publishing`
- `published`
- `failed`
- `ended`
- `sold`

The UI should derive these from current inventory, listing draft, platform listing, sales, and preflight data rather than forcing a large backend rewrite.

## Component model
Introduce or normalize reusable UI components for the revamp:
- `ScanResultSheet`
- `ItemCard`
- `StatusPill`
- `ProfitBadge`
- `MarketplaceStatusRow`
- `MissingFieldsPanel`
- `QueueHeader`
- `ActionRail`
- `SectionCard`

Where possible, wrap existing primitives from `@reselleros/ui` instead of replacing them.

## Design tone
The interface should feel:
- fast
- tactile
- practical
- mobile-first
- sale-oriented

The interface should avoid:
- enterprise admin density
- spreadsheet-first layouts
- abstract dashboard language
- burying scan behind admin controls

## Route expectations
- `/` should behave as the Scan entry point
- `/inventory` remains inventory
- `/sell` becomes the sell queue surface
- `/activity` becomes the activity feed
- `/inventory/[id]` becomes lifecycle-oriented detail
- legacy workflow pages remain accessible as supporting routes

## Constraints
- Reuse existing API and DB logic where possible
- Prefer adapters and UI normalization over destructive backend changes
- Preserve barcode scan speed above all
- Keep loading, empty, and error states polished
- Do not present fake marketplace readiness in production
