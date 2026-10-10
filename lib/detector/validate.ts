import { CATEGORIES, isConcernLevel, type Category, type DetectorResult, type DetectorSegment, type Evidence } from "./types.ts";

export type ValidationResult = { ok: true; result: DetectorResult } | { ok: false; reason: string };

const LIMITS = { evidence: 6, quote: 300, explanation: 400, action: 300, uncertainty: 300, ids: 12 };

function fail(reason: string): ValidationResult {
  return { ok: false, reason };
}

function clip(value: string, max: number): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}\u2026` : trimmed;
}

// The prompt shows "<" and ">" as single angle quotes; fold them back for matching.
function fold(text: string): string {
  return text.replace(/\u2039/g, "<").replace(/\u203a/g, ">").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/\s+/g, " ");
}

/**
 * Returns the exact source slice matching `quote`, or null when the quote is
 * not a substring of `source`. Only whitespace, curly quotes, surrounding
 * quote marks, and letter case are tolerated; the returned text is always the
 * transcript's own wording, never the model's.
 */
export function findExactQuote(source: string, quote: string): string | null {
  const needle = fold(quote).trim().replace(/^["']+|["']+$/g, "").trim();
  if (needle.length < 2) return null;
  const haystack = fold(source);
  let index = haystack.indexOf(needle);
  if (index < 0) {
    const lower = haystack.toLowerCase();
    // Only use a case-insensitive hit when lowercasing preserves length.
    if (lower.length === haystack.length) index = lower.indexOf(needle.toLowerCase());
  }
  if (index < 0) return null;
  return haystack.slice(index, index + needle.length);
}

function extractJson(raw: string): unknown {
  let text = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fenced) text = fenced[1];
  return JSON.parse(text);
}

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value as string[] : null;
}

/**
 * Parses and validates raw model output against the schema and the transcript
 * window. Any fabricated or misattributed evidence rejects the whole result.
 */
export function validateDetectorOutput(raw: string, window: DetectorSegment[]): ValidationResult {
  let parsed: unknown;
  try { parsed = extractJson(raw); }
  catch { return fail("malformed JSON"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("output is not a JSON object");
  const data = parsed as Record<string, unknown>;

  const rawCategories = stringArray(data.categories);
  if (!rawCategories) return fail("categories must be an array of strings");
  if (rawCategories.some((item) => !(CATEGORIES as readonly string[]).includes(item))) return fail("unknown category");
  const categories = [...new Set(rawCategories)] as Category[];

  if (!isConcernLevel(data.concernLevel)) return fail("invalid concernLevel");
  const concernLevel = data.concernLevel;

  if (!Array.isArray(data.evidence)) return fail("evidence must be an array");
  if (data.evidence.length > LIMITS.evidence) return fail("too many evidence items");
  const rawEvidence: Evidence[] = [];
  for (const item of data.evidence) {
    if (!item || typeof item !== "object") return fail("invalid evidence item");
    const { segmentId, quote } = item as Record<string, unknown>;
    if (typeof segmentId !== "string" || typeof quote !== "string" || !quote.trim()) return fail("invalid evidence item");
    if (quote.length > LIMITS.quote) return fail("evidence quote too long");
    rawEvidence.push({ segmentId, quote });
  }

  const rawSourceIds = stringArray(data.sourceSegmentIds);
  if (!rawSourceIds || rawSourceIds.length > LIMITS.ids) return fail("invalid sourceSegmentIds");

  for (const field of ["explanation", "suggestedAction", "uncertainty"] as const) {
    if (typeof data[field] !== "string") return fail(`${field} must be a string`);
  }

  if (concernLevel === "none" && (categories.length || rawEvidence.length)) return fail("concernLevel none with categories or evidence");
  if ((concernLevel === "medium" || concernLevel === "high") && (!categories.length || !rawEvidence.length)) {
    return fail("warning-level result without categories and evidence");
  }

  const byId = new Map(window.map((segment) => [segment.id, segment]));
  const evidence: Evidence[] = [];
  for (const item of rawEvidence) {
    const segment = byId.get(item.segmentId);
    if (!segment) return fail("evidence cites a segment outside the window");
    if (segment.speaker !== "caller") return fail("evidence cites receiver speech");
    const exact = findExactQuote(segment.text, item.quote) ?? (segment.translatedText ? findExactQuote(segment.translatedText, item.quote) : null);
    if (!exact) return fail("evidence quote is not an exact substring of the cited segment");
    if (!evidence.some((existing) => existing.segmentId === item.segmentId && existing.quote === exact)) {
      evidence.push({ segmentId: item.segmentId, quote: exact });
    }
  }

  for (const id of rawSourceIds) if (!byId.has(id)) return fail("sourceSegmentIds cites a segment outside the window");
  const sourceSegmentIds = [...new Set([...rawSourceIds, ...evidence.map((item) => item.segmentId)])];

  return {
    ok: true,
    result: {
      categories,
      concernLevel,
      evidence,
      sourceSegmentIds,
      explanation: clip(data.explanation as string, LIMITS.explanation),
      suggestedAction: clip(data.suggestedAction as string, LIMITS.action),
      uncertainty: clip(data.uncertainty as string, LIMITS.uncertainty),
    },
  };
}