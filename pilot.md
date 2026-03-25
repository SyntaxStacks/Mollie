# Mollie - Pilot Phase (0 -> First Revenue)

## Phase Status

Phase: Pilot Execution
Status: Ready for live operator validation
Completion: ~85-90%

Completed:

* core workflow
* observability and retry flows
* explicit eBay operator truth model
* payload redaction for operator APIs

Remaining:

* run the real pilot checklist against `main`
* fix any truth or UX gaps discovered in operator flow
* validate the first real publish path end-to-end with an operator
* decide whether any remaining gaps belong in `pilot.md` or in post-pilot hardening

---

## Objective

Validate that Mollie can:

* Source -> List -> Sell real inventory
* Save users time OR make them money
* Operate reliably with real marketplace constraints

**Success = 3 paying (or highly engaged) pilot users completing real sales**

---

# Pilot Scope

## In Scope

* eBay real listing + publish
* Depop automation (controlled rollout)
* Inventory -> Draft -> Publish flow (real)
* Execution logs + failure visibility
* Basic support + debugging tools

## Out of Scope

* Live marketplace (Whatnot-style)
* Full automation agents (auto-buy, auto-list loops)
* Billing system (manual or Stripe-lite only)
* Advanced analytics

---

# Workstreams

---

## 1. eBay Connector (REAL)

### Goal

First successful real listing -> visible on eBay

### Tasks

* [x] OAuth flow (auth + refresh tokens)
* [ ] Store credentials securely (Secret Manager pattern)
* [~] Replace mock `ebayAdapter.publishListing`
* [~] Map internal schema -> eBay listing payload
* [~] Handle:
  * categories
  * pricing
  * images
* [x] Capture:
  * externalListingId
  * listing URL
  * raw response

### Done when

* [ ] Listing appears on eBay
* [x] ExecutionLog shows success
* [x] Retry works after failure

---

## 2. Depop Automation (CONTROLLED)

### Goal

One successful automated Depop listing

### Tasks

* [ ] Playwright-based login/session reuse
* [ ] Image upload flow
* [ ] Listing form automation
* [ ] Human-like pacing (rate limit + delays)
* [~] Screenshot + artifact capture on every step

### Guardrails

* [x] Workspace-level kill switch
* [ ] Max actions per hour
* [x] Failure threshold disables account

### Done when

* [ ] Listing appears in Depop account
* [x] Failure produces artifacts + logs
* [x] Account health degrades correctly

---

## 3. Observability + Debugging

### Goal

User and operator can understand failures without digging through code

### Tasks

* [x] Surface ExecutionLogs in UI clearly
* [x] Show:
  * status
  * error code
  * message
  * artifacts (screenshots/logs)
* [x] Add retry button in UI
* [x] Add correlationId search

### Done when

* [~] Any failed publish can be debugged from UI alone

### Operator Truth Model

eBay operator state meanings:

* `SIMULATED`: manual secret-ref account on the simulated eBay path
* `OAUTH_CONNECTED`: OAuth account connected, but live publish disabled
* `LIVE_CONFIG_MISSING`: OAuth account connected, live enabled, required defaults missing
* `LIVE_READY`: OAuth account connected, validated, and ready for live publish
* `LIVE_BLOCKED`: OAuth account disabled, invalid, unverified, or needs refresh
* `LIVE_ERROR`: OAuth account in connector error state and requires operator repair or reconnect

---

## 4. Pilot User Onboarding

### Goal

Get 3 real users using the system

### Target Users

* liquidation resellers
* Whatnot sellers
* Depop clothing flippers

### Tasks

* [ ] Create onboarding doc / flow
* [ ] Manual support channel (Discord / SMS / email)
* [ ] Seed test inventory with them
* [ ] Walk through first listing

### Done when

* [ ] 3 users complete:
  * import lot
  * generate draft
  * publish listing

---

## 5. Safety + Trust Layer

### Goal

Users trust the system with real money/actions

### Tasks

* [~] Add:
  * action audit visibility
  * clear what-happened logs
* [ ] Enforce:
  * per-workspace rate limits
  * connector failure thresholds
* [ ] Add:
  * manual override for publish flows

### Done when

* [x] No silent failures
* [x] Every action is traceable

---

# Known Risks

## Depop bans

* Mitigation: low rate, session reuse, manual fallback

## eBay API complexity

* Mitigation: start with minimal listing surface

## Bad pricing (AI errors)

* Mitigation: keep human approval required

## User confusion

* Mitigation: logs + simple UI + direct support

---

# Success Metrics

## Technical

* [ ] 95%+ successful job completion (excluding connector failures)
* [ ] <5% unexplained failures
* [~] All failures produce logs/artifacts

## Product

* [ ] 3 active users
* [ ] 1+ real item sold via platform
* [ ] Users return after first use

## Business

* [ ] At least 1 user says:
  > "This saved me time" OR "This made me money"

---

# Exit Criteria (Pilot -> Phase 2)

Move to next phase when:

* [ ] Real eBay listings working reliably
* [ ] Depop automation stable enough for limited use
* [ ] Users can complete full workflow without intervention
* [~] Failure cases are observable and debuggable

---

# After Pilot (Preview)

Next phase unlocks:

* automated relisting
* pricing intelligence
* Mac.bid bidding agent
* monetization (subscriptions)

---

# Principle

> Don't scale features.
> Prove the loop works:

**Acquire -> List -> Sell -> Repeat**

Everything else comes after.
