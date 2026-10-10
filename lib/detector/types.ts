// Shared detector and monitoring types. No Node or browser imports here:
// this file is used by server code, tests, and the receiver UI.

export const CATEGORIES = [
  "credential_theft",
  "financial_fraud",
  "threat_of_harm",
  "extortion",
  "kidnapping_claim",
  "coercion",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  credential_theft: "Credential request",
  financial_fraud: "Payment pressure",
  threat_of_harm: "Threat of harm",
  extortion: "Extortion",
  kidnapping_claim: "Kidnapping claim",
  coercion: "Coercion",
};

// concernLevel measures seriousness/urgency for the receiver. It is separate
// from how certain the detector is that fraud is happening (see `uncertainty`).
export const CONCERN_LEVELS = ["none", "low", "medium", "high"] as const;
export type ConcernLevel = (typeof CONCERN_LEVELS)[number];

export function concernRank(level: ConcernLevel): number {
  return CONCERN_LEVELS.indexOf(level);
}

export function isConcernLevel(value: unknown): value is ConcernLevel {
  return typeof value === "string" && (CONCERN_LEVELS as readonly string[]).includes(value);
}

export function parseConcernLevel(value: string | undefined, fallback: ConcernLevel): ConcernLevel {
  const normalized = value?.trim().toLowerCase();
  return isConcernLevel(normalized) ? normalized : fallback;
}

export type MonitoringStatus = "connecting" | "active" | "degraded" | "unavailable" | "ended";

/** A finalized transcript segment as the detector sees it. */
export type DetectorSegment = {
  id: string;
  speaker: "caller" | "receiver";
  /** Original recognized text, in whatever language was spoken. */
  text: string;
  at: string;
  /** Optional BCP-47-ish language code from the transcription module, e.g. "en" or "ur". */
  language?: string;
  /** Optional English translation when the original is not English. */
  translatedText?: string;
};

export type Evidence = { segmentId: string; quote: string };

/** A schema-validated, evidence-validated detector result. */
export type DetectorResult = {
  categories: Category[];
  concernLevel: ConcernLevel;
  evidence: Evidence[];
  sourceSegmentIds: string[];
  explanation: string;
  suggestedAction: string;
  uncertainty: string;
};

export type WarningEvidence = Evidence & { at: string };

/** A receiver-facing warning. Updated in place (version++) as evidence grows. */
export type Warning = {
  id: string;
  roomId: string;
  version: number;
  title: string;
  categories: Category[];
  concernLevel: ConcernLevel;
  evidence: WarningEvidence[];
  sourceSegmentIds: string[];
  explanation: string;
  suggestedAction: string;
  uncertainty: string;
  createdAt: string;
  updatedAt: string;
};

/** LiveKit data topic for server-to-receiver monitoring events. */
export const MONITORING_TOPIC = "call-safety.monitoring";

export type MonitoringMessage =
  | { v: 1; roomId: string; type: "warning"; warning: Warning }
  | { v: 1; roomId: string; type: "status"; status: MonitoringStatus; reason?: string; at: string };