# Item Detail Refactor Plan

## Purpose
Refactor Mollie's item detail page in a strict sequence so the operator sees one item, one workspace, several marketplace interpretations, and minimal clutter.

## Sequence

### Phase 1
Use the inventory item as the single source of truth.

Goals:
- shared item fields are edited once
- platform-specific overrides are inline
- the marketplace rail stays on the same page

Expected outcome:
- left rail for marketplace choices and blockers
- right workspace for shared listing data, shipping, and inline overrides
- postings are understood as generated from the inventory item

### Phase 2
Make each marketplace row interpret the item according to that marketplace's real requirements.

Goals:
- eBay emphasizes structured completeness and shipping
- Depop emphasizes browser-session readiness and discovery-oriented fields
- Poshmark and Whatnot emphasize session/login readiness and honest capability state

Expected outcome:
- marketplace rows feel strategy-aware instead of generic
- row summaries and actions reflect real implementation state

### Phase 3
Cut non-flow UI and demote implementation detail.

Goals:
- keep only item context, marketplace choices, shared listing form, blocker feedback, and primary actions on the main screen
- move low-frequency or implementation-shaped controls behind `Advanced`

Expected outcome:
- the page feels calmer and more intentional
- the operator can move from item prep to marketplace posting without reading system plumbing

## Rules
- Keep the inventory item as the canonical source of truth.
- Keep platform-specific overrides inline instead of creating disconnected listing editors.
- Keep marketplace support honest; do not imply capabilities that are not implemented.
- Preserve the existing lifecycle and extension model where possible.
- Avoid feature creep. These passes are about structure, interpretation, and hierarchy.

## Success Condition
At the end of the full sequence, the item detail page should feel like:

`one item -> one workspace -> several marketplace interpretations -> clear next actions`

It should not feel like:
- several listing editors
- a marketplace account manager
- an extension admin page
- a debug console
- a pile of overlapping controls
