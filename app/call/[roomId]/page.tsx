"use client";

import {
  LiveKitRoom, RoomAudioRenderer, StartAudio, TrackToggle,
  useConnectionState, useIsSpeaking, useLocalParticipant, useMultibandTrackVolume,
  useParticipants, useRoomContext,
  useTranscriptions,
  type TextStreamData,
} from "@livekit/components-react";
import { AudioLines, Check, Copy, FileText, Headphones, Info, Mic, MicOff, Phone, PhoneOff, ShieldCheck, User, UserPlus, Volume2, VolumeX, X } from "lucide-react";
import { ConnectionState, Track, type Participant } from "livekit-client";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { latestSavedLine, latestSpeakerLine } from "@/lib/live-captions";
import { rememberCall } from "@/lib/call-log-client";
import { readLocalRecord, saveLocalRecord } from "@/lib/local-call-record";
import type { DetectorSegment, MonitoringStatus, Warning } from "@/lib/detector/types";
import type { CallLanguage } from "@/lib/sessions";
import type { TranscriptSegment } from "@/lib/call-logs";
import { MonitoringPanel } from "../../components/monitoring-panel";
import { HighlightedText } from "../../components/warning-card";

type JoinResponse = {
  token: string;
  serverUrl: string;
  roomId: string;
  role: "caller" | "receiver";
  archiveAccessKey: string;
  accessKey: string;
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

function ConnectedCall({ role, language, roomId, archiveAccessKey, accessKey, onEnd, onError, onInvite }: {
  role: "caller" | "receiver";
  language: CallLanguage;
  roomId: string;
  archiveAccessKey: string;
  accessKey: string;
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
  const [captionLines, setCaptionLines] = useState<Partial<Record<"caller" | "receiver", TextStreamData>>>({});
  const [localWarnings, setLocalWarnings] = useState<Warning[]>(() => readLocalRecord(roomId).warnings);
  const [monitorStatus, setMonitorStatus] = useState<MonitoringStatus>("connecting");
  const seenCaptions = useRef(new Set<string>());
  const startedAt = useRef<number | null>(null);
  const otherRole = role === "caller" ? "receiver" : "caller";
  const otherParticipant = participants.find((participant) => participant.identity.startsWith(`${otherRole}-`));
  const connected = state === ConnectionState.Connected;
  const together = connected && !!otherParticipant;
  const participantName = otherParticipant?.name?.trim();
  const otherName = participantName && !/^(caller|receiver)$/i.test(participantName) ? participantName : "Other person";
  const transcriptions = useTranscriptions();
  const callerTrackSid = participants.find((participant) => participant.identity.startsWith("caller-"))?.getTrackPublication(Track.Source.Microphone)?.trackSid;
  const receiverTrackSid = participants.find((participant) => participant.identity.startsWith("receiver-"))?.getTrackPublication(Track.Source.Microphone)?.trackSid;
  // The private server archive is unavailable when the Blob store is suspended.
  // Keep finalized LiveKit captions in this browser and analyse caller speech here.
  useEffect(() => {
    for (const line of transcriptions) {
      if (line.streamInfo.attributes?.["lk.transcription_final"] !== "true" || !line.text.trim()) continue;
      const sourceTrack = line.streamInfo.attributes?.["lk.transcribed_track_id"];
      const speaker = sourceTrack && callerTrackSid && sourceTrack === callerTrackSid ? "caller"
        : sourceTrack && receiverTrackSid && sourceTrack === receiverTrackSid ? "receiver"
        : line.participantInfo.identity.startsWith("caller-") ? "caller"
        : line.participantInfo.identity.startsWith("receiver-") ? "receiver" : null;
      if (!speaker) continue;
      const marker = `${speaker}:${line.streamInfo.timestamp}:${line.text}`;
      if (seenCaptions.current.has(marker)) continue;
      seenCaptions.current.add(marker);
      const record = readLocalRecord(roomId);
      const segment: TranscriptSegment = { id: crypto.randomUUID(), speaker, text: line.text.trim(), at: new Date(line.streamInfo.timestamp || Date.now()).toISOString(), language };
      const segments = [...record.segments, segment];
      saveLocalRecord(roomId, { ...record, segments });
      if (role !== "receiver" || speaker !== "caller") continue;
      const context = segments.slice(-8).map((s): DetectorSegment => ({ id: s.id, speaker: s.speaker, text: s.text, at: s.at, language: s.language, translatedText: s.translatedText || s.translation || undefined }));
      void fetch("/api/detect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId, accessKey, segments: context, warnings: record.warnings }) })
        .then(async (response) => {
          if (!response.ok) throw new Error("AI monitoring unavailable");
          const data = await response.json() as { warning: Warning | null };
          setMonitorStatus("active");
          if (!data.warning) return;
          const current = readLocalRecord(roomId);
          const warnings = [...current.warnings.filter((w) => w.id !== data.warning!.id), data.warning];
          saveLocalRecord(roomId, { ...current, warnings });
          setLocalWarnings(warnings);
        }).catch(() => setMonitorStatus("degraded"));
    }
  }, [transcriptions, callerTrackSid, receiverTrackSid, language, roomId, role, accessKey]);
  useEffect(() => {
    const caller = latestSpeakerLine(transcriptions, "caller", callerTrackSid);
    const receiver = latestSpeakerLine(transcriptions, "receiver", receiverTrackSid);
    setCaptionLines((current) => {
      const nextCaller = caller && (!current.caller || caller.streamInfo.timestamp >= current.caller.streamInfo.timestamp) ? caller : current.caller;
      const nextReceiver = receiver && (!current.receiver || receiver.streamInfo.timestamp >= current.receiver.streamInfo.timestamp) ? receiver : current.receiver;
      return nextCaller === current.caller && nextReceiver === current.receiver ? current : { caller: nextCaller, receiver: nextReceiver };
    });
  }, [transcriptions, callerTrackSid, receiverTrackSid]);
  const latestLines = ([role, otherRole] as const).map((speaker) => {
    const live = captionLines[speaker];
    const saved = latestSavedLine(translatedSegments, speaker);
    const text = live?.text ?? saved?.text;
    // A completed translation belongs only to its original utterance.
    const translation = saved && (!live || live.text.trim() === saved.text.trim())
      ? saved.translation || saved.translatedText : undefined;
    const translationComplete = !!saved && (!live || live.text.trim() === saved.text.trim());
    return { speaker, text, translation, translationComplete, final: !live || live.streamInfo.attributes?.["lk.transcription_final"] === "true" };
  });
  // Only the receiver gets safety warnings; the caller's speech is what is monitored.
  const isReceiver = role === "receiver";
  const monitoring = { warnings: localWarnings, status: { status: monitorStatus } };
  const evidenceQuotes = localWarnings.flatMap((warning) => warning.evidence.map((item) => item.quote));

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
        if (active) {
          setTranslatedSegments([latestSavedLine(data.segments, "caller"), latestSavedLine(data.segments, "receiver")].filter((segment): segment is TranscriptSegment => !!segment));
          setTranslationError(false);
        }
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

  const status = together ? "Call in progress" : connected ? "Waiting for the other person…" : state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting ? "Reconnecting…" : "Connecting…";

  return (
    <section className="call-workspace" aria-label="Audio call">
      <div className="call-console">
        <div className="console-status-row">
          <p className={`connection-status${together ? " is-connected" : ""}`} role="status"><span />{status}</p>
          <p className="console-call-type">Audio only</p>
        </div>

        <div className="call-identity">
          <div className="call-avatar" aria-hidden="true">{participantName ? otherName[0].toUpperCase() : <User size={48} />}<span className="avatar-call-badge"><Phone size={17} /></span></div>
          <p>{together ? "You’re talking with" : "Your conversation with"}</p>
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
          {onInvite && <button className="call-action" onClick={onInvite} disabled={ending} aria-label="Invite someone"><span className="call-action-icon"><UserPlus size={24} /></span><span>Invite</span></button>}
          <button className="call-action call-action-end" onClick={endCall} disabled={ending}><span className="call-action-icon"><PhoneOff size={24} /></span><span>{ending ? "Leaving…" : "End"}</span></button>
        </div>

        {speakerEnabled && <StartAudio className="playback-button" label="Enable audio playback" />}
        {!speakerEnabled && <p className="speaker-note" role="status">Incoming audio is off. Your microphone is {isMicrophoneEnabled ? "still on" : "muted"}.</p>}
        <section className="live-captions" aria-label="Latest captions">
          <div className="captions-heading"><span><AudioLines size={16} />Live captions</span><small>Latest words from each person</small></div>
          <div className="latest-caption-grid">{latestLines.map((line) => <div key={line.speaker} className={`latest-caption${line.speaker === role ? " is-you" : ""}`} aria-live="polite" aria-atomic="true"><strong><span className="caption-dot" />{line.speaker === role ? "You" : otherName}</strong><p className={line.text ? "" : "caption-placeholder"}>{line.text ? line.speaker === "caller" && line.final ? <HighlightedText text={line.text} quotes={evidenceQuotes} /> : line.text : "Nothing said yet"}</p>{language !== "en" && line.text && <p className="caption-translation"><span>English</span>{translationError || line.translationComplete && !line.translation ? "Translation unavailable" : line.translation || (line.final ? "Waiting for translation…" : "Available after this speaking turn")}</p>}</div>)}</div>
          <p className="captions-note">{language === "en" ? "Captions appear when transcription is connected." : `${language === "ur" ? "Urdu" : "Punjabi"} speech · English translations after each turn.`} Full conversations are saved in call history.</p>
        </section>
      </div>

      <aside className="call-context" aria-label="Room information">
        <div className="context-heading"><div><p>IN THIS CONVERSATION</p><h2>Call details</h2></div><Phone size={21} /></div>
        {isReceiver && <MonitoringPanel {...monitoring} />}
        <div className="participant-list">
          <div className="participant-row"><span className="participant-avatar"><User size={17} /></span><span><strong>You</strong><small>{isMicrophoneEnabled ? "Microphone on" : "Microphone muted"}</small></span><i className="participant-dot is-online" /></div>
          <div className={`participant-row${!otherParticipant ? " is-waiting" : ""}`}><span className="participant-avatar participant-avatar-alt">{otherName[0]}</span><span><strong>{otherName}</strong><small>{otherParticipant ? "In the call" : "Waiting to join"}</small></span><i className={`participant-dot${otherParticipant ? " is-online" : ""}`} /></div>
        </div>
        <div className="context-divider" />
        <div className="call-detail-note"><FileText size={20} /><h3>Stay in the moment.</h3><p>Only the latest words appear here. Find the full conversation in call history when you’re done.</p><p>Both voices are processed and saved when transcription is connected. Automated captions and warnings may contain mistakes.</p></div>
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
  const [displayName, setDisplayName] = useState("");
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
  useEffect(() => { try { setDisplayName(localStorage.getItem("call-safety-display-name") || ""); } catch { /* Browser storage is optional. */ } }, []);
  useEffect(() => { if (ended) inviteDialog.current?.close(); }, [ended]);

  const joinCall = useCallback(async () => {
    if (!roomId) return;
    const accessKey = invite || sessionStorage.getItem(`caller-access:${roomId}`) || sessionStorage.getItem(`receiver-access:${roomId}`);
    if (!accessKey) { setError("You need an invitation link to join this call."); return; }
    setJoining(true);
    setError("");
    try {
      const response = await fetch("/api/rooms/join", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId, accessKey, displayName: displayName.trim() }),
      });
      const data = (await response.json()) as JoinResponse;
      if (!response.ok) throw new Error(data.error || "Could not join this call.");
      try { localStorage.setItem("call-safety-display-name", displayName.trim()); } catch { /* Calling does not require preference storage. */ }
      rememberCall({ roomId: data.roomId, archiveAccessKey: data.archiveAccessKey, role: data.role, joinedAt: new Date().toISOString() });
      setJoined({ ...data, accessKey });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not join this call.");
    } finally { setJoining(false); }
  }, [roomId, invite, displayName]);

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
      {!joined && !ended && (
        <section className="prejoin-layout">
          <div className="prejoin-copy">
            <p className="prejoin-eyebrow">LET’S GET YOU CONNECTED</p>
            <h1>{inviteUrl ? "A conversation starts with you." : "You’re invited."}</h1>
            <p>{inviteUrl ? "Send your invitation to someone, then join when you’re ready." : "Get comfortable, check your name, and join the conversation."}</p>
            {inviteUrl && <div className="room-invitation"><label htmlFor="setup-invitation">Your invitation link</label><input id="setup-invitation" value={inviteUrl} readOnly onFocus={(event) => event.target.select()} /><button className="secondary-button" onClick={copyInvite}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? "Copied" : "Copy invitation"}</button><span className="sr-only" role="status">{copied ? "Invitation copied" : ""}</span>{copyError && <p className="inline-error" role="alert">{copyError}</p>}</div>}
            <div className="prejoin-facts"><span><Mic size={17} />Microphone required</span><span><Headphones size={17} />Headphones recommended</span><span><FileText size={17} />Both voices are transcribed and saved in Call Logs</span></div>
          </div>
          <div className="join-card">
            <div className="join-card-icon"><Phone size={27} /></div>
            <p className="join-card-label">2 PEOPLE · AUDIO ONLY</p>
            <h2>Join call</h2>
            <p>Allow microphone access when your browser asks.</p>
            <label className="display-name-label" htmlFor="display-name">Your display name <span>(optional)</span></label>
            <input className="display-name-input" id="display-name" autoComplete="nickname" maxLength={60} placeholder="What should we call you?" value={displayName} onChange={(event) => setDisplayName(event.target.value)} disabled={joining} />
            <button className="join-button" onClick={joinCall} disabled={joining}><Phone size={19} />{joining ? "Joining…" : "Join call"}</button>
          </div>
        </section>
      )}
      {joined && !ended && (
        <LiveKitRoom token={joined.token} serverUrl={joined.serverUrl} connect={true} audio={true} video={false} onDisconnected={() => setEnded(true)} onError={(cause) => setError(cause.message)} onMediaDeviceFailure={() => setError("Microphone access failed. Check your browser permission and device settings.")}>
          <ConnectedCall role={joined.role} language={joined.language || "en"} roomId={joined.roomId} archiveAccessKey={joined.archiveAccessKey} accessKey={joined.accessKey} onEnd={() => setEnded(true)} onError={setError} onInvite={joined.role === "caller" && inviteUrl ? openInvite : undefined} />
        </LiveKitRoom>
      )}
      {ended && (
        <section className="ended-card"><div className="ended-icon"><PhoneOff size={28} /></div><p className="prejoin-eyebrow">CALL FINISHED</p><h1>Talk again soon.</h1><p>Your microphone is disconnected. Saved captions and warnings are available in call history.</p><div className="ended-actions"><Link href="/call-logs" className="secondary-button"><FileText size={17} />View call history</Link><Link href="/calls" className="join-button"><Phone size={19} />Start another call</Link></div></section>
      )}
      {error && !ended && <p className="call-error" role="alert"><Info size={17} />{error}</p>}
      <footer className="call-footer"><span><ShieldCheck size={15} />Signed room invitation</span><span>Call speech can be transcribed, saved in Call Logs, and checked for scam and threat patterns</span></footer>
      <dialog ref={inviteDialog} className="invite-dialog" aria-labelledby="invite-title" aria-describedby="invite-description">
        <button className="dialog-close" onClick={() => inviteDialog.current?.close()} aria-label="Close invitation"><X size={21} /></button>
        <span className="invite-dialog-icon"><UserPlus size={25} /></span>
        <h2 id="invite-title">Bring someone into the conversation.</h2>
        <p id="invite-description">Share this link with the other person. They can join from their own browser or device.</p>
        <input aria-label="Invitation link" readOnly value={inviteUrl || ""} onFocus={(event) => event.target.select()} />
        <button className="join-button" onClick={copyInvite}>{copied ? <Check size={19} /> : <Copy size={19} />}{copied ? "Copied" : "Copy invitation link"}</button>
        <p className="invite-detail">One other person · Invitation valid for 2 hours</p>
        {copyError && <p className="invite-copy-error" role="alert">{copyError}</p>}
        <span className="sr-only" role="status">{copied ? "Invitation link copied" : ""}</span>
      </dialog>
    </main>
  );
}
