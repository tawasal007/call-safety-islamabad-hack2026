import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const SESSION_LIFETIME_MS = 2 * 60 * 60 * 1000;

export type ParticipantRole = "caller" | "receiver";

type Invitation = { version: 1; roomId: string; role: ParticipantRole; expiresAt: number };

function signingSecret(): string {
  const secret = process.env.SESSION_SIGNING_SECRET?.trim();
  if (!secret || secret.length < 32 || secret.startsWith("replace-with-")) {
    throw new Error("Set SESSION_SIGNING_SECRET to a random value of at least 32 characters.");
  }
  return secret;
}

export function sessionSigningConfigured(): boolean {
  try { signingSecret(); return true; } catch { return false; }
}

function sign(payload: string): string {
  return createHmac("sha256", signingSecret()).update(`call-safety-invite:${payload}`).digest("base64url");
}

function issueInvitation(roomId: string, role: ParticipantRole, expiresAt: number): string {
  const invitation: Invitation = { version: 1, roomId, role, expiresAt };
  const payload = Buffer.from(JSON.stringify(invitation)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

// Invitations work across serverless instances without an in-memory room map.
export function createSession() {
  const roomId = `call-${randomUUID()}`;
  const expiresAt = Date.now() + SESSION_LIFETIME_MS;
  return {
    roomId,
    callerAccessKey: issueInvitation(roomId, "caller", expiresAt),
    receiverAccessKey: issueInvitation(roomId, "receiver", expiresAt),
    expiresAt,
  };
}

export function admitParticipant(
  roomId: string,
  accessKey: string,
): ParticipantRole | null {
  if (!/^call-[0-9a-f-]{36}$/.test(roomId) || !accessKey || accessKey.length > 2048) return null;
  const parts = accessKey.split(".");
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  const [payload, signature] = parts;
  const expected = Buffer.from(sign(payload));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const invitation = JSON.parse(Buffer.from(payload, "base64url").toString()) as Invitation;
    if (
      invitation.version !== 1 || invitation.roomId !== roomId ||
      !Number.isSafeInteger(invitation.expiresAt) || invitation.expiresAt <= Date.now() ||
      (invitation.role !== "caller" && invitation.role !== "receiver")
    ) return null;
    return invitation.role;
  } catch { return null; }
}
