import type { TranscriptSegment } from "./call-logs";
import type { CallDetail } from "./monitoring/call-record";
import type { Warning } from "./detector/types";
import { concernRank } from "./detector/types";

const key = (roomId: string) => `sadasafe-local-record:${roomId}`;
export type LocalRecord = { segments: TranscriptSegment[]; warnings: Warning[] };
export function readLocalRecord(roomId: string): LocalRecord {
  try {
    const value = JSON.parse(localStorage.getItem(key(roomId)) || "{}");
    return { segments: Array.isArray(value.segments) ? value.segments : [], warnings: Array.isArray(value.warnings) ? value.warnings : [] };
  } catch { return { segments: [], warnings: [] }; }
}
export function saveLocalRecord(roomId: string, record: LocalRecord) {
  try { localStorage.setItem(key(roomId), JSON.stringify({ segments: record.segments.slice(-300), warnings: record.warnings.slice(-30) })); }
  catch { /* Storage may be disabled or full; the live call continues. */ }
}
export function localCallDetail(roomId: string): CallDetail | null {
  const { segments, warnings } = readLocalRecord(roomId);
  if (!segments.length && !warnings.length) return null;
  const highestConcern = warnings.reduce<CallDetail["highestConcern"]>((level, warning) =>
    concernRank(warning.concernLevel) > concernRank(level) ? warning.concernLevel : level, "none");
  return { roomId, startedAt: segments[0]?.at ?? null, endedAt: null, durationSeconds: null,
    participants: [...new Set(segments.map((s) => s.speaker))], highestConcern, monitoringStatus: "unknown",
    warningCount: warnings.length, alertCount: 0, statusChanges: [], warnings, alerts: [], segments };
}
