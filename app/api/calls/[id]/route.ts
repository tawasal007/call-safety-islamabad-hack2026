import { NextRequest, NextResponse } from "next/server";
import { readCallLog } from "@/lib/call-logs";
import { buildCallDetail } from "@/lib/monitoring/call-record";
import { defaultStore } from "@/lib/monitoring/store";
import { admitArchiveAccess, sessionSigningConfigured } from "@/lib/sessions";
import { bearerToken } from "@/lib/worker-auth";

export const runtime = "nodejs";

/** Full call record (warnings, alerts, status changes, transcript) for a holder of that room's archive key. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!sessionSigningConfigured()) return NextResponse.json({ error: "Server is not configured." }, { status: 503 });
  if (!admitArchiveAccess(id, bearerToken(request.headers.get("authorization")))) {
    return NextResponse.json({ error: "Call log access denied or expired." }, { status: 403 });
  }
  try {
    const detail = await buildCallDetail(defaultStore(), id, await readCallLog(id));
    return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load this call." }, { status: 503 });
  }
}