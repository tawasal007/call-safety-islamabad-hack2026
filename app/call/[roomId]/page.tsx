"use client";

import {
  LiveKitRoom, RoomAudioRenderer, StartAudio, TrackToggle,
  useConnectionState, useIsSpeaking, useLocalParticipant, useMultibandTrackVolume,
  useParticipants, useRoomContext,
  useTranscriptions,
} from "@livekit/components-react";
import { Check, Copy, FileText, Headphones, Info, Mic, MicOff, Phone, PhoneOff, Shield, ShieldCheck, UserPlus, Volume2, VolumeX, X } from "lucide-react";
import { ConnectionState, Track, type Participant } from "livekit-client";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeToggle } from "../../components/theme-toggle";
import { rememberCall } from "@/lib/call-log-client";
import type { CallLanguage } from "@/lib/sessions";
import type { TranscriptSegment } from "@/lib/call-logs";
import { MonitoringPanel, useMonitoring } from "../../components/monitoring-panel";
import { HighlightedText } from "../../components/warning-card";

type JoinResponse = {
  token: string;
  serverUrl: string;
  roomId: string;
  role: "caller" | "receiver";
  archiveAccessKey: string;
  language: CallLanguage;
  error?: string;
};

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

const idleWave = [0.08, 0.12, 0.09, 0.16, 0.1, 0.2, 0.12, 0.24, 0.14, 0.24, 0.12, 0.2, 0.1, 0.16, 0.09, 0.12, 0.08];

function LiveVoiceActivity({ localParticipant, remoteParticipant, remoteName }: {
  localParticipant: Participant;
  remoteParticipant?: Participant;
  remoteName: string;
}) {
  const localSpeaking = useIsSpeaking(localParticipant);
  // LiveKit's hook expects a participant, so use the local participant as a
  // stable placeholder until the second person joins the room.
  const remoteSpeakingValue = useIsSpeaking(remoteParticipant ?? localParticipant);
  const remoteSpeaking = !!remoteParticipant && remoteSpeakingValue;
  const localTrack = localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
  const remoteTrack = remoteParticipant?.getTrackPublication(Track.Source.Microphone)?.audioTrack;
  const localBands = useMultibandTrackVolume(localTrack, { bands: 17, loPass: 40, hiPass: 700, updateInterval: 45 });
  const remoteBands = useMultibandTrackVolume(remoteTrack, { bands: 17, loPass: 40, hiPass: 700, updateInterval: 45 });
  const bothSpeaking = localSpeaking && remoteSpeaking;
  const activeSpeaker = bothSpeaking ? "Both" : remoteSpeaking ? remoteName : localSpeaking ? "You" : null;
  const activeBands = bothSpeaking
    ? localBands.map((level, index) => Math.max(level, remoteBands[index] || 0))
    : remoteSpeaking ? remoteBands : localSpeaking ? localBands : idleWave;
  const activityLabel = bothSpeaking
    ? "Both are speaking"
    : remoteSpeaking ? `${remoteName} is speaking`
    : localSpeaking ? "You're speaking"
    : remoteParticipant ? "Listening for speech" : `Waiting for ${remoteName.toLowerCase()}`;

  return (
    <div className={`live-voice${activeSpeaker ? " is-speaking" : ""}`} data-speaking={activeSpeaker ? activeSpeaker.toLowerCase() : "none"}>
      <div className="live-voice-bars" aria-hidden="true">
        {activeBands.map((level, index) => (
          <i key={index} style={{ height: `${Math.max(4, Math.min(48, Math.round(level * 52)))}px` }} />
        ))}
      </div>
      <p className="live-voice-status" role="status" aria-live="polite"><span />{activityLabel}</p>
    </div>
  );
}

function ConnectedCall({ role, language, roomId, archiveAccessKey, onEnd, onError, onInvite }: {
  role: "caller" | "receiver";
  language: CallLanguage;
  roomId: string;
  archiveAccessKey: string;
  onEnd: () => void;
  onError: (message: string) => void;
  onInvite?: () => void;
}) {
  const room = useRoomContext();
  const state = useConnectionState();
  const participants = useParticipants();
  const { isMicrophoneEnabled, localParticipant } = useLocalParticipant();
  const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const [ending, setEnding] = useState(false);
  const [duration, setDuration] = useState(0);
  const [translatedSegments, setTranslatedSegments] = useState<TranscriptSegment[]>([]);
  const [translationError, setTranslationError] = useState(false);
  const startedAt = useRef<number | null>(null);
  const otherRole = role === "caller" ? "receiver" : "caller";
  const otherParticipant = participants.find((participant) => participant.identity.startsWith(`${otherRole}-`));
  const connected = state === ConnectionState.Connected;
  const together = connected && !!otherParticipant;
  const otherName = otherRole === "caller" ? "Caller" : "Receiver";
  const transcriptions = useTranscriptions();
  const callerTrackSid = participants.find((participant) => participant.identity.startsWith("caller-"))?.getTrackPublication(Track.Source.Microphone)?.trackSid;
  const receiverTrackSid = participants.find((participant) => participant.identity.startsWith("receiver-"))?.getTrackPublication(Track.Source.Microphone)?.trackSid;
  const visibleTranscriptions = transcriptions.filter((item) => item.text.trim()).slice(-12);
  // Only the receiver gets safety warnings; the caller's speech is what is monitored.
  const monitoring = useMonitoring(roomId, archiveAccessKey, role === "receiver");
  const evidenceQuotes = monitoring.warnings.flatMap((warning) => warning.evidence.map((item) => item.quote));

  useEffect(() => {
    if (language === "en") return;
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/call-logs/${encodeURIComponent(roomId)}`, {
          headers: { Authorization: `Bearer ${archiveAccessKey}` }, cache: "no-store",
        });
        if (!response.ok) throw new Error("Translation feed unavailable");
        const data = await response.json() as { segments: TranscriptSegment[] };
        if (active) { setTranslatedSegments(data.segments.slice(-12)); setTranslationError(false); }
      } catch { if (active) setTranslationError(true); }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [archiveAccessKey, language, roomId]);

  // Start when the second person joins; keep elapsed time until this call ends.
  useEffect(() => {
    if (together && startedAt.current === null) startedAt.current = Date.now();
    if (startedAt.current === null) return;
    const tick = () => setDuration(Math.floor((Date.now() - startedAt.current!) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [together]);

  async function toggleSpeaker() {
    if (speakerEnabled) {
      setSpeakerEnabled(false);
      return;
    }
    try {
      // This user gesture also unlocks playback when a browser blocks autoplay.
      await room.startAudio();
      setSpeakerEnabled(true);
    } catch {
      onError("Audio playback could not start. Check your browser's audio settings and try Speaker again.");
    }
  }

  async function endCall() {
    setEnding(true);
    try { await room.disconnect(true); } finally { onEnd(); }
  }

  const status = together ? "Connected" : connected ? `Waiting for ${otherRole}…` : state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting ? "Reconnecting…" : "Connecting…";

  return (
    <section className="call-workspace" aria-label="Audio call">
      <div className="call-console">
        <div className="console-status-row">
          <p className={`connection-status${together ? " is-connected" : ""}`} role="status"><span />{status}</p>
          <p className="console-call-type">Audio only</p>
        </div>

        <div className="call-identity">
          <div className="call-avatar" aria-hidden="true">{otherName[0]}</div>
          <p>In call with</p>
          <h1>{otherName}</h1>
          <time className="call-time" aria-label={`Call duration ${formatDuration(duration)}`}>{formatDuration(duration)}</time>
          <LiveVoiceActivity localParticipant={localParticipant} remoteParticipant={otherParticipant} remoteName={otherName} />
        </div>

        <div className={`call-actions${onInvite ? " has-invite" : ""}`}>
          <TrackToggle className={`call-action${!isMicrophoneEnabled ? " is-active" : ""}`} source={Track.Source.Microphone} showIcon={false} aria-label={isMicrophoneEnabled ? "Mute microphone" : "Unmute microphone"} disabled={ending} onDeviceError={(cause) => onError(`Microphone unavailable: ${cause.message}. Check browser permissions and your selected device.`)}>
            <span className="call-action-icon">{isMicrophoneEnabled ? <Mic size={24} /> : <MicOff size={24} />}</span>
            <span>{isMicrophoneEnabled ? "Mute" : "Unmute"}</span>
          </TrackToggle>
          <button className={`call-action${speakerEnabled ? " is-active" : ""}`} onClick={toggleSpeaker} aria-label={speakerEnabled ? "Turn speaker off" : "Turn speaker on"} aria-pressed={speakerEnabled} title="Turn incoming audio on or off" disabled={ending}>
            <span className="call-action-icon">{speakerEnabled ? <Volume2 size={24} /> : <VolumeX size={24} />}</span>
            <span>Speaker</span>
          </button>
          {onInvite && <button className="call-action" onClick={onInvite} disabled={ending} aria-label="Invite receiver"><span className="call-action-icon"><UserPlus size={24} /></span><span>Invite</span></button>}
          <button className="call-action call-action-end" onClick={endCall} disabled={ending}><span className="call-action-icon"><PhoneOff size={24} /></span><span>{ending ? "Leaving…" : "End"}</span></button>
        </div>

        {speakerEnabled && <StartAudio className="playback-button" label="Enable audio playback" />}
        {!speakerEnabled && <p className="speaker-note" role="status">Incoming audio is off. Your microphone is {isMicrophoneEnabled ? "still on" : "muted"}.</p>}
      </div>

      <aside className="call-context" aria-label="Room information">
        <div className="context-heading"><div><p>Room status</p><h2>Two-person call</h2></div><ShieldCheck size={22} /></div>
        {role === "receiver" && <MonitoringPanel {...monitoring} />}
        <div className="participant-list">
          <div className="participant-row"><span className="participant-avatar">{role === "caller" ? "C" : "R"}</span><span><strong>You</strong><small>{role}</small></span><i className="participant-dot is-online" /></div>
          <div className={`participant-row${!otherParticipant ? " is-waiting" : ""}`}><span className="participant-avatar participant-avatar-alt">{otherName[0]}</span><span><strong>{otherName}</strong><small>{otherParticipant ? "In the call" : "Waiting to join"}</small></span><i className={`participant-dot${otherParticipant ? " is-online" : ""}`} /></div>
        </div>
        <div className="context-divider" />
        <div className="safety-context">
          <div className="safety-context-top"><FileText size={18} /><strong>Live transcript</strong><span>{visibleTranscriptions.length ? "Live" : "Waiting"}</span></div>
          {language !== "en" && <p className="translation-mode">{language === "ur" ? "Urdu" : "Punjabi"} speech · English translation after each turn</p>}
          <div className="transcript-feed" role="log" aria-label="Live transcript" aria-live="polite">
            {visibleTranscriptions.length ? visibleTranscriptions.map((item) => {
              const trackSid = item.streamInfo.attributes?.["lk.transcribed_track_id"];
              const speaker = trackSid === callerTrackSid ? "Caller" : trackSid === receiverTrackSid ? "Receiver" : "Speaker";
              const final = item.streamInfo.attributes?.["lk.transcription_final"] === "true";
              return <p key={item.streamInfo.attributes?.["lk.segment_id"] || item.streamInfo.id} className={`transcript-line${final ? "" : " is-interim"}`}><strong>{speaker}</strong><span>{speaker === "Caller" && final ? <HighlightedText text={item.text} quotes={evidenceQuotes} /> : item.text}</span></p>;
            }) : <p className="transcript-empty">Speech will appear here after the transcription worker joins. Speak clearly in {language === "en" ? "English" : language === "ur" ? "Urdu" : "Punjabi"} to test.</p>}
          </div>
          {language !== "en" && <div className="translation-feed" aria-label="English translation" aria-live="polite">
            <h3>English translation</h3>
            {translationError ? <p className="translation-unavailable">Translation feed is unavailable. The call continues.</p> : translatedSegments.length ? translatedSegments.map((segment) => <p key={segment.id} className="translation-line"><strong>{segment.speaker}</strong><span>{segment.speaker === "caller" ? <HighlightedText text={segment.translation || segment.translatedText || "Translation unavailable for this turn"} quotes={evidenceQuotes} /> : segment.translation || segment.translatedText || "Translation unavailable for this turn"}</span></p>) : <p className="transcript-empty">Waiting for a completed speaking turn…</p>}
          </div>}
          <p className="transcript-note">Automated speech recognition, translation, and safety detection may contain mistakes. Caller speech is checked for scam and threat patterns; warnings go to the receiver. Final lines are saved in Call Logs.</p>
        </div>
        <p className="headphone-hint"><Headphones size={16} />Use headphones when both devices are nearby.</p>
      </aside>
      <RoomAudioRenderer volume={speakerEnabled ? 1 : 0} />
    </section>
  );
}

export default function CallPage() {
  const params = useParams<{ roomId: string }>();
  const search = useSearchParams();
  const roomId = params.roomId;
  const invite = search.get("invite");
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState<JoinResponse | null>(null);
  const [error, setError] = useState("");
  const [ended, setEnded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const inviteDialog = useRef<HTMLDialogElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!roomId) return;
    setInviteUrl(sessionStorage.getItem(`receiver-invite:${roomId}`));
    if (invite) sessionStorage.setItem(`receiver-access:${roomId}`, invite);
  }, [roomId, invite]);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  useEffect(() => { if (ended) inviteDialog.current?.close(); }, [ended]);

  const joinCall = useCallback(async () => {
    if (!roomId) return;
    const accessKey = invite || sessionStorage.getItem(`caller-access:${roomId}`) || sessionStorage.getItem(`receiver-access:${roomId}`);
    if (!accessKey) { setError("You need an invitation link to join this call."); return; }
    setJoining(true);
    setError("");
    try {
      const response = await fetch("/api/rooms/join", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId, accessKey }),
      });
      const data = (await response.json()) as JoinResponse;
      if (!response.ok) throw new Error(data.error || "Could not join this call.");
      rememberCall({ roomId: data.roomId, archiveAccessKey: data.archiveAccessKey, role: data.role, joinedAt: new Date().toISOString() });
      setJoined(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not join this call.");
    } finally { setJoining(false); }
  }, [roomId, invite]);

  async function copyInvite() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopyError("");
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2200);
    } catch { setCopyError("Select the invitation below and copy it manually."); }
  }

  function openInvite() {
    setCopyError("");
    inviteDialog.current?.showModal();
  }

  return (
    <main className="call-shell">
      <header className="call-topbar">
        <Link href="/" className="wordmark"><span className="wordmark-mark"><Shield size={18} /></span><span>Call Safety</span></Link>
        <div className="header-tools"><Link href="/call-logs" className="header-link"><FileText size={15} />Call Logs</Link><div className="room-reference"><span>Room</span><strong>{roomId?.slice(-8)}</strong></div><ThemeToggle /></div>
      </header>
      {!joined && !ended && (
        <section className="prejoin-layout">
          <div className="prejoin-copy">
            <p className="prejoin-eyebrow">ROOM SETUP</p>
            <h1>Room {roomId?.slice(-8)}</h1>
            <p>{inviteUrl ? "Share the invitation, then join the call." : "Join the call as the receiver."}</p>
            {inviteUrl && <div className="room-invitation"><label htmlFor="setup-invitation">Receiver invitation</label><input id="setup-invitation" value={inviteUrl} readOnly onFocus={(event) => event.target.select()} /><button className="secondary-button" onClick={copyInvite}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? "Copied" : "Copy invitation"}</button><span className="sr-only" role="status">{copied ? "Invitation copied" : ""}</span>{copyError && <p className="inline-error" role="alert">{copyError}</p>}</div>}
            <div className="prejoin-facts"><span><Mic size={17} />Microphone required</span><span><Headphones size={17} />Headphones recommended</span><span><FileText size={17} />Both voices are transcribed and saved in Call Logs</span></div>
          </div>
          <div className="join-card">
            <div className="join-card-icon"><Phone size={27} /></div>
            <p className="join-card-label">2 PEOPLE · AUDIO ONLY</p>
            <h2>Join call</h2>
            <p>Allow microphone access when your browser asks.</p>
            <button className="join-button" onClick={joinCall} disabled={joining}><Phone size={19} />{joining ? "Joining…" : "Join call"}</button>
          </div>
        </section>
      )}
      {joined && !ended && (
        <LiveKitRoom token={joined.token} serverUrl={joined.serverUrl} connect={true} audio={true} video={false} onDisconnected={() => setEnded(true)} onError={(cause) => setError(cause.message)} onMediaDeviceFailure={() => setError("Microphone access failed. Check your browser permission and device settings.")}>
          <ConnectedCall role={joined.role} language={joined.language || "en"} roomId={joined.roomId} archiveAccessKey={joined.archiveAccessKey} onEnd={() => setEnded(true)} onError={setError} onInvite={joined.role === "caller" && inviteUrl ? openInvite : undefined} />
        </LiveKitRoom>
      )}
      {ended && (
        <section className="ended-card"><div className="ended-icon"><PhoneOff size={28} /></div><p className="prejoin-eyebrow">CALL FINISHED</p><h1>Call ended</h1><p>Your microphone is disconnected. The transcript remains available in Call Logs.</p><div className="ended-actions"><Link href="/call-logs" className="secondary-button"><FileText size={17} />View Call Logs</Link><Link href="/" className="join-button"><Phone size={19} />Start another call</Link></div></section>
      )}
      {error && !ended && <p className="call-error" role="alert"><Info size={17} />{error}</p>}
      <footer className="call-footer"><span><ShieldCheck size={15} />Signed room invitation</span><span>Call speech can be transcribed, saved in Call Logs, and checked for scam and threat patterns</span></footer>
      <dialog ref={inviteDialog} className="invite-dialog" aria-labelledby="invite-title" aria-describedby="invite-description">
        <button className="dialog-close" onClick={() => inviteDialog.current?.close()} aria-label="Close invitation"><X size={21} /></button>
        <span className="invite-dialog-icon"><UserPlus size={25} /></span>
        <h2 id="invite-title">Invite the receiver</h2>
        <p id="invite-description">Share this link with the other person. They can join from their own browser or device.</p>
        <input aria-label="Receiver invitation link" readOnly value={inviteUrl || ""} onFocus={(event) => event.target.select()} />
        <button className="join-button" onClick={copyInvite}>{copied ? <Check size={19} /> : <Copy size={19} />}{copied ? "Copied" : "Copy invitation link"}</button>
        <p className="invite-detail">One receiver at a time · Invitation valid for 2 hours</p>
        {copyError && <p className="invite-copy-error" role="alert">{copyError}</p>}
        <span className="sr-only" role="status">{copied ? "Invitation link copied" : ""}</span>
      </dialog>
    </main>
  );
}
