import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { LlmProvider } from "../lib/detector/provider.ts";
import { concernRank, type Category, type ConcernLevel, type DetectorSegment, type MonitoringMessage } from "../lib/detector/types.ts";
import { listAlerts, listWarnings, recordEvent } from "../lib/monitoring/call-record.ts";
import { finalizeCall, processSegment, type PipelineDeps } from "../lib/monitoring/pipeline.ts";
import { localStore } from "../lib/monitoring/store.ts";
import { demoOutboxChannel } from "../lib/notify/channel.ts";
import { DETECTOR_CASES } from "./fixtures/detector-cases.ts";

type Script = (focus: DetectorSegment, all: DetectorSegment[]) => string | Promise<string>;

function reply(categories: Category[], concernLevel: ConcernLevel, quotes: [DetectorSegment, string][]) {
  return JSON.stringify({
    categories, concernLevel, evidence: quotes.map(([segment, quote]) => ({ segmentId: segment.id, quote })),
    sourceSegmentIds: [...new Set(quotes.map(([segment]) => segment.id))], explanation: "Scripted explanation.",
    suggestedAction: "", uncertainty: "",
  });
}
const none = () => reply([], "none", []);

async function harness(script: Script, overrides: Partial<PipelineDeps> = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "call-safety-pipeline-"));
  const store = localStore(dir);
  const roomId = `call-${randomUUID()}`;
  const segments: DetectorSegment[] = [];
  const published: MonitoringMessage[] = [];
  const counter = { calls: 0 };
  const provider: LlmProvider = {
    name: "mock", model: "mock",
    async complete(messages) {
      counter.calls += 1;
      const focusId = /segment \(id="([^"]+)"\)/.exec(messages[1].content)?.[1];
      return script(segments.find((segment) => segment.id === focusId)!, segments);
    },
  };
  let clock = Date.parse("2026-10-10T10:00:00.000Z");
  const deps: PipelineDeps = {
    store, provider, publish: async (_room, message) => { published.push(message); },
    readSegments: async () => [...segments], now: () => new Date(clock), newId: () => randomUUID(),
    timeoutMs: 200, contextSize: 8, warningMinConcern: "medium", log: () => undefined,
    alerts: {
      store, channel: demoOutboxChannel(() => undefined),
      guardians: () => [{ id: "guardian-test", name: "Test parent", address: "test@example.invalid", consented: true }],
      minConcern: "high", cooldownMs: 120_000, maxAttempts: 3, sleep: async () => undefined, now: () => new Date(clock),
      appUrl: "https://app.test", linkKey: () => "key", log: () => undefined,
    },
    ...overrides,
  };
  const say = async (speaker: "caller" | "receiver", text: string) => {
    clock += 5_000;
    const segment: DetectorSegment = { id: randomUUID(), speaker, text, at: new Date(clock).toISOString() };
    segments.push(segment);
    return processSegment(roomId, segment, deps);
  };
  return { dir, store, roomId, segments, published, counter, deps, say, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// What a well-behaved model is expected to answer for each acceptance case,
// one reply per caller turn. The live run (npm run eval:detector) checks the real model.
const SCRIPTS: Record<string, (turn: number, all: DetectorSegment[]) => string> = {
  "credential request": (_t, s) => reply(["credential_theft"], "medium", [[s[0], "Tell me your OTP now."]]),
  "bank impersonation with pressure": (_t, s) => reply(["credential_theft", "financial_fraud"], "high", [[s[0], "I'm from your bank."], [s[0], "Tell me the OTP now or your account will be blocked."]]),
  "direct threat": (_t, s) => reply(["threat_of_harm"], "high", [[s[0], "I will hurt you tonight."]]),
  "extortion": (_t, s) => reply(["extortion"], "high", [[s[0], "Pay me or I will publish your private photos."]]),
  "kidnapping and ransom claim": (_t, s) => reply(["kidnapping_claim", "threat_of_harm"], "high", [[s[0], "We have your brother."], [s[0], "Send money now or we will hurt him."]]),
  "kidnapping claim split across segments": (t, s) => t === 0
    ? reply(["kidnapping_claim"], "medium", [[s[0], "We have your brother."]])
    : reply(["kidnapping_claim", "threat_of_harm"], "high", [[s[0], "We have your brother."], [s[1], "Send money now or we will hurt him."]]),
  "coercion after ransom demand": (t, s) => t === 0
    ? reply(["kidnapping_claim", "threat_of_harm"], "high", [[s[0], "Send money now or we will hurt him."]])
    : reply(["coercion", "kidnapping_claim"], "high", [[s[1], "Don't hang up or contact your family."]]),
  "prompt injection in speech": (_t, s) => reply(["credential_theft"], "medium", [[s[0], "Tell me your OTP now."]]),
};

for (const fixture of DETECTOR_CASES) {
  test(`acceptance case (scripted model): ${fixture.name}`, async () => {
    let callerTurn = 0;
    const h = await harness((_focus, all) => (SCRIPTS[fixture.name] ?? none)(callerTurn++, all));
    try {
      for (const turn of fixture.turns) await h.say(turn.speaker, turn.text);
      const strong = (await listWarnings(h.store, h.roomId)).filter((warning) => concernRank(warning.concernLevel) >= concernRank("medium"));
      assert.equal(h.counter.calls, fixture.turns.filter((turn) => turn.speaker === "caller").length, "only caller speech is analysed");
      if (fixture.expect === "no_warning") {
        assert.equal(strong.length, 0);
        assert.equal(h.published.some((message) => message.type === "warning"), false);
        return;
      }
      assert.ok(strong.length >= 1, "expected a warning");
      const top = strong.sort((a, b) => concernRank(b.concernLevel) - concernRank(a.concernLevel))[0];
      for (const category of fixture.categories ?? []) assert.ok(top.categories.includes(category), category);
      assert.ok(concernRank(top.concernLevel) >= concernRank(fixture.minConcern ?? "medium"));
      if (fixture.singleWarning) {
        assert.equal(strong.length, 1, "related evidence updates one warning");
        assert.ok(top.version >= 2);
      }
      for (const item of top.evidence) {
        assert.ok(h.segments.some((segment) => segment.id === item.segmentId && segment.speaker === "caller" && segment.text.includes(item.quote)));
      }
      const delivered = h.published.filter((message) => message.type === "warning");
      assert.ok(delivered.length >= 1);
      assert.ok(delivered.every((message) => message.roomId === h.roomId));
    } finally { await h.cleanup(); }
  });
}

test("fabricated evidence is rejected and monitoring reports degraded", async () => {
  const h = await harness((focus) => reply(["threat_of_harm"], "high", [[focus, "I know where you live"]]));
  try {
    const outcome = await h.say("caller", "How was your day?");
    assert.equal(outcome.kind, "failed");
    assert.equal((await listWarnings(h.store, h.roomId)).length, 0);
    assert.ok(h.published.some((message) => message.type === "status" && message.status === "degraded"));
  } finally { await h.cleanup(); }
});

test("provider failure and timeout degrade monitoring without throwing", async () => {
  const failing = await harness(() => { throw new Error("HTTP 503"); });
  const hanging = await harness(() => new Promise<string>(() => undefined));
  try {
    assert.deepEqual(await failing.say("caller", "Tell me your OTP now."), { kind: "failed", status: "degraded", reason: "HTTP 503" });
    const timedOut = await hanging.say("caller", "Tell me your OTP now.");
    assert.equal(timedOut.kind === "failed" && timedOut.status, "degraded");
    assert.match(timedOut.kind === "failed" ? timedOut.reason : "", /no reply within 200 ms/);
  } finally { await failing.cleanup(); await hanging.cleanup(); }
});

test("missing LLM configuration is reported as unavailable, never as safe", async () => {
  const h = await harness(none, { provider: null, providerIssue: "LLM_API_KEY is not set" });
  try {
    assert.equal((await h.say("caller", "Tell me your OTP now.")).kind, "failed");
    assert.deepEqual(h.published.map((message) => message.type === "status" && message.status), ["unavailable"]);
  } finally { await h.cleanup(); }
});

test("a later harmless sentence does not erase a serious warning", async () => {
  let turn = 0;
  const h = await harness((focus) => turn++ === 0 ? reply(["threat_of_harm"], "high", [[focus, "I will hurt you tonight."]]) : none());
  try {
    await h.say("caller", "I will hurt you tonight.");
    await h.say("caller", "Anyway, how was your day?");
    const warnings = await listWarnings(h.store, h.roomId);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].concernLevel, "high");
    assert.equal(h.published.filter((message) => message.type === "warning").length, 1);
  } finally { await h.cleanup(); }
});

test("high warning alerts the guardian once, including after the call ends", async () => {
  const h = await harness((focus) => reply(["threat_of_harm"], "high", [[focus, "I will hurt you tonight."]]));
  try {
    await h.say("caller", "I will hurt you tonight.");
    await h.say("caller", "I will hurt you tonight.");
    await finalizeCall(h.roomId, h.deps);
    const alerts = await listAlerts(h.store, h.roomId);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].status, "simulated");
    assert.ok(h.published.some((message) => message.type === "status" && message.status === "ended"));
  } finally { await h.cleanup(); }
});

test("segments arriving after the session ended are rejected as stale", async () => {
  const h = await harness((focus) => reply(["threat_of_harm"], "high", [[focus, "I will hurt you tonight."]]));
  try {
    await recordEvent(h.store, h.roomId, { type: "call_ended", at: "2026-10-10T09:00:00.000Z" });
    assert.deepEqual(await h.say("caller", "I will hurt you tonight."), { kind: "skipped", reason: "stale: session already ended" });
    assert.equal(h.counter.calls, 0);
  } finally { await h.cleanup(); }
});

test("a failed LiveKit publish never breaks analysis or storage", async () => {
  const h = await harness((focus) => reply(["threat_of_harm"], "high", [[focus, "I will hurt you tonight."]]),
    { publish: async () => { throw new Error("room closed"); } });
  try {
    const outcome = await h.say("caller", "I will hurt you tonight.");
    assert.equal(outcome.kind === "analysed" && outcome.change, "created");
    assert.equal((await listWarnings(h.store, h.roomId)).length, 1);
  } finally { await h.cleanup(); }
});
test("caller segments queued behind a slow analysis are coalesced into one LLM call", async () => {
  const focuses: string[] = [];
  const h = await harness((focus) => { focuses.push(focus.text); return none(); });
  try {
    const first = h.say("caller", "Hello there.");
    const second = h.say("caller", "Are you free to talk?");
    assert.deepEqual(await first, { kind: "skipped", reason: "coalesced into a newer caller segment" });
    assert.equal((await second).kind, "analysed");
    assert.deepEqual(focuses, ["Are you free to talk?"]);
  } finally { await h.cleanup(); }
});