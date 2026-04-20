# UI Revamp Spec

## Purpose
Mollie should feel like a mobile resale operating system, not a generic operator dashboard. The primary loop is:

`source item -> ingest item -> prepare item -> publish item -> sell item`

The UI must bias toward fast intake in chaotic environments while keeping inventory and sell workflows one tap away.

## Product principles
- Camera first: scanning is the default landing behavior and should stay fast.
- Code or manual lookup: when a barcode path fails, the user needs an equally obvious manual/source lookup path.
- Inventory one tap away: users need immediate confidence that scanned items are saved.
- Sell is queue-based: publishing is framed as work queues, blockers, and retries.
- Every item is a sale opportunity: items move through a lifecycle instead of sitting as static records.
- Progressive enrichment: missing data should not block intake unless absolutely required.
- Always show next action: each screen should guide the operator toward the next profitable step.

## Intake focus
The intake UI should feel like a practical resale workstation for finding item data quickly, not a generic admin form.

The happy path is:

`identify by code or manual lookup -> review source data -> prefill trusted fields -> save inventory -> queue for sale`

Key rules:
- Barcode scan remains the fastest path when a printed code exists.
- Manual/source lookup must be a first-class path, not a buried fallback.
- Search results are source references, not truth.
- Mollie should prefill what looks useful from lookup results, then keep the item editable before save.
- Posting and draft generation should feel like the next obvious step once the item is saved.

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
- Clear intake-path switch between:
  - identify by code
  - manual/source lookup
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

### Manual/source lookup
- Lives inside the same intake flow as scan
- Lets the operator:
  - enter a title or lookup phrase
  - open product-centric source searches
  - paste a source URL
  - use those results to prefill the item form
- Must keep the operator in control:
  - source data should prefill fields, not auto-commit them
  - the operator should always be able to continue with a manual item

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

### My listings management
- Add or refactor a desktop-friendly management surface that complements mobile inventory
- Table-first for desktop listing operations
- Columns:
  - SKU
  - Title
  - Price
  - Created
  - Origin
  - Listed on
  - Sold
  - Labels
- Include:
  - search
  - sorting
  - filters by origin and marketplace
  - Create
  - Import
  - Bulk post
  - Bulk delist

### Activity
- Lightweight feed of:
  - recent scans
  - publishes
  - failures
  - sold events
  - suggested next actions

### Item detail
- Lifecycle-oriented detail page
- Two-pane listing workspace on desktop:
  - left: marketplace selection rail
  - right: universal listing form
- Sections:
  - Snapshot
  - Listing Workspace
  - Advanced marketplace details
- Sticky action rail on mobile and compact action header on larger screens

The item detail page should reinforce one source of truth:
- shared item fields are edited once
- marketplace-specific fields appear as inline overrides
- postings are generated from the inventory item rather than edited as separate disconnected listings

## Unified sell workflow
The sell-side flow should mirror the operator pattern that works best for marketplace-first listing prep:

`select marketplaces -> fill one universal listing form -> save or post -> manage per-marketplace execution`

Rules:
- Marketplace selection comes before posting.
- The marketplace rail is the primary control plane, not a secondary status panel.
- The universal listing form is the canonical place to prepare listing data.
- Old generic publish buttons should be demoted where they conflict with marketplace-row actions.
- Marketplace rows must stay honest about execution mode, blockers, and extension requirements.

### Marketplace rail
The left-side marketplace rail should list each real repo-supported marketplace and show:
- checkbox/select target
- listing state
- execution mode:
  - `API`
  - `Extension`
- extension required or not
- marketplace account/session health
- login-in-tab flow:
  - open marketplace in another tab
  - recheck login from Mollie
  - save the connected account back into the workspace
- blocker summary
- `Check again`
- primary CTA driven by real capability/state

Row copy should remain operationally honest:
- `Queued in browser extension`
- `Needs extension session`
- `Ready via API`
- `Missing shipping weight`
- `Generate draft first`

### Universal listing form
The right-side listing form should consolidate listing preparation into one editable workspace:
- photos
- title
- description
- category
- brand
- condition
- size
- color
- tags
- labels
- base price
- per-marketplace price overrides
- shipping weight
- shipping dimensions
- free-shipping toggle
- marketplace-specific override areas only when required

The form should also support:
- templates modal for prefill
- source-driven prefills from scan/import/manual lookup
- AI actions when enabled:
  - `Generate with AI` for title
  - `Generate with AI` for description
  - `Suggest price`

AI suggestions must only prefill fields. They must never auto-save or auto-post.

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
- Do not imply Mollie has a full manual text-search backend if the current API only supports barcode identification; use honest source-search handoffs where needed
- Hide AI actions entirely when AI is disabled for the current environment or workspace
