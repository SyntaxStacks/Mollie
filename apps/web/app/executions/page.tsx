"use client";

import { Card, StatusPill } from "@reselleros/ui";

import { AppShell } from "../../components/app-shell";
import { ProtectedView } from "../../components/protected-view";
import { useAuth } from "../../components/auth-provider";
import { formatDate, useAuthedResource } from "../../lib/api";

export default function ExecutionsPage() {
  const auth = useAuth();
  const { data, error } = useAuthedResource<{
    logs: Array<{
      id: string;
      jobName: string;
      connector: string | null;
      status: string;
      correlationId: string;
      createdAt: string;
      finishedAt: string | null;
    }>;
  }>("/api/execution-logs", auth.token);

  return (
    <ProtectedView>
      <AppShell title="Execution Logs">
        <Card eyebrow="Observability" title="Publish and automation runs">
          {error ? <div className="notice">{error}</div> : null}
          <table className="table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Connector</th>
                <th>Status</th>
                <th>Correlation</th>
                <th>Started</th>
                <th>Finished</th>
              </tr>
            </thead>
            <tbody>
              {(data?.logs ?? []).map((log) => (
                <tr key={log.id}>
                  <td>{log.jobName}</td>
                  <td>{log.connector ?? "core"}</td>
                  <td>
                    <StatusPill status={log.status} />
                  </td>
                  <td>{log.correlationId.slice(0, 10)}</td>
                  <td>{formatDate(log.createdAt)}</td>
                  <td>{formatDate(log.finishedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </AppShell>
    </ProtectedView>
  );
}
