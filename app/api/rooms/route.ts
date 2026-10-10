import { NextRequest, NextResponse } from "next/server";
import { liveKitConfig } from "@/lib/livekit";
import { createSession, sessionSigningConfigured } from "@/lib/sessions";
import type { CallLanguage } from "@/lib/sessions";

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

  let body: unknown;
  try { body = await request.json(); } catch { body = {}; }
  const language = body && typeof body === "object" && "language" in body ? body.language : "en";
  if (language !== "en" && language !== "ur" && language !== "pa") {
    return NextResponse.json({ error: "Choose English, Urdu, or Punjabi." }, { status: 400 });
  }
  const session = createSession(language as CallLanguage);
  const pageOrigin = request.headers.get("origin") || request.nextUrl.origin;
  const inviteUrl = new URL(`/call/${session.roomId}`, pageOrigin);
  inviteUrl.searchParams.set("invite", session.receiverAccessKey);

  return NextResponse.json({
    roomId: session.roomId,
    callerAccessKey: session.callerAccessKey,
    inviteUrl: inviteUrl.toString(),
    language: session.language,
  }, { headers: { "Cache-Control": "no-store" } });
}
