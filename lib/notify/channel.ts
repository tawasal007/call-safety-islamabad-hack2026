// Generic notification channel adapter. Add a new channel (email via Resend,
// Telegram, SMS...) by implementing NotificationChannel and registering it in
// channelFromEnv. Channels must never log recipient addresses or message bodies.

export type GuardianContact = {
  id: string;
  name: string;
  /** Address for the configured channel (email, chat ID, phone). Server-side only. */
  address: string;
  /** Explicit consent to receive call-safety alerts. Unconsented contacts are never alerted. */
  consented: boolean;
};

export type OutgoingAlert = { subject: string; body: string };

export type DeliveryResult =
  | { ok: true; simulated: boolean; providerMessageId?: string }
  | { ok: false; retryable: boolean; error: string };

export interface NotificationChannel {
  readonly name: string;
  send(to: GuardianContact, message: OutgoingAlert): Promise<DeliveryResult>;
}

/**
 * Demo channel used until a real provider is connected. It sends nothing:
 * the alert is recorded in the call log with status "simulated" so the UI
 * never claims a parent was actually contacted.
 */
export function demoOutboxChannel(log: (line: string) => void = console.info): NotificationChannel {
  return {
    name: "demo-outbox",
    async send(to) {
      log(`[notify:demo-outbox] alert recorded for ${to.id} (simulated, nothing sent)`);
      return { ok: true, simulated: true };
    },
  };
}

export function channelFromEnv(env: Record<string, string | undefined> = process.env): NotificationChannel {
  const name = env.NOTIFY_CHANNEL?.trim().toLowerCase() || "demo-outbox";
  if (name !== "demo-outbox") console.warn(`[notify] NOTIFY_CHANNEL "${name}" is not implemented yet; using demo-outbox`);
  return demoOutboxChannel();
}