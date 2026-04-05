# AI Provider

## Purpose

Mollie’s AI assistant is intentionally narrow in this phase. It exists to help an operator finish listing prep faster, not to auto-publish or silently mutate inventory.

The first supported AI actions are:
- generate title
- generate description
- suggest price

All AI output is advisory. Suggestions only prefill fields in the universal listing form.

## Provider model

`packages/ai` exposes an explicit provider interface instead of inferring behavior from environment alone.

Providers:
- `OllamaProvider`
  - interactive AI for staging/local
  - calls an Ollama server over HTTP
- `NullProvider`
  - production-safe fallback when AI is disabled
  - keeps non-interactive draft generation on deterministic heuristics

The provider is selected by config:
- `AI_ENABLED`
- `AI_PROVIDER=ollama|null`
- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`
- `AI_DAILY_LIMIT_PER_WORKSPACE`

## Gating behavior

AI is explicitly gated by config, not by `NODE_ENV` alone.

Expected defaults:
- local/staging:
  - `AI_ENABLED=true`
  - `AI_PROVIDER=ollama`
- production:
  - `AI_ENABLED=false`
  - `AI_PROVIDER=null`

When AI is disabled:
- `/api/ai/status` reports disabled
- the web UI hides AI buttons entirely
- production does not show “coming soon” AI affordances

## API shape

Routes:
- `GET /api/ai/status`
  - returns enabled/disabled status
  - provider name
  - remaining quota
  - daily quota
- `POST /api/ai/listing-assist`
  - accepts:
    - `operation`
    - optional `platform`
    - universal listing payload
  - returns:
    - `suggestion`
    - provider
    - remaining quota

## Quotas

Interactive AI usage is capped per workspace per day.

Current default:
- `50` AI requests per workspace per day

Persistence model:
- `WorkspaceAiUsageDaily`
  - `workspaceId`
  - `day`
  - `requestCount`

Quota is consumed only after a real provider attempt.

## Ollama deployment

### Staging / local
- run Ollama locally in Docker
- point Mollie API to the local Ollama base URL
- pre-pull the configured model before testing

Example flow:
1. start Ollama in Docker
2. pull the configured model
3. set `AI_ENABLED=true`
4. set `AI_PROVIDER=ollama`
5. set `OLLAMA_BASE_URL`
6. set `OLLAMA_MODEL`

### Production
- run Ollama in Docker on a dedicated private host
- do not bundle it into `api` or `worker`
- keep it behind an internal/private URL
- pre-pull the model on the host
- disable instantly by flipping `AI_ENABLED=false`

## UX rules

- AI is only shown where it helps the operator finish listing prep
- AI never auto-saves
- AI never auto-posts
- AI never overrides marketplace selection
- operators can accept, edit, or ignore any suggestion

This keeps Mollie trustworthy while still making listing prep faster.
