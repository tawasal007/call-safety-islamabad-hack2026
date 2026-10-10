import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Warning } from "../lib/detector/types.ts";
import { listAlerts } from "../lib/monitoring/call-record.ts";
import { localStore } from "../lib/monitoring/store.ts";
import { alertForWarning, AUTOMATED_NOTICE, backoffMs, shouldAlert, type AlertDeps } from "../lib/notify/alerts.ts";
import { demoOutboxChannel, type DeliveryResult, type GuardianContact, type NotificationChannel } from "../lib/notify/channel.ts";
import { DEMO_GUARDIANS, guardiansForRoom } from "../lib/notify/guardians.ts";

const roomId = "call-00000000-0000-4000-8000-0000000000aa";
const guardian: GuardianContact = { id: "guardian-a", name: "Parent A", address: "parent-a@example.invalid", consented: true };

function warning(id: string, concernLevel: Warning["concernLevel"] = "high"): Warning {
  return {
    id, roomId, version: 1, title: "Threat of harm", categories: ["threat_of_harm"], concernLevel,
    evidence: [{ segmentId: "s1", quote: "I will hurt you tonight.", at: "2026-10-10T10:00:00.000Z" }],
    sourceSegmentIds: ["s1"], explanation: "Caller threatens harm.", suggestedAction: "Tell someone nearby and seek help.",
    uncertainty: "The caller's intent cannot be verified.", createdAt: "2026-10-10T10:00:01.000Z", updatedAt: "2026-10-10T10:00:01.000Z",
  };
}

function recordingChannel(results: DeliveryResult[] = []): NotificationChannel & { sent: { to: string; body: string }[] } {
  const sent: { to: string; body: string }[] = [];
  return {
    name: "test", sent,
    async send(to, message) { sent.push({ to: to.id, body: message.body }); return results.shift() ?? { ok: true, simulated: false }; },
  };
}

async function setup(channel: NotificationChannel, guardians: GuardianContact[] = [guardian]) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "call-safety-alerts-"));
  let now = Date.parse("2026-10-10T10:00:05.000Z");
  const sleeps: number[] = [];
  const deps: AlertDeps = {
    store: localStore(dir), channel, guardians: () => guardians, minConcern: "high", cooldownMs: 120_000, maxAttempts: 3,
    sleep: async (ms) => { sleeps.push(ms); }, now: () => new Date(now), appUrl: "https://app.test/",
    linkKey: () => "room-key", log: () => undefined,
  };
  return { deps, sleeps, advance: (ms: number) => { now += ms; }, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test("alert threshold follows ALERT_MIN_CONCERN", () => {
  assert.equal(shouldAlert("high", "high"), true);
  assert.equal(shouldAlert("medium", "high"), false);
  assert.equal(shouldAlert("medium", "medium"), true);
  assert.equal(shouldAlert("none", "none"), false);
});

test("sends one alert per warning per guardian with the required content", async () => {
  const channel = recordingChannel();
  const { deps, cleanup } = await setup(channel);
  try {
    assert.deepEqual(await alertForWarning(roomId, warning("w-medium", "medium"), deps, "warning"), []);
    const [record] = await alertForWarning(roomId, warning("w1"), deps, "warning");
    assert.equal(record.status, "delivered");
    assert.equal(record.attempts, 1);
    assert.deepEqual(await alertForWarning(roomId, warning("w1"), deps, "warning"), []);
    assert.deepEqual(await alertForWarning(roomId, warning("w1"), deps, "call_end"), []);
    assert.equal(channel.sent.length, 1);
    const body = channel.sent[0].body;
    for (const part of ["\"I will hurt you tonight.\"", "Threat of harm", "Concern level: High", "Tell someone nearby", AUTOMATED_NOTICE,
      `https://app.test/call-logs?room=${roomId}#key=room-key`, "Pakistan time"]) assert.ok(body.includes(part), part);
    const stored = JSON.stringify(await listAlerts(deps.store, roomId));
    assert.equal(stored.includes(guardian.address), false, "contact details are never stored in the call log");
  } finally { await cleanup(); }
});

test("cooldown suppresses a second live alert; the end-of-call pass sends it", async () => {
  const channel = recordingChannel();
  const { deps, advance, cleanup } = await setup(channel);
  try {
    await alertForWarning(roomId, warning("w1"), deps, "warning");
    advance(30_000);
    const [suppressed] = await alertForWarning(roomId, warning("w2"), deps, "warning");
    assert.equal(suppressed.status, "suppressed_cooldown");
    assert.equal(channel.sent.length, 1);
    const [final] = await alertForWarning(roomId, warning("w2"), deps, "call_end");
    assert.equal(final.status, "delivered");
    assert.equal(final.trigger, "call_end");
    assert.equal(channel.sent.length, 2);
  } finally { await cleanup(); }
});

test("retries retryable failures with capped backoff and records failures", async () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(backoffMs), [500, 1000, 2000, 4000, 4000]);
  const flaky = recordingChannel([{ ok: false, retryable: true, error: "timeout" }, { ok: false, retryable: true, error: "timeout" }]);
  const first = await setup(flaky);
  try {
    const [record] = await alertForWarning(roomId, warning("w1"), first.deps, "warning");
    assert.equal(record.status, "delivered");
    assert.equal(record.attempts, 3);
    assert.deepEqual(first.sleeps, [500, 1000]);
  } finally { await first.cleanup(); }
  const broken = recordingChannel([{ ok: false, retryable: false, error: "invalid recipient" }]);
  const second = await setup(broken);
  try {
    const [record] = await alertForWarning(roomId, warning("w1"), second.deps, "warning");
    assert.equal(record.status, "failed");
    assert.equal(record.attempts, 1);
    assert.equal(record.error, "invalid recipient");
  } finally { await second.cleanup(); }
  const throwing: NotificationChannel = { name: "throws", async send() { throw new Error("provider down"); } };
  const third = await setup(throwing);
  try {
    const [record] = await alertForWarning(roomId, warning("w1"), third.deps, "warning");
    assert.equal(record.status, "failed", "a throwing channel never propagates");
    assert.equal(record.attempts, 3);
  } finally { await third.cleanup(); }
});

test("only consented guardians are alerted; the demo channel is labelled simulated", async () => {
  const lines: string[] = [];
  const unconsented: GuardianContact = { ...guardian, id: "guardian-b", consented: false };
  const { deps, cleanup } = await setup(demoOutboxChannel((line) => lines.push(line)), [guardian, unconsented]);
  try {
    const records = await alertForWarning(roomId, warning("w1"), deps, "warning");
    assert.deepEqual(records.map((record) => [record.guardianId, record.status]), [["guardian-a", "simulated"]]);
    assert.equal(lines.join("\n").includes(guardian.address), false, "logs never contain contact details");
  } finally { await cleanup(); }
  assert.equal(guardiansForRoom(roomId, [guardian, unconsented]).length, 1);
  assert.ok(DEMO_GUARDIANS.every((item) => item.address.endsWith("example.com")), "hardcoded guardian stays a placeholder");
});