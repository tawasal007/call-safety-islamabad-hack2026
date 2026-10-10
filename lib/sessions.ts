import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const SESSION_LIFETIME_MS = 2 * 60 * 60 * 1000;
const ARCHIVE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export type ParticipantRole = "caller" | "receiver";
export type CallLanguage = "en" | "ur" | "pa";

type Invitation = { version: 1 | 2; roomId: string; role: ParticipantRole; expiresAt: number; language?: CallLanguage };
type ArchiveAccess = { version: 1; purpose: "call-log"; roomId: string; expiresAt: number };

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

function issueInvitation(roomId: string, role: ParticipantRole, expiresAt: number, language: CallLanguage): string {
  const invitation: Invitation = { version: 2, roomId, role, expiresAt, language };
  const payload = Buffer.from(JSON.stringify(invitation)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

// Invitations work across serverless instances without an in-memory room map.
export function createSession(language: CallLanguage = "en") {
  if (!["en", "ur", "pa"].includes(language)) throw new Error("Unsupported call language");
  const roomId = `call-${randomUUID()}`;
  const expiresAt = Date.now() + SESSION_LIFETIME_MS;
  return {
    roomId,
    callerAccessKey: issueInvitation(roomId, "caller", expiresAt, language),
    receiverAccessKey: issueInvitation(roomId, "receiver", expiresAt, language),
    language,
    expiresAt,
  };
}

export function admitParticipant(
  roomId: string,
  accessKey: string,
): ParticipantRole | null {
  return admitParticipantWithLanguage(roomId, accessKey)?.role ?? null;
}

export function admitParticipantWithLanguage(
  roomId: string,
  accessKey: string,
): { role: ParticipantRole; language: CallLanguage } | null {
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
      (invitation.version !== 1 && invitation.version !== 2) || invitation.roomId !== roomId ||
      !Number.isSafeInteger(invitation.expiresAt) || invitation.expiresAt <= Date.now() ||
      (invitation.role !== "caller" && invitation.role !== "receiver")
    ) return null;
    const language = invitation.version === 1 ? "en" : invitation.language;
    if (language !== "en" && language !== "ur" && language !== "pa") return null;
    return { role: invitation.role, language };
  } catch { return null; }
}

export function issueArchiveAccess(roomId: string): string {
  const payload = Buffer.from(JSON.stringify({
    version: 1, purpose: "call-log", roomId, expiresAt: Date.now() + ARCHIVE_LIFETIME_MS,
  } satisfies ArchiveAccess)).toString("base64url");
  return `${payload}.${createHmac("sha256", signingSecret()).update(`call-safety-archive:${payload}`).digest("base64url")}`;
}

export function admitArchiveAccess(roomId: string, accessKey: string): boolean {
  if (!/^call-[0-9a-f-]{36}$/.test(roomId) || !accessKey || accessKey.length > 2048) return false;
  const parts = accessKey.split(".");
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) return false;
  const [payload, signature] = parts;
  const expected = Buffer.from(createHmac("sha256", signingSecret()).update(`call-safety-archive:${payload}`).digest("base64url"));
  const supplied = Buffer.from(signature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return false;
  try {
    const access = JSON.parse(Buffer.from(payload, "base64url").toString()) as ArchiveAccess;
    return access.version === 1 && access.purpose === "call-log" && access.roomId === roomId &&
      Number.isSafeInteger(access.expiresAt) && access.expiresAt > Date.now();
  } catch { return false; }
}

/** Returns the room ID of a valid, unexpired archive key, or null. */
export function archiveKeyRoomId(accessKey: string): string | null {
  if (!accessKey || accessKey.length > 2048) return null;
  try {
    const payload = accessKey.split(".")[0];
    const roomId = (JSON.parse(Buffer.from(payload, "base64url").toString()) as Partial<ArchiveAccess>).roomId;
    return typeof roomId === "string" && admitArchiveAccess(roomId, accessKey) ? roomId : null;
  } catch { return null; }
}