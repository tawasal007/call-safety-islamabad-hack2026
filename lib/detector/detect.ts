import { buildMessages } from "./prompt.ts";
import { ProviderError, type LlmProvider } from "./provider.ts";
import type { DetectorResult, DetectorSegment } from "./types.ts";
import { validateDetectorOutput } from "./validate.ts";

export type DetectionOutcome =
  | { ok: true; result: DetectorResult; latencyMs: number }
  | { ok: false; kind: "timeout" | "provider" | "invalid"; reason: string; latencyMs: number };

class DetectorTimeout extends Error {}

/** Calls the LLM once with a hard timeout, then validates the reply. Never throws. */
export async function runDetector(
  provider: LlmProvider,
  window: DetectorSegment[],
  focusSegmentId: string,
  options: { timeoutMs: number },
): Promise<DetectionOutcome> {
  const started = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new DetectorTimeout()); }, options.timeoutMs);
  });
  try {
    const messages = buildMessages(window, focusSegmentId);
    const attempt = () => Promise.race([provider.complete(messages, { signal: controller.signal }), timeout]);
    let raw: string;
    try { raw = await attempt(); }
    catch (error) {
      // One retry for rate limits or transient errors, only if it fits the time budget.
      const wait = error instanceof ProviderError && error.retryable ? Math.max(250, error.retryAfterMs ?? 1000) : Infinity;
      if (Date.now() - started + wait >= options.timeoutMs - 500) throw error;
      await Promise.race([new Promise((resolve) => setTimeout(resolve, wait)), timeout]);
      raw = await attempt();
    }
    const validated = validateDetectorOutput(raw, window);
    const latencyMs = Date.now() - started;
    return validated.ok ? { ok: true, result: validated.result, latencyMs } : { ok: false, kind: "invalid", reason: validated.reason, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - started;
    if (error instanceof DetectorTimeout || controller.signal.aborted) return { ok: false, kind: "timeout", reason: `no reply within ${options.timeoutMs} ms`, latencyMs };
    return { ok: false, kind: "provider", reason: error instanceof Error ? error.message : "provider error", latencyMs };
  } finally {
    clearTimeout(timer);
  }
}