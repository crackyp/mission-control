// OpenClaw cron access for Mission Control.
//
// OpenClaw 2026.7.35 moved cron storage out of ~/.openclaw/cron/jobs.json and
// cron/runs/<jobId>.jsonl into the gateway's SQLite state DB. Reads go straight
// to that DB, read-only: job_json + state_json rebuild the old jobs.json entry
// and entry_json is the old runs line. Writes must go through the gateway
// (`openclaw gateway call cron.*`) — it owns the rows and keeps the schedule in
// memory, so editing the DB or recreating jobs.json would be ignored or worse.

import { execFile } from "child_process";
import { runtimeConfig } from "./runtime-config";

// node:sqlite is available in Node 22+ at runtime.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require("node:sqlite");

function withStateDb<T>(fn: (db: any) => T): T {
  const db = new DatabaseSync(runtimeConfig.openclawStateDb, { readOnly: true, timeout: 5000 });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function readCronJobs(): any[] {
  const rows = withStateDb((db) =>
    db
      .prepare(
        "SELECT job_json, state_json, runtime_updated_at_ms FROM cron_jobs ORDER BY sort_order, updated_at, job_id"
      )
      .all()
  );
  return rows.map((row: any) => ({
    ...JSON.parse(row.job_json),
    ...(row.runtime_updated_at_ms != null ? { updatedAtMs: row.runtime_updated_at_ms } : {}),
    state: JSON.parse(row.state_json || "{}"),
  }));
}

// Newest first.
export function readCronRuns(jobId: string, limit: number): any[] {
  const rows = withStateDb((db) =>
    db
      .prepare("SELECT entry_json FROM cron_run_logs WHERE job_id = ? ORDER BY ts DESC, seq DESC LIMIT ?")
      .all(jobId, limit)
  );
  return rows
    .map((row: any) => {
      try {
        return JSON.parse(row.entry_json);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// The CLI takes ~30s to start on the Pi, so keep the process timeout generous.
export function callCronGateway(method: string, params: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    execFile(
      runtimeConfig.openclawBin,
      ["gateway", "call", method, "--params", JSON.stringify(params), "--json", "--timeout", "45000"],
      { timeout: 90_000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        let parsed: any = null;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          // non-JSON output; surface stderr below
        }
        if (error || parsed?.ok === false) {
          reject(
            new Error(
              parsed?.error?.message || (stderr || "").trim().slice(0, 400) || error?.message || `${method} failed`
            )
          );
          return;
        }
        resolve(parsed);
      }
    );
  });
}

// The Cron editor posts one-shot times as `atMs`; the gateway only accepts an
// ISO `at` string.
export function toGatewaySchedule(schedule: any): any {
  if (schedule?.kind === "at" && typeof schedule.atMs === "number") {
    const { atMs, ...rest } = schedule;
    return { ...rest, at: new Date(atMs).toISOString() };
  }
  return schedule;
}
