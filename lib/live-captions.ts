type Speaker = "caller" | "receiver";
type LiveLine = {
  text: string;
  participantInfo: { identity: string };
  streamInfo: { timestamp: number; attributes?: Record<string, string | undefined> };
};

/** Resolve the source speaker, even when a worker publishes the transcription. */
export function latestSpeakerLine<T extends LiveLine>(lines: T[], speaker: Speaker, trackSid?: string): T | undefined {
  return lines.reduce<T | undefined>((latest, line) => {
    const sourceTrack = line.streamInfo.attributes?.["lk.transcribed_track_id"];
    const matches = sourceTrack && trackSid
      ? sourceTrack === trackSid
      : line.participantInfo.identity.startsWith(`${speaker}-`);
    if (!matches || !line.text.trim()) return latest;
    return !latest || line.streamInfo.timestamp >= latest.streamInfo.timestamp ? line : latest;
  }, undefined);
}

export function latestSavedLine<T extends { speaker: Speaker; text: string; at: string }>(lines: T[], speaker: Speaker): T | undefined {
  return lines.reduce<T | undefined>((latest, line) => {
    if (line.speaker !== speaker || !line.text.trim()) return latest;
    return !latest || line.at >= latest.at ? line : latest;
  }, undefined);
}
