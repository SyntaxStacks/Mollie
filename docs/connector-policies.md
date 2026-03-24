# Connector Policies

## eBay

- Treat eBay as the primary MVP connector.
- Keep publish actions queued and idempotent.
- Do not mutate listings inside the API request path.

## Depop

- Route Depop jobs through `connector-runner` only.
- Keep concurrency at `1` in Cloud Run for browser stability.
- Persist screenshots or artifact links with every meaningful failure.

## General

- Every external mutation must have an `execution_log`.
- Every user-triggered workflow must leave an `audit_log`.
- Human approval before publish is required for MVP.
