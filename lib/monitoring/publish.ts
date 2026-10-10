import { DataPacket_Kind, RoomServiceClient } from "livekit-server-sdk";
import { MONITORING_TOPIC } from "../detector/types.ts";
import type { Publisher } from "./pipeline.ts";

/**
 * Sends monitoring events through LiveKit's server API as reliable data
 * messages to the receiver only. Server-API packets arrive with no sender
 * participant, and browser tokens cannot publish data, so the receiver can
 * trust exactly those packets on MONITORING_TOPIC.
 */
export function liveKitPublisher(env: Record<string, string | undefined> = process.env): Publisher {
  const url = env.LIVEKIT_URL?.trim();
  const apiKey = env.LIVEKIT_API_KEY?.trim();
  const apiSecret = env.LIVEKIT_API_SECRET?.trim();
  if (!url || !apiKey || !apiSecret) return async () => { throw new Error("LiveKit is not configured"); };
  const client = new RoomServiceClient(url.replace(/^ws/, "http"), apiKey, apiSecret);
  const encoder = new TextEncoder();
  return async (roomId, message) => {
    await client.sendData(roomId, encoder.encode(JSON.stringify(message)), DataPacket_Kind.RELIABLE, {
      topic: MONITORING_TOPIC,
      destinationIdentities: [`receiver-${roomId}`],
    });
  };
}