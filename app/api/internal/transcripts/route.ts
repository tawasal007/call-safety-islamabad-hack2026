import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { saveTranscriptSegment, type TranscriptSegment } from "@/lib/call-logs";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const secret = process.env.TRANSCRIPT_WORKER_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || secret.length < 32 || secret.startsWith("replace-with-") ||
      !supplied || Buffer.byteLength(secret) !== Buffer.byteLength(supplied) ||
      !timingSafeEqual(Buffer.from(secret), Buffer.from(supplied))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const { roomId, id, speaker, text, at, language, translation } = body;
  if (typeof roomId !== "string" || !/^call-[0-9a-f-]{36}$/.test(roomId) ||
      typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id) ||
      (speaker !== "caller" && speaker !== "receiver") ||
      typeof text !== "string" || !text.trim() || text.length > 5000 ||
      typeof at !== "string" || !Number.isFinite(Date.parse(at)) ||
      (language !== undefined && language !== "en" && language !== "ur" && language !== "pa") ||
      (translation !== undefined && translation !== null &&
        (typeof translation !== "string" || !translation.trim() || translation.length > 5000))) {
    return NextResponse.json({ error: "Invalid transcript segment" }, { status: 400 });
  }
  const saved = await saveTranscriptSegment(roomId, {
    id, speaker, text: text.trim(), at, language,
    translation: typeof translation === "string" ? translation.trim() : null,
  } as TranscriptSegment);
  return NextResponse.json({ saved }, { headers: { "Cache-Control": "no-store" } });
}
