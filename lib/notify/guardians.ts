import type { GuardianContact } from "./channel.ts";

/**
 * TEMPORARY hardcoded guardian list (team decision for the hackathon demo).
 * Replace with a server-side guardian store plus a consent form once real
 * delivery (for example email via Resend) is connected. The address below is
 * a non-routable placeholder; never commit a real person's contact details.
 */
export const DEMO_GUARDIANS: readonly GuardianContact[] = [
  { id: "guardian-demo", name: "Parent (demo)", address: "parent@example.com", consented: true },
];

/** Guardians who should be alerted for a call. Only consented contacts are returned. */
export function guardiansForRoom(_roomId: string, guardians: readonly GuardianContact[] = DEMO_GUARDIANS): GuardianContact[] {
  return guardians.filter((guardian) => guardian.consented);
}