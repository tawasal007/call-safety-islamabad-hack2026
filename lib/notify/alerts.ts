import { CATEGORY_LABELS, concernRank, type ConcernLevel, type Warning } from "../detector/types.ts";
import { listAlerts, storageKeys, type AlertRecord, type AlertStatus } from "../monitoring/call-record.ts";
import type { DocStore } from "../monitoring/store.ts";
import type { GuardianContact, NotificationChannel, OutgoingAlert } from "./channel.ts";

export const AUTOMATED_NOTICE = "This is an automated detection and may be wrong.";

export type AlertDeps = {
  store: DocStore;
  channel: NotificationChannel;
  guardians: (roomId: string) => GuardianContact[];
  minConcern: ConcernLevel;
  cooldownMs: number;
  maxAttempts: number;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  appUrl: string;
  /** Returns a room-scoped call-log access key for the alert link, or null. */
  linkKey: (roomId: string) => string | null;
  log: (line: string) => void;
};

export function shouldAlert(level: ConcernLevel, minConcern: ConcernLevel): boolean {
  return concernRank(level) >= concernRank(minConcern) && level !== "none";
}

export function backoffMs(attempt: number): number {
  return Math.min(500 * 2 ** (attempt - 1), 4000);
}

export function buildAlertMessage(warning: Warning, options: { appUrl: string; key: string | null; trigger: "warning" | "call_end" }): OutgoingAlert {
  const time = new Date(warning.updatedAt).toLocaleString("en-PK", { timeZone: "Asia/Karachi" });
  const link = `${options.appUrl.replace(/\/+$/, "")}/call-logs?room=${encodeURIComponent(warning.roomId)}${options.key ? `#key=${encodeURIComponent(options.key)}` : ""}`;
  const quotes = warning.evidence.slice(0, 3).map((item) => `"${item.quote}"`).join(" / ");
  const concern = warning.concernLevel[0].toUpperCase() + warning.concernLevel.slice(1);
  return {
    subject: `SadaSafe alert: ${warning.title} (${concern} concern)`,
    body: [
      options.trigger === "call_end" ? "A call has ended with a serious warning." : "SadaSafe detected a possible risk during a live call.",
      `Time: ${time} (Pakistan time)`,
      `Detected: ${warning.categories.map((category) => CATEGORY_LABELS[category]).join(", ")}`,
      `Concern level: ${concern}`,
      `Evidence (exact words from the transcript): ${quotes}`,
      `Suggested action: ${warning.suggestedAction}`,
      `Call log: ${link}`,
      `${AUTOMATED_NOTICE} ${warning.uncertainty}`,
    ].join("\n"),
  };
}

const inFlight = new Set<string>();
const DONE: AlertStatus[] = ["delivered", "simulated"];

/**
 * Sends at most one alert per warning per guardian, with a per-call cooldown
 * for live warnings and capped retries. Never throws: failures are recorded.
 */
export async function alertForWarning(roomId: string, warning: Warning, deps: AlertDeps, trigger: "warning" | "call_end"): Promise<AlertRecord[]> {
  if (warning.roomId !== roomId || !shouldAlert(warning.concernLevel, deps.minConcern)) return [];
  const results: AlertRecord[] = [];
  for (const guardian of deps.guardians(roomId)) {
    if (!guardian.consented) continue;
    const key = storageKeys.alert(roomId, warning.id, guardian.id);
    if (inFlight.has(key)) continue;
    inFlight.add(key);
    try {
      const previous = await deps.store.get<AlertRecord>(key);
      if (previous && DONE.includes(previous.status)) continue;
      // A failed or suppressed live alert is retried only by the end-of-call pass.
      if (previous && trigger === "warning") continue;
      const message = buildAlertMessage(warning, { appUrl: deps.appUrl, key: deps.linkKey(roomId), trigger });
      const base = {
        id: `${warning.id}__${guardian.id}`, warningId: warning.id, warningVersion: warning.version,
        guardianId: guardian.id, guardianName: guardian.name, channel: deps.channel.name, trigger,
        subject: message.subject, body: message.body,
      };
      if (trigger === "warning") {
        const nowMs = deps.now().getTime();
        const recent = (await listAlerts(deps.store, roomId)).find((alert) =>
          alert.guardianId === guardian.id && DONE.includes(alert.status) && nowMs - Date.parse(alert.at) < deps.cooldownMs);
        if (recent) {
          const record: AlertRecord = { ...base, status: "suppressed_cooldown", attempts: 0, at: deps.now().toISOString() };
          await deps.store.put(key, record);
          results.push(record);
          continue;
        }
      }
      let attempts = 0;
      let record: AlertRecord | null = null;
      while (attempts < deps.maxAttempts && !record) {
        attempts += 1;
        let outcome;
        try { outcome = await deps.channel.send(guardian, message); }
        catch (error) { outcome = { ok: false as const, retryable: true, error: error instanceof Error ? error.message : "send failed" }; }
        if (outcome.ok) {
          record = { ...base, status: outcome.simulated ? "simulated" : "delivered", attempts, at: deps.now().toISOString() };
        } else if (!outcome.retryable || attempts >= deps.maxAttempts) {
          record = { ...base, status: "failed", attempts, error: outcome.error.slice(0, 200), at: deps.now().toISOString() };
        } else {
          await deps.sleep(backoffMs(attempts));
        }
      }
      if (record) {
        await deps.store.put(key, record);
        deps.log(`[notify] alert ${record.status} for warning ${warning.id.slice(0, 8)} guardian ${guardian.id} after ${record.attempts} attempt(s)`);
        results.push(record);
      }
    } catch (error) {
      deps.log(`[notify] alert bookkeeping failed for guardian ${guardian.id}: ${error instanceof Error ? error.message : "unknown error"}`);
    } finally {
      inFlight.delete(key);
    }
  }
  return results;
}
