# UI Revamp Implementation Plan

## Goal
Refactor Mollie into a mobile-first resale workflow with a camera-first Scan home, a first-class manual/source lookup path, photo-first Inventory, queue-first Sell, and action-oriented Activity feed while preserving current API and route compatibility.

## Affected routes and screens
- `/`
  - becomes Scan home and default landing experience
- `/inventory`
  - shifts from manual-entry + table to bucketed photo-first inventory
- `/inventory/[id]`
  - becomes lifecycle-oriented item detail
- `/sell`
  - new queue-first selling screen built from inventory, draft, and listing state
- `/activity`
  - new operational feed built from scans, execution logs, listings, and sales
- `/drafts`
  - remains as a secondary review queue surface
- `/executions`
  - remains detailed debugging surface behind Activity
- `/sales`
  - remains structured sales log behind Activity
- `/marketplaces`
  - remains account management surface behind Sell and item detail workflows

## Affected components
- Existing:
  - `apps/web/components/app-shell.tsx`
  - `apps/web/components/barcode-import-card.tsx`
  - `apps/web/components/inventory-detail-view.tsx`
  - `apps/web/components/operator-hint-card.tsx`
- New or normalized:
  - `ScanResultSheet`
  - `ItemCard`
  - `StatusPill`
  - `ProfitBadge`
  - `MarketplaceStatusRow`
  - `MissingFieldsPanel`
  - `QueueHeader`
  - `ActionRail`
  - `SectionCard`
  - lifecycle adapter helpers for inventory and listing state

## Affected state and data mapping
- Current inventory API already returns enough data for a first-pass lifecycle mapper:
  - images
  - listingDrafts
  - platformListings
  - sales
- Current lookup API is barcode-oriented, so manual lookup should use honest source-search helpers and prefill adapters rather than pretending there is a mature free-text product API already
- New UI adapter layer should derive:
  - top-level item lifecycle
  - readiness flags
  - sell queue grouping
  - profit signal
  - marketplace summary
- Existing barcode lookup and create-item flow should remain intact
- Existing inventory create flow should be reused for manual/source lookup item creation
- Existing eBay preflight and linked publish endpoints should power marketplace status and primary actions

## Migration notes
- Preserve legacy routes and business logic
- Use the new shell to surface the 4-tab IA without deleting current pages
- Reuse the barcode scanner and camera modal logic instead of rebuilding scan from scratch
- Promote scan-first flow by moving it to the landing page and presenting inventory creation as a result-sheet workflow
- Map current item statuses into the new lifecycle model in the web layer first
- Keep old detailed admin surfaces for support and debugging rather than removing them

## Known risks
- Current backend item status is MVP-shaped and may not map perfectly to the desired lifecycle without heuristics
- Existing scan flow is card/form oriented and needs to be reframed into a faster camera/result-sheet flow carefully
- The app shell is currently sidebar-first, so mobile navigation changes will touch global layout and CSS heavily
- Sell queue accuracy depends on derived readiness from multiple existing records
- Some desired feed events for Activity may need approximation from current inventory, execution, and sales data

## Phased checklist

### Phase 1: Shell and IA
- [ ] Add the UI spec and implementation plan docs
- [ ] Refactor shell into `Scan / Inventory / Sell / Activity`
- [ ] Make Scan the default landing experience
- [ ] Keep legacy routes accessible without letting them dominate the IA

### Phase 2: Lifecycle adapters
- [ ] Add inventory lifecycle mapper
- [ ] Add readiness-flag mapper
- [ ] Add marketplace queue/status mapper
- [ ] Normalize badge and status vocabulary for UI

### Phase 3: Scan experience
- [ ] Reframe barcode scanner as camera-first landing surface
- [ ] Add explicit intake-path switching between code lookup and manual/source lookup
- [ ] Add productivity strip and quick shortcuts
- [ ] Add result sheet instead of immediate hard navigation
- [ ] Preserve manual fallback and fast return to scan
- [ ] Make source results act as field prefills rather than accepted truth

### Phase 4: Inventory and item detail
- [ ] Replace table-first inventory with card-first buckets
- [ ] Add search and lightweight filters
- [ ] Promote manual/source item creation as a first-class inventory entry point
- [ ] Refactor item detail into lifecycle sections
- [ ] Add sticky action rail

### Phase 5: Sell and Activity
- [ ] Add `/sell` queue surface
- [ ] Add `/activity` feed surface
- [ ] Reuse existing drafts, listings, execution logs, and sales data
- [ ] Surface blockers and retry actions clearly

### Phase 6: Validation
- [ ] Update or add targeted UI tests around the scan landing flow and core routing
- [ ] Run typecheck
- [ ] Run web build
- [ ] Verify no route regressions in protected shell flows

## Implementation assumptions
- Scan remains barcode-first for MVP
- Mobile-first means the layout and action hierarchy optimize for phones first, not that every advanced workflow must become camera-only
- Sell queues are derived from current records rather than introduced as a brand-new persistence layer
- Activity feed can start as a curated operational summary rather than a complete event-sourcing system
