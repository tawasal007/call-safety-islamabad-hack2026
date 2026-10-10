import { NextRequest, NextResponse } from "next/server";
import { liveKitConfig } from "@/lib/livekit";
import { createSession, sessionSigningConfigured } from "@/lib/sessions";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!liveKitConfig()) {
    return NextResponse.json(
      { error: "LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET." },
      { status: 503 },
    );
  }

  if (!sessionSigningConfigured()) {
    return NextResponse.json({ error: "Call invitations are not configured on the server." }, { status: 503 });
  }

  const session = createSession();
  const pageOrigin = request.headers.get("origin") || request.nextUrl.origin;
  const inviteUrl = new URL(`/call/${session.roomId}`, pageOrigin);
  inviteUrl.searchParams.set("invite", session.receiverAccessKey);

  return NextResponse.json({
    roomId: session.roomId,
    callerAccessKey: session.callerAccessKey,
    inviteUrl: inviteUrl.toString(),
  }, { headers: { "Cache-Control": "no-store" } });
}
