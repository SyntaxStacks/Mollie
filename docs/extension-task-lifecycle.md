# Extension Task Lifecycle

## Purpose

Extension tasks let Mollie stay the source of truth while the browser extension performs marketplace-side work in the operator's own browser.

This lifecycle exists so the UI can be honest about what is happening.

## Lifecycle Stages

### 1. Task creation

Mollie creates an `ExtensionTask` when the operator chooses an extension-backed action such as:

- importing a listing
- preparing a marketplace draft
- future browser-side publish/update/delist flows

At creation time the task is:

- `QUEUED`
- timestamped with `queuedAt`
- linked to the item or import run
- stored with the universal listing payload or import payload

Queued means "accepted by Mollie and waiting for the browser extension."

It does **not** mean the extension has started.

### 2. Handoff to the extension

The web app hands the queued task to the browser extension through the Mollie page bridge.

The extension stores the task locally and schedules its queue runner.

The task remains:

- `QUEUED`

This is the key correction from the first pass. Local receipt is not the same thing as active marketplace execution.

### 3. Claiming

The extension queue runner picks the next executable task and claims it through Mollie.

Claiming records:

- `runnerInstanceId`
- `claimedAt`
- `attemptCount`
- `lastHeartbeatAt`

Only after a successful claim does the task become:

- `RUNNING`

### 4. Running

While the marketplace executor is working, the extension sends heartbeat updates so Mollie can tell the difference between:

- active work
- a stale or crashed runner

Running means real browser-side work has started.

Examples:

- opening the eBay seller flow
- waiting for the marketplace page to finish loading
- applying listing fields on the page
- opening the Depop create-listing flow
- applying the reliable subset of Depop draft fields before handing control back to the operator

### 5. Needs input

If the extension reaches a legitimate browser-side blocker, it reports:

- `NEEDS_INPUT`

Examples:

- marketplace page variant did not expose the expected fields
- operator attention is required to finish the browser-side step
- the browser extension can continue only after the operator fixes a marketplace-side issue
- Depop accepted the applied fields, but the operator still needs to finish photos, category, or other browser-only inputs in the live tab

`needsInputReason` should tell the operator exactly what to do next.

### 6. Failure

If the extension cannot continue, it records:

- `FAILED`

Failure retains:

- `lastErrorCode`
- `lastErrorMessage`
- `attemptCount`
- any partial result payload that helps explain what happened

Examples:

- `AUTH_REQUIRED`
- `SELECTOR_FAILED`
- `VALIDATION_FAILED`
- `UNKNOWN`

### 7. Retry

Retry can happen in two ways:

- the operator explicitly re-runs the action from Mollie
- a future runner path may requeue a task using `retryAfter`

This pass stores retry-oriented metadata (`attemptCount`, `retryAfter`) even though automatic retry policy is still intentionally conservative.

### 8. Completion

When browser-side execution finishes successfully, the task becomes:

- `SUCCEEDED`

Completion records:

- `completedAt`
- result payload
- any marketplace-side URLs or field-application summary that helps the operator understand what happened

## Recovery

The extension runner hydrates queued tasks from local storage after browser restart.

If a locally running task becomes stale, the runner can re-queue it locally and try to claim it again. Mollie only allows re-claiming when the task is actually stale or queued.

## Operator-facing summary

The UI should read these states plainly:

- `QUEUED`: queued in browser extension
- `RUNNING`: browser extension is working
- `NEEDS_INPUT`: browser-side help needed
- `FAILED`: failed with actionable reason
- `SUCCEEDED`: marketplace-side step completed
- `CANCELED`: stopped intentionally
