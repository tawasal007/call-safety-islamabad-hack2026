import { NextRequest, NextResponse } from "next/server";
import { verifyHistoryAccess } from "@/lib/history-access";
import { workerRequest } from "@/lib/worker-client";

export const runtime = "nodejs";
export async function POST(request: NextRequest, context: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await context.params;
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!verifyHistoryAccess(roomId, body?.historyKey)) return NextResponse.json({ error: "Invalid or expired history access." }, { status: 403 });
  try { return NextResponse.json(await workerRequest(`/calls/${encodeURIComponent(roomId)}`), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Call log unavailable. Check transcription service." }, { status: 503 }); }
}
