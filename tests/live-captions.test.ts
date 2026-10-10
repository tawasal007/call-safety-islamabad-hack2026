import assert from "node:assert/strict";
import test from "node:test";
import { latestSavedLine, latestSpeakerLine } from "../lib/live-captions.ts";

function line(text: string, timestamp: number, identity: string, track?: string) {
  const attributes: Record<string, string> = track ? { "lk.transcribed_track_id": track } : {};
  return { text, participantInfo: { identity }, streamInfo: { timestamp, attributes } };
}

test("each speaker retains their own latest caption during a long speaking turn", () => {
  const lines = [line("Hello", 1, "caller-room"), line("Hi there", 2, "receiver-room"),
    ...Array.from({ length: 20 }, (_, index) => line(`New words ${index}`, index + 3, "caller-room"))];
  assert.equal(latestSpeakerLine(lines, "caller")?.text, "New words 19");
  assert.equal(latestSpeakerLine(lines, "receiver")?.text, "Hi there");
});

test("worker captions use track attribution and ignore blank or unrelated messages", () => {
  const lines = [line("Their voice", 7, "transcriber", "remote-track"), line("Your voice", 8, "transcriber", "local-track"),
    line(" ", 9, "transcriber", "remote-track"), line("Wrong track", 10, "caller-room", "unrelated")];
  assert.equal(latestSpeakerLine(lines, "caller", "local-track")?.text, "Your voice");
  assert.equal(latestSpeakerLine(lines, "receiver", "remote-track")?.text, "Their voice");
  assert.equal(latestSpeakerLine(lines, "receiver", "missing"), undefined);
});

test("caption timestamps take precedence over arrival order; interim updates replace their own line", () => {
  const lines = [line("Most recent", 20, "caller-room"), line("Arrived late", 10, "caller-room"), line("Most recent updated", 20, "caller-room")];
  assert.equal(latestSpeakerLine(lines, "caller")?.text, "Most recent updated");
  assert.equal(latestSpeakerLine([], "caller"), undefined);
});

test("saved translations retain the latest completed turn independently for both speakers", () => {
  const lines = [
    { speaker: "caller" as const, text: "New", at: "2026-10-10T10:00:20Z", translation: "Latest translation" },
    { speaker: "receiver" as const, text: "Reply", at: "2026-10-10T10:00:10Z", translation: "Reply translation" },
    { speaker: "caller" as const, text: "Old", at: "2026-10-10T10:00:00Z", translation: "Older translation" },
  ];
  assert.equal(latestSavedLine(lines, "caller")?.translation, "Latest translation");
  assert.equal(latestSavedLine(lines, "receiver")?.translation, "Reply translation");
});
