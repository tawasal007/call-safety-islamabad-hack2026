import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { formatCallLog, readCallLog, saveTranscriptSegment } from "../lib/call-logs.ts";

test("persists both speakers in order and deduplicates retries", async () => {
  const roomId = `call-${randomUUID()}`;
  const directory = path.join(process.cwd(), "data", "call-logs", roomId);
  const caller = { id: randomUUID(), speaker: "caller" as const, text: "Hello there", at: new Date().toISOString() };
  const receiver = { id: randomUUID(), speaker: "receiver" as const, text: "I can hear you", at: new Date().toISOString() };
  try {
    assert.equal(await saveTranscriptSegment(roomId, caller), true);
    assert.equal(await saveTranscriptSegment(roomId, caller), false);
    assert.equal(await saveTranscriptSegment(roomId, receiver), true);
    assert.deepEqual(await readCallLog(roomId), [caller, receiver]);
    const text = await readFile(path.join(directory, "transcript.txt"), "utf8");
    assert.equal(text, formatCallLog(roomId, [caller, receiver]));
  } finally {
    assert.equal(directory.startsWith(path.join(process.cwd(), "data", "call-logs") + path.sep), true);
    await rm(directory, { recursive: true, force: true });
  }
});
