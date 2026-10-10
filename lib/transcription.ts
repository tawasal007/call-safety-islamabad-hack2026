export type CaptionSegment = {
  roomId: string; segmentId: string; speaker: "caller" | "receiver";
  revision: number; final: boolean; startMs: number; endMs: number;
  timestamp: string; language: string; original: string; english: string;
  urdu: string | null; translationStatus: "pending" | "ready" | "unavailable";
  matches: { category: string; evidence: string; evidenceLanguage?: "en" | "ur"; segmentId: string; contextSegmentIds: string[] }[];
};

export type CallLog = {
  roomId: string; startedAt: string; endedAt: string | null; status: string; message: string;
  segments: CaptionSegment[]; events: { timestamp: string; status: string; message: string }[];
};

export function validSegment(value: unknown, roomId: string): value is CaptionSegment {
  if (!value || typeof value !== "object") return false;
  const s = value as CaptionSegment;
  return s.roomId === roomId && typeof s.segmentId === "string" && s.segmentId.length < 100 &&
    (s.speaker === "caller" || s.speaker === "receiver") && Number.isSafeInteger(s.revision) && s.revision > 0 &&
    typeof s.final === "boolean" && Number.isFinite(s.startMs) && Number.isFinite(s.endMs) && s.endMs >= s.startMs &&
    typeof s.original === "string" && s.original.length < 12000 && typeof s.english === "string" && s.english.length < 12000 &&
    (s.urdu === null || typeof s.urdu === "string") && typeof s.language === "string" &&
    ["pending", "ready", "unavailable"].includes(s.translationStatus) && Array.isArray(s.matches) &&
    s.matches.every(m => m && typeof m.category === "string" && typeof m.evidence === "string" &&
      m.segmentId === s.segmentId && [undefined, "en", "ur"].includes(m.evidenceLanguage) &&
      (m.evidenceLanguage === "ur" ? s.language === "ur" && s.original.includes(m.evidence) : s.english.includes(m.evidence)) && Array.isArray(m.contextSegmentIds));
}

export function mergeSegments(current: CaptionSegment[], incoming: CaptionSegment[]): CaptionSegment[] {
  const map = new Map(current.map(s => [s.segmentId, s]));
  for (const segment of incoming) {
    const old = map.get(segment.segmentId);
    if (!old || (segment.revision > old.revision && !(old.final && !segment.final))) map.set(segment.segmentId, segment);
  }
  return [...map.values()].sort((a, b) => a.startMs - b.startMs || a.segmentId.localeCompare(b.segmentId));
}
