import { CATEGORY_LABELS, concernRank, type Category, type ConcernLevel, type DetectorResult, type DetectorSegment, type Warning, type WarningEvidence } from "./types.ts";

export const KIDNAPPING_UNCERTAINTY = "The system cannot tell whether this claim is genuine or fabricated.";
const MERGE_WINDOW_MS = 3 * 60 * 1000;

/** Headline wording is chosen here, not by the model, so required phrasing is guaranteed. */
export function titleFor(categories: Category[]): string {
  if (categories.includes("kidnapping_claim")) return "Kidnapping claim \u2014 unverified";
  if (categories.includes("threat_of_harm")) return "Threat of harm";
  if (categories.includes("extortion")) return "Extortion demand";
  if (categories.includes("credential_theft") || categories.includes("financial_fraud")) return "Possible scam";
  return "Pressure tactics";
}

export function defaultAction(categories: Category[]): string {
  if (categories.includes("kidnapping_claim")) return "Do not send money. Check on the person directly or through a trusted family member, and get help from someone you trust.";
  if (categories.includes("threat_of_harm")) return "Stay somewhere safe, tell someone nearby, and seek help. You can end the call.";
  if (categories.includes("extortion")) return "Do not pay or send anything. Keep a record and ask someone you trust for help.";
  if (categories.includes("credential_theft")) return "Do not share any code, PIN or password. Hang up and call your bank on its official number.";
  if (categories.includes("financial_fraud")) return "Do not send money. Verify the request through an official channel you look up yourself.";
  return "You can end the call and talk to someone you trust before acting.";
}

function defaultUncertainty(categories: Category[]): string {
  if (categories.includes("credential_theft") || categories.includes("financial_fraud")) return "The caller's identity and intent cannot be verified from speech alone.";
  return "This is an automated reading of the transcript and may be wrong.";
}

// Model text must not declare a kidnapping genuine/fake or a scam certain.
const VERDICT_PATTERN = /\b(genuine|is (?:a )?(?:real|fake|hoax)|definitely|confirmed|certainly)\b/i;

function safeWording(result: DetectorResult): Pick<Warning, "explanation" | "suggestedAction" | "uncertainty"> {
  let explanation = result.explanation || "The caller's words match a known risk pattern.";
  if (VERDICT_PATTERN.test(explanation)) {
    explanation = result.categories.includes("kidnapping_claim")
      ? "The caller claims to be holding someone and links it to a demand."
      : `The caller's words match a ${titleFor(result.categories).toLowerCase()} pattern.`;
  }
  explanation = explanation.replace(/\b(t)his is (?:a )?scam\b/gi, (_match, t: string) => `${t}his may be a scam`);
  const suggestedAction = result.suggestedAction || defaultAction(result.categories);
  let uncertainty = result.uncertainty || defaultUncertainty(result.categories);
  if (result.categories.includes("kidnapping_claim") && !uncertainty.includes(KIDNAPPING_UNCERTAINTY)) {
    uncertainty = VERDICT_PATTERN.test(uncertainty) ? KIDNAPPING_UNCERTAINTY : `${KIDNAPPING_UNCERTAINTY} ${uncertainty}`;
  }
  return { explanation, suggestedAction, uncertainty };
}

export type WarningChange =
  | { kind: "none"; reason: "below_threshold" | "duplicate" }
  | { kind: "created" | "updated"; warning: Warning };

function evidenceKey(item: { segmentId: string; quote: string }) {
  return `${item.segmentId}\u0000${item.quote}`;
}

function maxConcern(a: ConcernLevel, b: ConcernLevel): ConcernLevel {
  return concernRank(a) >= concernRank(b) ? a : b;
}

/**
 * Turns a validated result into a new warning, an update to a related
 * warning, or nothing. Concern never decreases, so a later harmless sentence
 * cannot erase a serious warning.
 */
export function applyResult(
  existing: Warning[],
  result: DetectorResult,
  context: { roomId: string; now: Date; segments: DetectorSegment[]; minConcern: ConcernLevel; newId: () => string },
): WarningChange {
  if (concernRank(result.concernLevel) < concernRank(context.minConcern)) return { kind: "none", reason: "below_threshold" };
  const at = new Map(context.segments.map((segment) => [segment.id, segment.at]));
  const now = context.now.toISOString();
  const newEvidence: WarningEvidence[] = result.evidence.map((item) => ({ ...item, at: at.get(item.segmentId) ?? now }));
  const wording = safeWording(result);

  const related = [...existing]
    .filter((warning) => warning.roomId === context.roomId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .find((warning) =>
      warning.categories.some((category) => result.categories.includes(category)) ||
      warning.sourceSegmentIds.some((id) => result.sourceSegmentIds.includes(id)) ||
      (result.categories.includes("coercion") && context.now.getTime() - Date.parse(warning.updatedAt) <= MERGE_WINDOW_MS));

  if (!related) {
    return {
      kind: "created",
      warning: {
        id: context.newId(), roomId: context.roomId, version: 1, title: titleFor(result.categories),
        categories: result.categories, concernLevel: result.concernLevel, evidence: newEvidence,
        sourceSegmentIds: result.sourceSegmentIds, ...wording, createdAt: now, updatedAt: now,
      },
    };
  }

  const categories = [...new Set([...related.categories, ...result.categories])];
  const keys = new Set(related.evidence.map(evidenceKey));
  const addedEvidence = newEvidence.filter((item) => !keys.has(evidenceKey(item)));
  const concernLevel = maxConcern(related.concernLevel, result.concernLevel);
  const changed = categories.length !== related.categories.length || addedEvidence.length > 0 || concernLevel !== related.concernLevel;
  if (!changed) return { kind: "none", reason: "duplicate" };

  const useNewWording = concernRank(result.concernLevel) >= concernRank(related.concernLevel);
  const merged: Warning = {
    ...related,
    version: related.version + 1,
    title: titleFor(categories),
    categories,
    concernLevel,
    evidence: [...related.evidence, ...addedEvidence].slice(-8),
    sourceSegmentIds: [...new Set([...related.sourceSegmentIds, ...result.sourceSegmentIds])],
    ...(useNewWording ? wording : {}),
    updatedAt: now,
  };
  if (categories.includes("kidnapping_claim") && !merged.uncertainty.includes(KIDNAPPING_UNCERTAINTY)) {
    merged.uncertainty = `${KIDNAPPING_UNCERTAINTY} ${merged.uncertainty}`.trim();
  }
  return { kind: "updated", warning: merged };
}

export function categoryLabels(categories: Category[]): string {
  return categories.map((category) => CATEGORY_LABELS[category]).join(", ");
}