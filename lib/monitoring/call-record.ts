import { randomUUID } from "node:crypto";
import type { TranscriptSegment } from "../call-logs.ts";
import { concernRank, type ConcernLevel, type MonitoringStatus, type Warning } from "../detector/types.ts";
import type { DocStore } from "./store.ts";

export type CallEvent = {
  id: string;
  type: "participant_joined" | "participant_left" | "call_ended" | "monitoring_status";
  at: string;
  role?: "caller" | "receiver";
  status?: MonitoringStatus;
  reason?: string;
};

export type AlertStatus = "delivered" | "simulated" | "failed" | "suppressed_cooldown";

/** Delivery record for one warning and one guardian. Never contains contact details. */
export type AlertRecord = {
  id: string;
  warningId: string;
  warningVersion: number;
  guardianId: string;
  guardianName: string;
  channel: string;
  status: AlertStatus;
  attempts: number;
  trigger: "warning" | "call_end";
  at: string;
  error?: string;
  subject: string;
  body: string;
};

export type CallSummary = {
  roomId: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  participants: ("caller" | "receiver")[];
  highestConcern: ConcernLevel;
  monitoringStatus: MonitoringStatus | "unknown";
  warningCount: number;
  alertCount: number;
};

export type CallDetail = CallSummary & {
  statusChanges: { status: MonitoringStatus; reason?: string; at: string }[];
  warnings: Warning[];
  alerts: AlertRecord[];
  segments: TranscriptSegment[];
};

const base = (roomId: string) => `${roomId}/monitoring`;
export const storageKeys = {
  warnings: (roomId: string) => `${base(roomId)}/warnings`,
  warning: (roomId: string, id: string) => `${base(roomId)}/warnings/${id}.json`,
  events: (roomId: string) => `${base(roomId)}/events`,
  event: (roomId: string, at: string, id: string) => `${base(roomId)}/events/${String(Date.parse(at)).padStart(15, "0")}-${id}.json`,
  alerts: (roomId: string) => `${base(roomId)}/alerts`,
  alert: (roomId: string, warningId: string, guardianId: string) => `${base(roomId)}/alerts/${warningId}__${guardianId}.json`,
};

export async function recordEvent(store: DocStore, roomId: string, event: Omit<CallEvent, "id">): Promise<CallEvent> {
  const saved = { ...event, id: randomUUID() };
  await store.put(storageKeys.event(roomId, event.at, saved.id), saved);
  return saved;
}

export async function listEvents(store: DocStore, roomId: string): Promise<CallEvent[]> {
  return (await store.list<CallEvent>(storageKeys.events(roomId))).sort((a, b) => a.at.localeCompare(b.at));
}

export async function listWarnings(store: DocStore, roomId: string): Promise<Warning[]> {
  return (await store.list<Warning>(storageKeys.warnings(roomId))).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function saveWarning(store: DocStore, warning: Warning): Promise<void> {
  await store.put(storageKeys.warning(warning.roomId, warning.id), warning);
}

export async function listAlerts(store: DocStore, roomId: string): Promise<AlertRecord[]> {
  return (await store.list<AlertRecord>(storageKeys.alerts(roomId))).sort((a, b) => a.at.localeCompare(b.at));
}

export function callEnded(events: CallEvent[]): CallEvent | undefined {
  return events.find((event) => event.type === "call_ended");
}

export async function buildCallDetail(store: DocStore, roomId: string, segments: TranscriptSegment[]): Promise<CallDetail> {
  const [events, warnings, alerts] = await Promise.all([listEvents(store, roomId), listWarnings(store, roomId), listAlerts(store, roomId)]);
  const joins = events.filter((event) => event.type === "participant_joined");
  const times = [...joins.map((event) => event.at), ...segments.map((segment) => segment.at)].sort();
  const startedAt = times[0] ?? null;
  const ended = callEnded(events);
  const endedAt = ended?.at ?? null;
  const durationSeconds = startedAt && endedAt ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)) : null;
  const participants = [...new Set([
    ...joins.map((event) => event.role).filter((role): role is "caller" | "receiver" => role === "caller" || role === "receiver"),
    ...segments.map((segment) => segment.speaker),
  ])].sort();
  const statusChanges = events.filter((event) => event.type === "monitoring_status" && event.status)
    .map((event) => ({ status: event.status as MonitoringStatus, reason: event.reason, at: event.at }));
  const highestConcern = warnings.reduce<ConcernLevel>((level, warning) =>
    concernRank(warning.concernLevel) > concernRank(level) ? warning.concernLevel : level, "none");
  return {
    roomId, startedAt, endedAt, durationSeconds, participants, highestConcern,
    monitoringStatus: ended ? "ended" : statusChanges.at(-1)?.status ?? "unknown",
    warningCount: warnings.length,
    alertCount: alerts.filter((alert) => alert.status === "delivered" || alert.status === "simulated").length,
    statusChanges, warnings, alerts, segments,
  };
}

export function summarize(detail: CallDetail): CallSummary {
  const { roomId, startedAt, endedAt, durationSeconds, participants, highestConcern, monitoringStatus, warningCount, alertCount } = detail;
  return { roomId, startedAt, endedAt, durationSeconds, participants, highestConcern, monitoringStatus, warningCount, alertCount };
}