import assert from "node:assert/strict";
import test from "node:test";
import type { DetectorResult, DetectorSegment, Warning } from "../lib/detector/types.ts";
import { applyResult, KIDNAPPING_UNCERTAINTY, titleFor } from "../lib/detector/warnings.ts";

const roomId = "call-00000000-0000-4000-8000-000000000001";
const segments: DetectorSegment[] = [
  { id: "s1", speaker: "caller", text: "We have your brother. Send money now or we will hurt him.", at: "2026-10-10T10:00:00.000Z" },
  { id: "s2", speaker: "caller", text: "Don't hang up or contact your family.", at: "2026-10-10T10:00:10.000Z" },
  { id: "s3", speaker: "caller", text: "Tell me your OTP now.", at: "2026-10-10T10:20:00.000Z" },
];
let counter = 0;
const context = (minute = 0) => ({
  roomId, segments, minConcern: "medium" as const, newId: () => `w${++counter}`,
  now: new Date(Date.parse("2026-10-10T10:00:30.000Z") + minute * 60_000),
});

const ransom: DetectorResult = {
  categories: ["kidnapping_claim", "threat_of_harm"], concernLevel: "high",
  evidence: [{ segmentId: "s1", quote: "We have your brother." }, { segmentId: "s1", quote: "Send money now or we will hurt him." }],
  sourceSegmentIds: ["s1"], explanation: "Caller says they hold the receiver's brother and demands money.",
  suggestedAction: "Check on your brother through a trusted contact.", uncertainty: "",
};

function created(result: DetectorResult, existing: Warning[] = []): Warning {
  const change = applyResult(existing, result, context());
  assert.equal(change.kind, "created");
  return (change as { warning: Warning }).warning;
}

test("results below the warning threshold produce nothing", () => {
  const low: DetectorResult = { ...ransom, categories: [], concernLevel: "low", evidence: [], sourceSegmentIds: [] };
  assert.deepEqual(applyResult([], low, context()), { kind: "none", reason: "below_threshold" });
});

test("a repeated identical result is deduplicated", () => {
  const warning = created(ransom);
  assert.deepEqual(applyResult([warning], ransom, context()), { kind: "none", reason: "duplicate" });
});

test("coercion after a ransom demand updates the existing warning", () => {
  const warning = created(ransom);
  const coercion: DetectorResult = {
    categories: ["coercion"], concernLevel: "medium", evidence: [{ segmentId: "s2", quote: "Don't hang up or contact your family." }],
    sourceSegmentIds: ["s2"], explanation: "Caller isolates the receiver.", suggestedAction: "Contact your family.", uncertainty: "",
  };
  const change = applyResult([warning], coercion, context());
  assert.equal(change.kind, "updated");
  if (change.kind !== "updated") return;
  assert.equal(change.warning.id, warning.id);
  assert.equal(change.warning.version, 2);
  assert.equal(change.warning.concernLevel, "high", "concern never decreases");
  assert.deepEqual(change.warning.categories, ["kidnapping_claim", "threat_of_harm", "coercion"]);
  assert.equal(change.warning.evidence.length, 3);
  assert.equal(change.warning.explanation, warning.explanation, "lower-concern update keeps the serious explanation");
});

test("an unrelated later warning is kept separate", () => {
  const warning = created(ransom);
  const otp: DetectorResult = {
    categories: ["credential_theft"], concernLevel: "medium", evidence: [{ segmentId: "s3", quote: "Tell me your OTP now." }],
    sourceSegmentIds: ["s3"], explanation: "Caller asks for an OTP.", suggestedAction: "", uncertainty: "",
  };
  const change = applyResult([warning], otp, context(20));
  assert.equal(change.kind, "created");
  if (change.kind === "created") {
    assert.equal(change.warning.title, "Possible scam");
    assert.match(change.warning.suggestedAction, /Do not share/);
  }
});

test("required wording: kidnapping claims stay unverified, scams stay possible", () => {
  const warning = created({ ...ransom, explanation: "This kidnapping is definitely genuine.", uncertainty: "The claim is real." });
  assert.equal(warning.title, "Kidnapping claim \u2014 unverified");
  assert.doesNotMatch(warning.explanation, /genuine|definitely/i);
  assert.equal(warning.uncertainty, KIDNAPPING_UNCERTAINTY);
  const scam = created({
    categories: ["financial_fraud"], concernLevel: "medium", evidence: [{ segmentId: "s3", quote: "Tell me your OTP now." }],
    sourceSegmentIds: ["s3"], explanation: "This is a scam.", suggestedAction: "", uncertainty: "",
  });
  assert.equal(scam.explanation, "This may be a scam.");
  assert.equal(titleFor(["financial_fraud", "coercion"]), "Possible scam");
  assert.equal(titleFor(["threat_of_harm", "credential_theft"]), "Threat of harm");
});