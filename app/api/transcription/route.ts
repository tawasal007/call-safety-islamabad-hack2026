import { NextRequest, NextResponse } from "next/server";
import { admitParticipant, sessionSigningConfigured } from "@/lib/sessions";
import { workerRequest } from "@/lib/worker-client";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (!body || typeof body.roomId !== "string" || typeof body.accessKey !== "string" ||
      !["auto", "en", "ur"].includes(body.language)) {
    return NextResponse.json({ error: "Room, invitation and language are required." }, { status: 400 });
  }
  if (!sessionSigningConfigured() || !admitParticipant(body.roomId, body.accessKey)) {
    return NextResponse.json({ error: "Invalid or expired invitation." }, { status: 403 });
  }
  try {
    const role = admitParticipant(body.roomId, body.accessKey);
    return NextResponse.json(await workerRequest("/sessions", { roomId: body.roomId, role, language: body.language }),
      { headers: { "Cache-Control": "no-store" } });
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error && cause.message.startsWith("Transcription worker") ? cause.message : "Transcription service is unavailable. Audio calls remain available." }, { status: 503 });
  }
}
