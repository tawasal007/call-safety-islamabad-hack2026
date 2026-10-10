import { timingSafeEqual } from "node:crypto";

/** Checks the bearer secret shared between the transcription worker and this app. */
export function workerAuthorized(authorization: string | null): boolean {
  const secret = process.env.TRANSCRIPT_WORKER_SECRET?.trim();
  const supplied = authorization?.replace(/^Bearer /, "") ?? "";
  return !!secret && secret.length >= 32 && !secret.startsWith("replace-with-") &&
    !!supplied && Buffer.byteLength(secret) === Buffer.byteLength(supplied) &&
    timingSafeEqual(Buffer.from(secret), Buffer.from(supplied));
}

export function bearerToken(authorization: string | null): string {
  return authorization?.replace(/^Bearer /, "").trim() ?? "";
}