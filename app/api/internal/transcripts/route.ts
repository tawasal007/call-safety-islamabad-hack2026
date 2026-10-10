import { after, NextRequest, NextResponse } from "next/server";
import { saveTranscriptSegment, type TranscriptSegment } from "@/lib/call-logs";
import { processSegment } from "@/lib/monitoring/pipeline";
import { runtimeDeps } from "@/lib/monitoring/runtime";
import { workerAuthorized } from "@/lib/worker-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!workerAuthorized(request.headers.get("authorization"))) {
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
  const segment = {
    id, speaker, text: text.trim(), at, language,
    translation: typeof translation === "string" ? translation.trim() : null,
    translatedText: typeof translation === "string" ? translation.trim() : undefined,
  } as TranscriptSegment;
  const saved = await saveTranscriptSegment(roomId, segment);
  // Detection runs after the response is sent, in its own per-room queue, so
  // LLM latency or failure never delays the worker or the call.
  if (saved && speaker === "caller") {
    after(async () => {
      try { await processSegment(roomId, segment, runtimeDeps()); }
      catch (error) { console.error(`[monitor] could not start analysis: ${error instanceof Error ? error.message : "unknown error"}`); }
    });
  }
  return NextResponse.json({ saved }, { headers: { "Cache-Control": "no-store" } });
}
