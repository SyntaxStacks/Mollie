# Runbooks

## Health checks

- API: `GET /health`
- Worker: `GET http://HOST:4001/health`
- Connector runner: `GET http://HOST:4010/health`

## If draft generation is not appearing

1. Confirm Redis is reachable from API and worker.
2. Check `GET /api/execution-logs` and the worker process output.
3. Verify the inventory item exists and includes the expected pricing fields.

## If a publish job fails

1. Open `/executions` and confirm whether the failure is in the main worker or connector runner.
2. Inspect the correlated `execution_log` entry for payload and error detail.
3. Inspect the artifact paths recorded for the failed connector run under `ARTIFACT_BASE_DIR`.
4. Re-approve the draft if needed, then retry from the listing endpoint or item detail view.

## If Depop automation should be paused

1. Open `/settings`.
2. Disable connector automation for the workspace.
3. Existing connector jobs will fail fast with a workspace-disabled classification until automation is re-enabled.

## If sales numbers look wrong

1. Check the item's `costBasis`.
2. Confirm fees and shipping were entered on the manual sale fallback.
3. Recompute through `GET /api/analytics/pnl`.
