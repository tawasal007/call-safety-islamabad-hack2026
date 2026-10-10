import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { runDetector } from "@/lib/detector/detect";
import { providerFromEnv } from "@/lib/detector/provider";
import { applyResult } from "@/lib/detector/warnings";
import type { DetectorSegment, Warning } from "@/lib/detector/types";
import { admitParticipant } from "@/lib/sessions";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  let body: { roomId?: string; accessKey?: string; segments?: DetectorSegment[]; warnings?: Warning[] };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  if (!body.roomId || !body.accessKey || admitParticipant(body.roomId, body.accessKey) !== "receiver") {
    return NextResponse.json({ error: "Receiver access required" }, { status: 403 });
  }
  const segments = body.segments;
  if (!Array.isArray(segments) || segments.length < 1 || segments.length > 8 || segments.some((s) =>
    !s || typeof s.id !== "string" || typeof s.text !== "string" || s.text.length > 5000 ||
    (s.speaker !== "caller" && s.speaker !== "receiver") || typeof s.at !== "string")) {
    return NextResponse.json({ error: "Invalid transcript" }, { status: 400 });
  }
  const focus = segments[segments.length - 1];
  if (focus.speaker !== "caller") return NextResponse.json({ warning: null });
  const provider = providerFromEnv();
  if (!provider.configured) return NextResponse.json({ error: provider.reason }, { status: 503 });
  const outcome = await runDetector(provider.provider, segments, focus.id, { timeoutMs: 12000 });
  if (!outcome.ok) return NextResponse.json({ error: outcome.reason }, { status: 503 });
  const change = applyResult(Array.isArray(body.warnings) ? body.warnings.slice(-10) : [], outcome.result, {
    roomId: body.roomId, now: new Date(), segments, minConcern: "medium", newId: randomUUID,
  });
  return NextResponse.json({ warning: change.kind === "none" ? null : change.warning });
}
