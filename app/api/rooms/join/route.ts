import { NextRequest, NextResponse } from "next/server";
import { liveKitConfig, makeParticipantToken } from "@/lib/livekit";
import { admitParticipant, sessionSigningConfigured } from "@/lib/sessions";
import { issueHistoryAccess } from "@/lib/history-access";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const config = liveKitConfig();
  if (!config || !sessionSigningConfigured()) {
    return NextResponse.json(
      { error: "LiveKit is not configured on the server." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== "object" ||
    !("roomId" in body) ||
    !("accessKey" in body) ||
    typeof body.roomId !== "string" ||
    typeof body.accessKey !== "string"
  ) {
    return NextResponse.json({ error: "Room and invitation are required." }, { status: 400 });
  }

  const role = admitParticipant(body.roomId, body.accessKey);
  if (!role) {
    return NextResponse.json(
      { error: "This call invitation is invalid or has expired." },
      { status: 403 },
    );
  }

  const token = await makeParticipantToken(body.roomId, role, config);
  return NextResponse.json({
    token,
    serverUrl: config.browserUrl,
    role,
    roomId: body.roomId,
    historyAccessKey: issueHistoryAccess(body.roomId),
  }, { headers: { "Cache-Control": "no-store" } });
}
