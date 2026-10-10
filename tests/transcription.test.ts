import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { issueHistoryAccess, verifyHistoryAccess } from "../lib/history-access.ts";
import { mergeSegments, validSegment, type CaptionSegment } from "../lib/transcription.ts";

process.env.SESSION_SIGNING_SECRET = randomBytes(32).toString("hex");
const roomId = "call-00000000-0000-0000-0000-000000000000";
const base: CaptionSegment = { roomId, segmentId: "one", speaker: "caller", revision: 1, final: false,
  startMs: 0, endMs: 1000, timestamp: new Date().toISOString(), language: "en", original: "Hello",
  english: "Hello", urdu: null, translationStatus: "pending", matches: [] };

test("history access rejects cross-call, tampered and expired keys", () => {
  const key = issueHistoryAccess(roomId);
  assert.equal(verifyHistoryAccess(roomId, key), true);
  assert.equal(verifyHistoryAccess(roomId.replace(/0$/, "1"), key), false);
  assert.equal(verifyHistoryAccess(roomId, key + "x"), false);
  const original = Date.now;
  try { Date.now = () => original() + 31 * 86400000; assert.equal(verifyHistoryAccess(roomId, key), false); }
  finally { Date.now = original; }
});

test("caption revisions deduplicate partials and cannot replace final text with interim", () => {
  const finalized = { ...base, final: true, revision: 2 };
  let captions = mergeSegments([base], [finalized, base, finalized]);
  assert.equal(captions.length, 1);
  captions = mergeSegments(captions, [{ ...base, revision: 3 }]);
  assert.deepEqual(captions, [finalized]);
  const translated = { ...finalized, revision: 3, urdu: "ہیلو", translationStatus: "ready" as const };
  assert.deepEqual(mergeSegments(captions, [translated]), [translated]);
});

test("caption schema rejects wrong rooms and invented keyword evidence", () => {
  assert.equal(validSegment(base, roomId), true);
  assert.equal(validSegment(base, "another-room"), false);
  assert.equal(validSegment({ ...base, speaker: "worker" }, roomId), false);
  assert.equal(validSegment({ ...base, matches: [{ category: "threat", evidence: "kill", segmentId: "one", contextSegmentIds: [] }] }, roomId), false);
  const urdu = { ...base, language: "ur", original: "اپنا پاس ورڈ بتائیں", matches: [{ category: "credential_request", evidence: "پاس ورڈ بتا", evidenceLanguage: "ur", segmentId: "one", contextSegmentIds: ["one"] }] };
  assert.equal(validSegment(urdu, roomId), true);
  assert.equal(validSegment({ ...urdu, original: "ہیلو" }, roomId), false);
});
