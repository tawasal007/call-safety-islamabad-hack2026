import { runDetector } from "../detector/detect.ts";
import type { LlmProvider } from "../detector/provider.ts";
import { concernRank, type ConcernLevel, type DetectorSegment, type MonitoringMessage, type MonitoringStatus, type Warning } from "../detector/types.ts";
import { applyResult } from "../detector/warnings.ts";
import { alertForWarning, shouldAlert, type AlertDeps } from "../notify/alerts.ts";
import { callEnded, listEvents, listWarnings, recordEvent, saveWarning } from "./call-record.ts";
import type { DocStore } from "./store.ts";

export type Publisher = (roomId: string, message: MonitoringMessage) => Promise<void>;

export type PipelineDeps = {
  store: DocStore;
  provider: LlmProvider | null;
  providerIssue?: string;
  publish: Publisher;
  readSegments: (roomId: string) => Promise<DetectorSegment[]>;
  alerts: AlertDeps;
  now: () => Date;
  newId: () => string;
  timeoutMs: number;
  contextSize: number;
  warningMinConcern: ConcernLevel;
  log: (line: string) => void;
};

export type SegmentOutcome =
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; status: "degraded" | "unavailable"; reason: string }
  | { kind: "analysed"; change: "none" | "created" | "updated"; concernLevel: ConcernLevel; warning?: Warning; latencyMs: number };

// Results for segments spoken this long after the recorded call end are stale.
const END_GRACE_MS = 60_000;

const queues = new Map<string, Promise<unknown>>();
const lastStatus = new Map<string, MonitoringStatus>();

/** Serial, per-room queue so analyses apply in order; separate rooms run in parallel. */
export function enqueue<T>(roomId: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(roomId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  queues.set(roomId, current);
  current.catch(() => undefined).finally(() => { if (queues.get(roomId) === current) queues.delete(roomId); });
  return current;
}

async function safePublish(deps: PipelineDeps, roomId: string, message: MonitoringMessage) {
  try { await deps.publish(roomId, message); }
  catch (error) { deps.log(`[monitor] publish to ${roomId.slice(-8)} failed: ${error instanceof Error ? error.message : "unknown error"}`); }
}

export async function setStatus(roomId: string, status: MonitoringStatus, reason: string | undefined, deps: PipelineDeps) {
  if (lastStatus.get(roomId) === status) return;
  lastStatus.set(roomId, status);
  const at = deps.now().toISOString();
  try { await recordEvent(deps.store, roomId, { type: "monitoring_status", status, reason, at }); }
  catch (error) { deps.log(`[monitor] status record failed: ${error instanceof Error ? error.message : "unknown error"}`); }
  await safePublish(deps, roomId, { v: 1, roomId, type: "status", status, reason, at });
}

/** Bounded context: the focus segment plus up to contextSize-1 earlier segments (both speakers). */
export function buildWindow(all: DetectorSegment[], focus: DetectorSegment, contextSize: number): DetectorSegment[] {
  const sorted = [...all].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  let index = sorted.findIndex((segment) => segment.id === focus.id);
  if (index < 0) { sorted.push(focus); index = sorted.length - 1; }
  return sorted.slice(Math.max(0, index - contextSize + 1), index + 1);
}

/** Analyses one finalized segment. Never throws; never blocks audio or transcription. */
export function processSegment(roomId: string, segment: DetectorSegment, deps: PipelineDeps): Promise<SegmentOutcome> {
  return enqueue(roomId, async (): Promise<SegmentOutcome> => {
    try {
      if (segment.speaker !== "caller") return { kind: "skipped", reason: "receiver speech is context only" };
      const ended = callEnded(await listEvents(deps.store, roomId));
      if (ended && Date.parse(segment.at) > Date.parse(ended.at) + END_GRACE_MS) return { kind: "skipped", reason: "stale: session already ended" };
      if (!deps.provider) {
        const reason = deps.providerIssue ?? "detector not configured";
        await setStatus(roomId, "unavailable", reason, deps);
        return { kind: "failed", status: "unavailable", reason };
      }
      if (lastStatus.get(roomId) === undefined) await setStatus(roomId, "connecting", undefined, deps);
      const window = buildWindow(await deps.readSegments(roomId), segment, deps.contextSize);
      const outcome = await runDetector(deps.provider, window, segment.id, { timeoutMs: deps.timeoutMs });
      if (!outcome.ok) {
        deps.log(`[monitor] detector ${outcome.kind} for ${roomId.slice(-8)}: ${outcome.reason}`);
        await setStatus(roomId, "degraded", outcome.kind === "invalid" ? "detector output rejected" : outcome.reason, deps);
        return { kind: "failed", status: "degraded", reason: outcome.reason };
      }
      await setStatus(roomId, "active", undefined, deps);
      const change = applyResult(await listWarnings(deps.store, roomId), outcome.result, {
        roomId, now: deps.now(), segments: window, minConcern: deps.warningMinConcern, newId: deps.newId,
      });
      if (change.kind === "none") return { kind: "analysed", change: "none", concernLevel: outcome.result.concernLevel, latencyMs: outcome.latencyMs };
      await saveWarning(deps.store, change.warning);
      await safePublish(deps, roomId, { v: 1, roomId, type: "warning", warning: change.warning });
      deps.log(`[monitor] warning ${change.kind} (${change.warning.concernLevel}) for ${roomId.slice(-8)} in ${outcome.latencyMs} ms`);
      if (shouldAlert(change.warning.concernLevel, deps.alerts.minConcern)) {
        await alertForWarning(roomId, change.warning, deps.alerts, "warning");
      }
      return { kind: "analysed", change: change.kind, concernLevel: outcome.result.concernLevel, warning: change.warning, latencyMs: outcome.latencyMs };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "monitoring error";
      deps.log(`[monitor] pipeline error for ${roomId.slice(-8)}: ${reason}`);
      await setStatus(roomId, "degraded", "monitoring error", deps).catch(() => undefined);
      return { kind: "failed", status: "degraded", reason };
    }
  });
}

/** Runs after the queue drains: marks the session ended and sends any outstanding end-of-call alerts. */
export function finalizeCall(roomId: string, deps: PipelineDeps): Promise<void> {
  return enqueue(roomId, async () => {
    try {
      await setStatus(roomId, "ended", undefined, deps);
      const warnings = (await listWarnings(deps.store, roomId))
        .filter((warning) => shouldAlert(warning.concernLevel, deps.alerts.minConcern))
        .sort((a, b) => concernRank(b.concernLevel) - concernRank(a.concernLevel));
      for (const warning of warnings) await alertForWarning(roomId, warning, deps.alerts, "call_end");
    } catch (error) {
      deps.log(`[monitor] finalize failed for ${roomId.slice(-8)}: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally {
      lastStatus.delete(roomId);
    }
  });
}

/** Test helper: forget in-memory per-room state. */
export function resetMonitoringState() {
  queues.clear();
  lastStatus.clear();
}