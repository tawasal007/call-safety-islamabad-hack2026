import { AccessToken, TrackSource } from "livekit-server-sdk";
import type { CallLanguage, ParticipantRole } from "@/lib/sessions";
import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";

type LiveKitConfig = {
  browserUrl: string;
  apiKey: string;
  apiSecret: string;
};

export function liveKitConfig(): LiveKitConfig | null {
  const serverUrl = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  const browserUrl = process.env.LIVEKIT_PUBLIC_URL?.trim() || serverUrl;
  if (!serverUrl || !apiKey || !apiSecret || !browserUrl) return null;
  try {
    const url = new URL(browserUrl);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return null;
    if (process.env.NODE_ENV === "production" && (url.protocol !== "wss:" || apiKey === "devkey" || apiSecret === "secret")) return null;
  } catch {
    return null;
  }
  return { browserUrl, apiKey, apiSecret };
}

export async function makeParticipantToken(
  roomId: string,
  role: ParticipantRole,
  config: LiveKitConfig,
  language: CallLanguage = "en",
  displayName?: string,
): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: `${role}-${roomId}`,
    name: displayName?.trim().slice(0, 60) || "Other person",
    ttl: "30m",
  });
  token.addGrant({
    room: roomId,
    roomJoin: true,
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canSubscribe: true,
    canPublishData: false,
  });
  token.roomConfig = new RoomConfiguration({
    agents: [new RoomAgentDispatch({ agentName: "call-transcriber", metadata: JSON.stringify({ language }) })],
  });
  return token.toJwt();
}
