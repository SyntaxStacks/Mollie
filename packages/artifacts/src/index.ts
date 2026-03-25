import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function sanitize(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function resolveBaseDir() {
  return path.resolve(process.cwd(), process.env.ARTIFACT_BASE_DIR ?? "tmp/artifacts");
}

export async function captureConnectorFailureArtifacts(input: {
  workspaceId: string;
  executionLogId: string;
  connector: string;
  code: string;
  message: string;
  jobName: string;
  metadata?: Record<string, unknown>;
}) {
  const folder = path.join(
    resolveBaseDir(),
    sanitize(input.workspaceId),
    sanitize(input.executionLogId)
  );
  await mkdir(folder, { recursive: true });

  const summaryPath = path.join(folder, `${sanitize(input.connector)}-failure-summary.json`);
  const notePath = path.join(folder, `${sanitize(input.connector)}-artifact-note.txt`);

  await writeFile(
    summaryPath,
    JSON.stringify(
      {
        connector: input.connector,
        code: input.code,
        message: input.message,
        jobName: input.jobName,
        capturedAt: new Date().toISOString(),
        metadata: input.metadata ?? {}
      },
      null,
      2
    ),
    "utf8"
  );

  await writeFile(
    notePath,
    [
      `Connector: ${input.connector}`,
      `Failure code: ${input.code}`,
      `Failure message: ${input.message}`,
      "Screenshot unavailable in the current simulated connector runtime.",
      "This text artifact exists so every failure has an inspectable artifact set."
    ].join("\n"),
    "utf8"
  );

  return [summaryPath, notePath];
}
