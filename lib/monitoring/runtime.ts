import { randomUUID } from "node:crypto";
import { readCallLog } from "../call-logs.ts";
import { providerFromEnv } from "../detector/provider.ts";
import { parseConcernLevel } from "../detector/types.ts";
import { channelFromEnv } from "../notify/channel.ts";
import { guardiansForRoom } from "../notify/guardians.ts";
import { issueArchiveAccess } from "../sessions.ts";
import type { PipelineDeps } from "./pipeline.ts";
import { liveKitPublisher } from "./publish.ts";
import { defaultStore } from "./store.ts";

function bounded(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

export function appPublicUrl(env: Record<string, string | undefined> = process.env): string {
  const configured = env.APP_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}

let cached: PipelineDeps | null = null;

/** Production wiring for the monitoring pipeline, built from env vars. */
export function runtimeDeps(): PipelineDeps {
  if (cached) return cached;
  const env = process.env;
  const provider = providerFromEnv(env);
  const store = defaultStore();
  const log = (line: string) => console.info(line);
  cached = {
    store,
    provider: provider.configured ? provider.provider : null,
    providerIssue: provider.configured ? undefined : provider.reason,
    publish: liveKitPublisher(env),
    readSegments: async (roomId) => readCallLog(roomId),
    now: () => new Date(),
    newId: () => randomUUID(),
    timeoutMs: bounded(env.DETECTOR_TIMEOUT_MS, 8000, 1000, 30000),
    contextSize: bounded(env.DETECTOR_CONTEXT_SEGMENTS, 8, 2, 12),
    warningMinConcern: parseConcernLevel(env.WARNING_MIN_CONCERN, "medium"),
    log,
    alerts: {
      store,
      channel: channelFromEnv(env),
      guardians: (roomId) => guardiansForRoom(roomId),
      minConcern: parseConcernLevel(env.ALERT_MIN_CONCERN, "high"),
      cooldownMs: bounded(env.ALERT_COOLDOWN_SECONDS, 120, 0, 3600) * 1000,
      maxAttempts: 3,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => new Date(),
      appUrl: appPublicUrl(env),
      linkKey: (roomId) => { try { return issueArchiveAccess(roomId); } catch { return null; } },
      log,
    },
  };
  return cached;
}