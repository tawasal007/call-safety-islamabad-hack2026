import { NextRequest, NextResponse } from "next/server";
import { liveKitConfig, makeParticipantToken } from "@/lib/livekit";
import { admitParticipantWithLanguage, issueArchiveAccess, sessionSigningConfigured } from "@/lib/sessions";

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

  const admission = admitParticipantWithLanguage(body.roomId, body.accessKey);
  if (!admission) {
    return NextResponse.json(
      { error: "This call invitation is invalid or has expired." },
      { status: 403 },
    );
  }

  const token = await makeParticipantToken(body.roomId, admission.role, config, admission.language);
  return NextResponse.json({
    token,
    archiveAccessKey: issueArchiveAccess(body.roomId),
    serverUrl: config.browserUrl,
    role: admission.role,
    language: admission.language,
    roomId: body.roomId,
  }, { headers: { "Cache-Control": "no-store" } });
}
