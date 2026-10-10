"use client";

export type HistoryEntry = { roomId: string; historyKey: string; savedAt: number };
const KEY = "call-safety-history-v1";
export function historyEntries(): HistoryEntry[] {
  try {
    const entries = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(entries) ? entries.filter(e => e && typeof e.roomId === "string" &&
      typeof e.historyKey === "string" && Number.isFinite(e.savedAt) && Date.now() - e.savedAt < 30 * 86400000).slice(0, 30) : [];
  } catch { return []; }
}
export function rememberCall(roomId: string, historyKey: string) {
  try {
    const entries = historyEntries().filter(e => e.roomId !== roomId);
    localStorage.setItem(KEY, JSON.stringify([{ roomId, historyKey, savedAt: Date.now() }, ...entries].slice(0, 30)));
  } catch { /* Live captions still work when browser storage is unavailable. */ }
}
