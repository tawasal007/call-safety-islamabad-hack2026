import { NextRequest, NextResponse } from "next/server";
import { readCallLog } from "@/lib/call-logs";
import { buildCallDetail, summarize } from "@/lib/monitoring/call-record";
import { defaultStore } from "@/lib/monitoring/store";
import { archiveKeyRoomId, sessionSigningConfigured } from "@/lib/sessions";

export const runtime = "nodejs";

const MAX_KEYS = 25;

/**
 * Lists call summaries. Access is proven per call: the browser sends the
 * room-scoped archive keys it holds in X-Call-Access (comma-separated). Keys
 * are never accepted in the query string, so they stay out of access logs.
 */
export async function GET(request: NextRequest) {
  if (!sessionSigningConfigured()) return NextResponse.json({ error: "Server is not configured." }, { status: 503 });
  const keys = (request.headers.get("x-call-access") ?? "").split(",").map((key) => key.trim()).filter(Boolean);
  if (keys.length > MAX_KEYS) return NextResponse.json({ error: `At most ${MAX_KEYS} calls per request.` }, { status: 400 });
  const rooms = [...new Set(keys.map(archiveKeyRoomId).filter((room): room is string => !!room))];
  const store = defaultStore();
  const calls = await Promise.all(rooms.map(async (roomId) => {
    try { return summarize(await buildCallDetail(store, roomId, await readCallLog(roomId))); }
    catch { return { roomId, error: "Could not load this call." }; }
  }));
  return NextResponse.json({ calls, rejected: keys.length - rooms.length }, { headers: { "Cache-Control": "no-store" } });
}