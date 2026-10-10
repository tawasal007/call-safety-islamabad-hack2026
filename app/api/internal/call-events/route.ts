import { after, NextRequest, NextResponse } from "next/server";
import { recordEvent } from "@/lib/monitoring/call-record";
import { finalizeCall } from "@/lib/monitoring/pipeline";
import { runtimeDeps } from "@/lib/monitoring/runtime";
import { workerAuthorized } from "@/lib/worker-auth";

export const runtime = "nodejs";

const TYPES = new Set(["participant_joined", "participant_left", "call_ended"]);

/** Session lifecycle events from the transcription worker, recorded in the call log. */
export async function POST(request: NextRequest) {
  if (!workerAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const { roomId, type, role, at } = body;
  if (typeof roomId !== "string" || !/^call-[0-9a-f-]{36}$/.test(roomId) ||
      typeof type !== "string" || !TYPES.has(type) ||
      (role !== undefined && role !== "caller" && role !== "receiver") ||
      typeof at !== "string" || !Number.isFinite(Date.parse(at))) {
    return NextResponse.json({ error: "Invalid call event" }, { status: 400 });
  }
  try {
    const deps = runtimeDeps();
    await recordEvent(deps.store, roomId, {
      type: type as "participant_joined" | "participant_left" | "call_ended",
      role: role as "caller" | "receiver" | undefined,
      at: new Date(at).toISOString(),
    });
    if (type === "call_ended") after(() => finalizeCall(roomId, deps));
  } catch (error) {
    console.error(`[monitor] call event not recorded: ${error instanceof Error ? error.message : "unknown error"}`);
    return NextResponse.json({ error: "Call event could not be recorded" }, { status: 503 });
  }
  return NextResponse.json({ recorded: true }, { headers: { "Cache-Control": "no-store" } });
}