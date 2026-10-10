export type SavedCall = { roomId: string; archiveAccessKey: string; role: "caller" | "receiver"; joinedAt: string };
const storageKey = "call-safety-joined-calls";

export function getSavedCalls(): SavedCall[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is SavedCall =>
      !!item && typeof item.roomId === "string" && typeof item.archiveAccessKey === "string" &&
      (item.role === "caller" || item.role === "receiver") && typeof item.joinedAt === "string") : [];
  } catch { return []; }
}

export function rememberCall(call: SavedCall) {
  const previous = getSavedCalls().filter((item) => item.roomId !== call.roomId);
  localStorage.setItem(storageKey, JSON.stringify([call, ...previous].slice(0, 100)));
}
