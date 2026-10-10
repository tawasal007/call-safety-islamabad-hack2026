import { NextRequest, NextResponse } from "next/server";
import { admitArchiveAccess } from "@/lib/sessions";
import { formatCallLog, readCallLog } from "@/lib/call-logs";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await context.params;
  const key = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!admitArchiveAccess(roomId, key)) {
    return NextResponse.json({ error: "Call log access denied or expired." }, { status: 403 });
  }
  const segments = await readCallLog(roomId);
  if (request.nextUrl.searchParams.get("format") === "txt") {
    return new NextResponse(formatCallLog(roomId, segments), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${roomId}.txt"`, "Cache-Control": "no-store" },
    });
  }
  return NextResponse.json({ roomId, segments }, { headers: { "Cache-Control": "no-store" } });
}
