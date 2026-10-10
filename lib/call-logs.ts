import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { get, list, put } from "@vercel/blob";

export type TranscriptSegment = {
  id: string;
  speaker: "caller" | "receiver";
  text: string;
  at: string;
  language?: "en" | "ur" | "pa";
  translation?: string | null;
};

const root = path.join(process.cwd(), "data", "call-logs");
const roomPattern = /^call-[0-9a-f-]{36}$/;
const pending = new Map<string, Promise<unknown>>();

function roomDirectory(roomId: string) {
  if (!roomPattern.test(roomId)) throw new Error("Invalid room ID");
  return path.join(root, roomId);
}

function blobPrefix(roomId: string) {
  if (!roomPattern.test(roomId)) throw new Error("Invalid room ID");
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Private transcript storage is not configured.");
  return `call-logs/${roomId}/segments/`;
}

async function readBlobCallLog(roomId: string): Promise<TranscriptSegment[]> {
  const prefix = blobPrefix(roomId);
  const pathnames: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    pathnames.push(...page.blobs.map((blob) => blob.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const segments = await Promise.all(pathnames.map(async (pathname) => {
    const result = await get(pathname, { access: "private", useCache: false });
    if (!result?.stream) return null;
    return await new Response(result.stream).json() as TranscriptSegment;
  }));
  return segments.filter((segment): segment is TranscriptSegment => segment !== null)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

export async function readCallLog(roomId: string): Promise<TranscriptSegment[]> {
  if (process.env.VERCEL) return readBlobCallLog(roomId);
  const file = path.join(roomDirectory(roomId), "segments.jsonl");
  try {
    const content = await readFile(file, "utf8");
    return content.split("\n").filter(Boolean).map((line) => JSON.parse(line) as TranscriptSegment);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function formatCallLog(roomId: string, segments: TranscriptSegment[]): string {
  const lines = [`Call ${roomId}`, "Live transcript (automated; may contain errors)", ""];
  for (const segment of segments) {
    const speaker = segment.speaker === "caller" ? "Caller" : "Receiver";
    lines.push(`[${new Date(segment.at).toLocaleString("en-PK", { timeZone: "Asia/Karachi" })}] ${speaker}: ${segment.text}`);
    if (segment.translation) lines.push(`  English: ${segment.translation}`);
    else if (segment.language && segment.language !== "en") lines.push("  English translation unavailable");
  }
  return `${lines.join("\n")}\n`;
}

export async function saveTranscriptSegment(roomId: string, segment: TranscriptSegment): Promise<boolean> {
  if (process.env.VERCEL) {
    const pathname = `${blobPrefix(roomId)}${segment.id}.json`;
    // A retry writes the same ID and body. Separate speakers never overwrite
    // each other's segments, even when Vercel handles them on different instances.
    await put(pathname, JSON.stringify(segment), {
      access: "private", allowOverwrite: true, contentType: "application/json",
    });
    return true;
  }
  const previous = pending.get(roomId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const directory = roomDirectory(roomId);
    await mkdir(directory, { recursive: true });
    const existing = await readCallLog(roomId);
    if (existing.some((item) => item.id === segment.id)) return false;
    const next = [...existing, segment];
    await appendFile(path.join(directory, "segments.jsonl"), `${JSON.stringify(segment)}\n`, "utf8");
    await writeFile(path.join(directory, "transcript.txt"), formatCallLog(roomId, next), "utf8");
    return true;
  });
  pending.set(roomId, current);
  try { return await current; }
  finally { if (pending.get(roomId) === current) pending.delete(roomId); }
}
