"use client";

import { useState } from "react";

import type { OperatorHint } from "@reselleros/types";
import { Button, Card, StatusPill } from "@reselleros/ui";

import { useAuth } from "../../components/auth-provider";
import { AppShell } from "../../components/app-shell";
import { OperatorHintCard } from "../../components/operator-hint-card";
import { ProtectedView } from "../../components/protected-view";
import { apiFetch, formatDate, useAuthedResource } from "../../lib/api";

type ExecutionLogView = {
  id: string;
  jobName: string;
  connector: string | null;
  status: string;
  attempt: number;
  correlationId: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  inventoryItemId: string | null;
  inventoryItemTitle: string | null;
  inventoryItemSku: string | null;
  platformListingId: string | null;
  platformListingStatus: string | null;
  platformListingUrl: string | null;
  requestPayload: Record<string, unknown> | null;
  responsePayload: Record<string, unknown> | null;
  artifactUrls: string[];
  retryable: boolean;
  ebayState: string | null;
  publishMode: string | null;
  hint?: OperatorHint | null;
};

type ExecutionDetailView = {
  log: ExecutionLogView;
  relatedAttempts: ExecutionLogView[];
  auditLogs: Array<{
    id: string;
    action: string;
    targetType: string;
    targetId: string;
    metadata: Record<string, unknown> | null;
    createdAt: string;
    actorUserId: string | null;
  }>;
};

function buildExecutionLogPath(status: string, correlationId: string) {
  const params = new URLSearchParams();

  if (status !== "ALL") {
    params.set("status", status);
  }

  if (correlationId.trim()) {
    params.set("correlationId", correlationId.trim());
  }

  const query = params.toString();
  return query ? `/api/execution-logs?${query}` : "/api/execution-logs";
}

export default function ExecutionsPage() {
  const auth = useAuth();
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [correlationDraft, setCorrelationDraft] = useState("");
  const [correlationFilter, setCorrelationFilter] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [retryingLogId, setRetryingLogId] = useState<string | null>(null);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExecutionDetailView | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const path = buildExecutionLogPath(statusFilter, correlationFilter);
  const { data, error, loading, refresh } = useAuthedResource<{ logs: ExecutionLogView[] }>(path, auth.token, [path]);

  async function loadExecutionDetail(logId: string) {
    if (!auth.token) {
      return;
    }

    setSelectedLogId(logId);
    setDetailLoading(true);
    setDetailError(null);

    try {
      const result = await apiFetch<ExecutionDetailView>(`/api/execution-logs/${logId}`, auth.token);
      setDetail(result);
    } catch (caughtError) {
      setDetail(null);
      setDetailError(caughtError instanceof Error ? caughtError.message : "Unable to load execution detail");
    } finally {
      setDetailLoading(false);
    }
  }

  async function retryExecutionLog(logId: string) {
    if (!auth.token) {
      return;
    }

    setRetryingLogId(logId);
    setActionError(null);
    setActionMessage(null);

    try {
      const result = await apiFetch<{ executionLog: ExecutionLogView }>(`/api/execution-logs/${logId}/retry`, auth.token, {
        method: "POST"
      });
      setActionMessage(`Queued retry attempt ${result.executionLog.attempt} for correlation ${result.executionLog.correlationId}.`);
      await refresh();
      await loadExecutionDetail(result.executionLog.id);
    } catch (caughtError) {
      setActionError(caughtError instanceof Error ? caughtError.message : "Retry failed");
    } finally {
      setRetryingLogId(null);
    }
  }

  return (
    <ProtectedView>
      <AppShell title="Automation Activity">
        <Card eyebrow="Activity" title="Runs, retries, and automation history">
          <form
            className="form-grid"
            onSubmit={(event) => {
              event.preventDefault();
              setCorrelationFilter(correlationDraft);
            }}
          >
            <label className="label">
              Status
              <select
                className="select"
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value);
                }}
              >
                <option value="ALL">All statuses</option>
                <option value="FAILED">Failed</option>
                <option value="RUNNING">Running</option>
                <option value="QUEUED">Queued</option>
                <option value="SUCCEEDED">Succeeded</option>
              </select>
            </label>
            <label className="label">
              Correlation Search
              <input
                className="field"
                placeholder="Paste a full or partial correlationId"
                value={correlationDraft}
                onChange={(event) => {
                  setCorrelationDraft(event.target.value);
                }}
              />
            </label>
            <div className="actions">
              <Button type="submit">Apply filters</Button>
              <Button
                kind="ghost"
                onClick={() => {
                  setStatusFilter("ALL");
                  setCorrelationDraft("");
                  setCorrelationFilter("");
                }}
              >
                Clear
              </Button>
            </div>
          </form>

          {error ? <div className="notice">{error}</div> : null}
          {actionError ? <div className="notice">{actionError}</div> : null}
          {actionMessage ? <div className="notice execution-notice-success">{actionMessage}</div> : null}

          {loading ? <div className="center-state">Loading execution logs...</div> : null}

          {!loading && (data?.logs ?? []).length === 0 ? (
            <div className="center-state">No execution logs match the current filters.</div>
          ) : null}

          <div className="stack">
            {(data?.logs ?? []).map((log) => {
              const responseCode = typeof log.responsePayload?.code === "string" ? log.responsePayload.code : null;
              const responseMessage = typeof log.responsePayload?.message === "string" ? log.responsePayload.message : null;

              return (
                <article className="execution-log-card" key={log.id}>
                  <div className="split">
                    <div>
                      <strong>{log.jobName}</strong>
                      <div className="muted">
                        {log.connector ?? "core"} | attempt {log.attempt}
                        {log.ebayState ? ` | ${log.ebayState}` : ""}
                        {log.publishMode ? ` | ${log.publishMode}` : ""}
                      </div>
                    </div>
                    <div className="inline-actions">
                      <StatusPill status={log.status} />
                      <Button
                        kind={selectedLogId === log.id ? "secondary" : "ghost"}
                        onClick={() => {
                          void loadExecutionDetail(log.id);
                        }}
                      >
                        {selectedLogId === log.id ? "Inspecting" : "Inspect"}
                      </Button>
                      {log.retryable ? (
                        <Button
                          kind="secondary"
                          disabled={retryingLogId === log.id}
                          onClick={() => {
                            void retryExecutionLog(log.id);
                          }}
                        >
                          {retryingLogId === log.id ? "Retrying..." : "Retry"}
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid-2 execution-log-grid">
                    <div>
                      <p className="eyebrow">Correlation</p>
                      <code className="execution-inline-code">{log.correlationId}</code>
                    </div>
                    <div>
                      <p className="eyebrow">Started</p>
                      <div>{formatDate(log.startedAt ?? log.createdAt)}</div>
                    </div>
                    <div>
                      <p className="eyebrow">Finished</p>
                      <div>{formatDate(log.finishedAt)}</div>
                    </div>
                    <div>
                      <p className="eyebrow">Inventory</p>
                      <div>{log.inventoryItemTitle ?? "n/a"}</div>
                      <div className="muted">{log.inventoryItemSku ?? "No SKU"}</div>
                    </div>
                  </div>

                  {responseCode || responseMessage ? (
                    <div className="execution-log-detail">
                      <p className="eyebrow">Failure Summary</p>
                      <div>
                        <strong>{responseCode ?? "Execution error"}</strong>
                      </div>
                      <div className="danger">{responseMessage ?? "Unknown connector failure"}</div>
                    </div>
                  ) : null}

                  {log.hint ? <OperatorHintCard hint={log.hint} /> : null}

                  {log.platformListingUrl ? (
                    <div className="execution-log-detail">
                      <p className="eyebrow">Listing</p>
                      <a href={log.platformListingUrl} rel="noreferrer" target="_blank">
                        Open external listing
                      </a>
                    </div>
                  ) : null}

                  {log.artifactUrls.length > 0 ? (
                    <div className="execution-log-detail">
                      <p className="eyebrow">Artifacts</p>
                      <ul className="execution-artifact-list">
                        {log.artifactUrls.map((artifactUrl) => (
                          <li key={artifactUrl}>
                            <code className="execution-inline-code">{artifactUrl}</code>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <details className="execution-log-detail">
                    <summary>Payloads</summary>
                    <div className="grid-2 execution-log-grid">
                      <div>
                        <p className="eyebrow">Request</p>
                        <pre className="execution-code-block">{JSON.stringify(log.requestPayload ?? {}, null, 2)}</pre>
                      </div>
                      <div>
                        <p className="eyebrow">Response</p>
                        <pre className="execution-code-block">{JSON.stringify(log.responsePayload ?? {}, null, 2)}</pre>
                      </div>
                    </div>
                  </details>
                </article>
              );
            })}
          </div>

          {selectedLogId ? (
            <div className="execution-detail-panel">
              <div className="split">
                <div>
                  <p className="eyebrow">Selected Execution</p>
                  <h4 className="execution-detail-heading">{detail?.log.jobName ?? "Loading execution detail"}</h4>
                </div>
                <Button
                  kind="ghost"
                  onClick={() => {
                    setSelectedLogId(null);
                    setDetail(null);
                    setDetailError(null);
                  }}
                >
                  Close
                </Button>
              </div>

              {detailLoading ? <div className="center-state">Loading execution detail...</div> : null}
              {detailError ? <div className="notice">{detailError}</div> : null}

              {detail ? (
                <div className="grid-2 execution-log-grid">
                  {detail.log.hint ? (
                    <div className="execution-log-detail" style={{ gridColumn: "1 / -1" }}>
                      <p className="eyebrow">Operator guidance</p>
                      <OperatorHintCard hint={detail.log.hint} />
                    </div>
                  ) : null}

                  <div className="execution-log-detail">
                    <p className="eyebrow">Attempts</p>
                    <div className="stack">
                      {detail.relatedAttempts.map((attempt) => (
                        <div className="execution-attempt-row" key={attempt.id}>
                          <div>
                            <strong>Attempt {attempt.attempt}</strong>
                            <div className="muted">{formatDate(attempt.createdAt)}</div>
                          </div>
                          <div className="inline-actions">
                            <StatusPill status={attempt.status} />
                            <code className="execution-inline-code">{attempt.id.slice(0, 12)}</code>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="execution-log-detail">
                    <p className="eyebrow">Audit Trail</p>
                    <div className="stack">
                      {detail.auditLogs.length === 0 ? <div className="muted">No related audit entries yet.</div> : null}
                      {detail.auditLogs.map((entry) => (
                        <div className="execution-attempt-row" key={entry.id}>
                          <div>
                            <strong>{entry.action}</strong>
                            <div className="muted">
                              {entry.targetType} | {formatDate(entry.createdAt)}
                            </div>
                          </div>
                          <code className="execution-inline-code">{entry.targetId.slice(0, 12)}</code>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>
      </AppShell>
    </ProtectedView>
  );
}
