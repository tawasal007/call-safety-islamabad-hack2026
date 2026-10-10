import { createHmac, timingSafeEqual } from "node:crypto";

function signature(payload: string) {
  const secret = process.env.SESSION_SIGNING_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("Session signing is not configured.");
  return createHmac("sha256", secret).update(`call-safety-history:${payload}`).digest("base64url");
}

export function issueHistoryAccess(roomId: string) {
  const payload = Buffer.from(JSON.stringify({ roomId, expiresAt: Date.now() + 30 * 86400000 })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyHistoryAccess(roomId: string, key: unknown): boolean {
  if (!/^call-[0-9a-f-]{36}$/.test(roomId) || typeof key !== "string" || key.length > 2048) return false;
  try {
    const [payload, supplied, extra] = key.split(".");
    if (!payload || !supplied || extra) return false;
    const actual = Buffer.from(supplied), expected = Buffer.from(signature(payload));
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.roomId === roomId && Number.isSafeInteger(data.expiresAt) && data.expiresAt > Date.now();
  } catch { return false; }
}
