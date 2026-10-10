// Optional live evaluation against the configured LLM (uses LLM_* from .env.local).
// Run: npm run eval:detector. Sends only the synthetic fixture sentences.
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { providerFromEnv } from "../lib/detector/provider.ts";
import { concernRank, type DetectorSegment } from "../lib/detector/types.ts";
import { listWarnings } from "../lib/monitoring/call-record.ts";
import { processSegment, type PipelineDeps } from "../lib/monitoring/pipeline.ts";
import { localStore } from "../lib/monitoring/store.ts";
import { demoOutboxChannel } from "../lib/notify/channel.ts";
import { DETECTOR_CASES } from "../tests/fixtures/detector-cases.ts";

const config = providerFromEnv();
if (!config.configured) {
  console.error(`Detector not configured: ${config.reason}. Set LLM_PROVIDER, LLM_MODEL and LLM_API_KEY in .env.local.`);
  process.exit(2);
}
const provider = config.provider;
console.log(`Provider: ${provider.name} · model: ${provider.model}\n`);

// ~1,200 tokens per call; the default pace stays under an 8,000 tokens/minute free tier.
const PACE_MS = Number(process.env.EVAL_PACE_MS ?? 9500);
const dir = await mkdtemp(path.join(os.tmpdir(), "call-safety-eval-"));
const latencies: number[] = [];
let failures = 0;
try {
  for (const fixture of DETECTOR_CASES) {
    const store = localStore(dir);
    const roomId = `call-${randomUUID()}`;
    const segments: DetectorSegment[] = [];
    let clock = Date.now();
    const deps: PipelineDeps = {
      store, provider, publish: async () => undefined, readSegments: async () => [...segments],
      now: () => new Date(), newId: () => randomUUID(), timeoutMs: Number(process.env.DETECTOR_TIMEOUT_MS) || 8000,
      contextSize: 8, warningMinConcern: "medium", log: () => undefined,
      alerts: {
        store, channel: demoOutboxChannel(() => undefined), guardians: () => [], minConcern: "high", cooldownMs: 0,
        maxAttempts: 1, sleep: async () => undefined, now: () => new Date(), appUrl: "http://localhost", linkKey: () => null, log: () => undefined,
      },
    };
    const notes: string[] = [];
    for (const turn of fixture.turns) {
      clock += 4000;
      const segment: DetectorSegment = { id: randomUUID(), speaker: turn.speaker, text: turn.text, at: new Date(clock).toISOString() };
      segments.push(segment);
      if (turn.speaker === "caller" && latencies.length + notes.length > 0) await new Promise((resolve) => setTimeout(resolve, PACE_MS));
      const outcome = await processSegment(roomId, segment, deps);
      if (outcome.kind === "analysed") { latencies.push(outcome.latencyMs); notes.push(`${outcome.concernLevel}/${outcome.latencyMs}ms`); }
      else if (outcome.kind === "failed") notes.push(`FAILED: ${outcome.reason}`);
      else notes.push("skipped");
    }
    const strong = (await listWarnings(store, roomId)).filter((warning) => concernRank(warning.concernLevel) >= concernRank("medium"));
    const top = strong.sort((a, b) => concernRank(b.concernLevel) - concernRank(a.concernLevel))[0];
    let pass: boolean;
    if (fixture.expect === "no_warning") pass = strong.length === 0;
    else {
      pass = !!top && (fixture.categories ?? []).every((category) => top.categories.includes(category)) &&
        concernRank(top.concernLevel) >= concernRank(fixture.minConcern ?? "medium") && (!fixture.singleWarning || strong.length === 1);
    }
    if (!pass) failures += 1;
    const got = top ? `${top.concernLevel} [${top.categories.join(", ")}]` : "no warning";
    console.log(`${pass ? "PASS" : "FAIL"}  ${fixture.name.padEnd(42)} expected ${fixture.expect.padEnd(10)} got ${got}  (${notes.join(", ")})`);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
const sorted = [...latencies].sort((a, b) => a - b);
const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
console.log(`\n${DETECTOR_CASES.length - failures}/${DETECTOR_CASES.length} cases passed · median detector latency ${median} ms · max ${sorted.at(-1) ?? 0} ms`);
console.log("Fixture results do not prove live transcription accuracy; repeat the spoken cases on two devices.");
process.exit(failures ? 1 : 0);