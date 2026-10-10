"use client";
import { useConnectionState, useRoomContext } from "@livekit/components-react";
import { ConnectionState, RoomEvent, type RemoteParticipant } from "livekit-client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { mergeSegments, validSegment, type CaptionSegment } from "@/lib/transcription";
import { TranscriptView } from "./transcript-view";

export function LiveCaptions({ roomId, accessKey, historyKey, language }: {
  roomId: string; accessKey: string; historyKey: string; language: string;
}) {
  const room = useRoomContext();
  const connection = useConnectionState();
  const [segments, setSegments] = useState<CaptionSegment[]>([]);
  const [status, setStatus] = useState("connecting");
  const [message, setMessage] = useState("Connecting transcription service…");
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  const [follow, setFollow] = useState(true);
  const container = useRef<HTMLDivElement>(null);
  const discarded = useRef(new Set<string>());
  const lastEvent = useRef(Date.now());

  useEffect(() => {
    if (connection !== ConnectionState.Connected) return;
    let active = true;
    const controller = new AbortController();
    async function start() {
      try {
        const response = await fetch("/api/transcription", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId, accessKey, language }), signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Transcription unavailable.");
        if (active) { setStatus(data.status); setMessage("Listening for speech; audio remains independent of captions."); }
      } catch (cause) {
        if (active) { setStatus("unavailable"); setMessage(cause instanceof Error ? cause.message : "Transcription unavailable."); }
      }
    }
    void start();
    return () => { active = false; controller.abort(); };
  }, [roomId, accessKey, language, connection, retry]);

  useEffect(() => {
    function received(payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) {
      if (topic !== "call-safety.transcription" || participant?.identity !== `transcriber-${roomId}` || payload.byteLength > 64000) return;
      try {
        const event = JSON.parse(new TextDecoder().decode(payload));
        if (event.roomId !== roomId) return;
        lastEvent.current = Date.now();
        if (event.type === "segment" && validSegment(event.segment, roomId) && !discarded.current.has(event.segment.segmentId)) {
          setSegments(current => mergeSegments(current, [event.segment]));
        } else if (event.type === "discard" && typeof event.segmentId === "string") {
          discarded.current.add(event.segmentId);
          setSegments(current => current.filter(s => s.segmentId !== event.segmentId || s.final));
        } else if (event.type === "status" && ["connecting", "active", "processing", "degraded", "unavailable", "ended"].includes(event.status) && typeof event.message === "string") {
          setStatus(event.status); setMessage(event.message);
        }
      } catch { /* Malformed/untrusted events cannot update captions. */ }
    }
    room.on(RoomEvent.DataReceived, received);
    return () => { room.off(RoomEvent.DataReceived, received); };
  }, [room, roomId]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function sync() {
      try {
        const response = await fetch(`/api/calls/${encodeURIComponent(roomId)}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ historyKey }), signal: controller.signal,
        });
        const log = await response.json();
        if (active && response.ok) {
          setSegments(current => mergeSegments(current, log.segments.filter((s: unknown) => validSegment(s, roomId))));
          setSaved(true);
          if (Date.now() - lastEvent.current > 12000 || log.status === "ended") { setStatus(log.status); setMessage(log.message); }
        } else if (active && Date.now() - lastEvent.current > 20000) {
          setSaved(false); setStatus("unavailable"); setMessage(log.error || "Transcription worker unavailable. Audio can continue.");
        }
      } catch {
        if (active) {
          setSaved(false);
          if (Date.now() - lastEvent.current > 20000) { setStatus("unavailable"); setMessage("Transcription service is unreachable. Audio can continue."); }
        }
      } finally { if (active) timer = setTimeout(sync, 5000); }
    }
    void sync();
    return () => { active = false; controller.abort(); clearTimeout(timer); };
  }, [roomId, historyKey]);

  useEffect(() => {
    if (follow) {
      const list = container.current?.querySelector(".transcript-list");
      if (list) list.scrollTop = list.scrollHeight;
    }
  }, [segments, follow]);

  return <section className="caption-card" aria-labelledby="captions-title" ref={container}>
    <div className="caption-heading"><div><p className="prejoin-eyebrow">LIVE TRANSCRIPTION</p><h2 id="captions-title">Call captions</h2></div><span className={`monitor-status status-${status}`}>{status}</span></div>
    <p className="monitor-message" role="status">{message}</p>
    <div className="caption-controls"><label><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} />Follow latest speech</label><button onClick={() => { setStatus("connecting"); setMessage("Reconnecting transcription service…"); setRetry(n => n + 1); }}>Retry service</button><Link href={`/history/${roomId}`}>Saved log ↗</Link></div>
    <TranscriptView segments={segments} live />
    <p className="caption-footnote">{saved ? "Finalized captions are saved in this call’s separate history." : "Waiting for confirmation of saved call history."} Keyword highlights use limited contextual rules; they do not establish that a call is a scam. Translations may contain errors.</p>
  </section>;
}
