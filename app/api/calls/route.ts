import { NextRequest, NextResponse } from "next/server";
import { verifyHistoryAccess } from "@/lib/history-access";
import { workerRequest } from "@/lib/worker-client";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!Array.isArray(body?.entries) || body.entries.length > 30) return NextResponse.json({ error: "Provide at most 30 calls." }, { status: 400 });
  if (body.entries.some((e: { roomId?: unknown; historyKey?: unknown }) => !e || typeof e.roomId !== "string" || !verifyHistoryAccess(e.roomId, e.historyKey))) {
    return NextResponse.json({ error: "Call history access has expired or is invalid." }, { status: 403 });
  }
  // Independent snapshots run together, so an unavailable service cannot turn
  // thirty saved calls into thirty sequential timeout waits.
  const logs = await Promise.all(body.entries.map(async (entry: { roomId: string }) => {
    try {
      const log = await workerRequest(`/calls/${encodeURIComponent(entry.roomId)}`);
      return { roomId: log.roomId, startedAt: log.startedAt, endedAt: log.endedAt, status: log.status,
        message: log.message, segmentCount: log.segments.length,
        matchCount: log.segments.reduce((n: number, s: { matches: unknown[] }) => n + s.matches.length, 0) };
    } catch { return { roomId: entry.roomId, status: "unavailable", message: "Saved log is unavailable. Check transcription service." }; }
  }));
  return NextResponse.json({ calls: logs }, { headers: { "Cache-Control": "no-store" } });
}
