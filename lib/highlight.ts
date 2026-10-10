export type TextPart = { text: string; highlighted: boolean };

/** Splits text into plain and highlighted parts for every (case-insensitive) occurrence of the quotes. */
export function highlightParts(text: string, quotes: string[]): TextPart[] {
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const quote of quotes) {
    const needle = quote.trim().toLowerCase();
    if (needle.length < 2) continue;
    for (let index = lower.indexOf(needle); index >= 0; index = lower.indexOf(needle, index + needle.length)) {
      ranges.push([index, index + needle.length]);
    }
  }
  if (!ranges.length) return [{ text, highlighted: false }];
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), highlighted: false });
    parts.push({ text: text.slice(start, end), highlighted: true });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), highlighted: false });
  return parts;
}