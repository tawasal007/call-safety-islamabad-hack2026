"use client";

import { useRoomContext } from "@livekit/components-react";
import { MicOff, PhoneOff, ShieldAlert, WifiOff } from "lucide-react";
import { RoomEvent, type RemoteParticipant } from "livekit-client";
import { useEffect, useState } from "react";
import { CATEGORIES, isConcernLevel, MONITORING_TOPIC, type MonitoringMessage, type MonitoringStatus, type Warning } from "@/lib/detector/types";
import { riskLabel, riskScore } from "@/lib/detector/risk-score";
import { sortWarnings, WarningCard } from "./warning-card";

type PanelStatus = MonitoringStatus | "waiting";

const STATUS_LABELS: Record<PanelStatus, string> = {
  waiting: "Waiting", connecting: "Starting", active: "Active", degraded: "Degraded", unavailable: "Unavailable", ended: "Ended",
};
const STATUSES = new Set<string>(["connecting", "active", "degraded", "unavailable", "ended"]);

function isWarning(value: unknown, roomId: string): value is Warning {
  const warning = value as Warning;
  return !!warning && typeof warning.id === "string" && warning.roomId === roomId && Number.isInteger(warning.version) &&
    typeof warning.title === "string" && isConcernLevel(warning.concernLevel) &&
    Array.isArray(warning.categories) && warning.categories.every((category) => (CATEGORIES as readonly string[]).includes(category)) &&
    Array.isArray(warning.evidence) && warning.evidence.every((item) => typeof item?.quote === "string") &&
    typeof warning.explanation === "string" && typeof warning.suggestedAction === "string" && typeof warning.uncertainty === "string";
}

function upsert(list: Warning[], incoming: Warning): Warning[] {
  const index = list.findIndex((warning) => warning.id === incoming.id);
  if (index < 0) return [...list, incoming];
  if (list[index].version >= incoming.version) return list;
  const next = [...list];
  next[index] = incoming;
  return next;
}

/**
 * Receiver-only monitoring state. Accepts LiveKit data packets on the
 * monitoring topic only when they come from the server API (no sender
 * participant); participants cannot publish data with their tokens.
 */
export function useMonitoring(roomId: string, archiveAccessKey: string, enabled: boolean) {
  const room = useRoomContext();
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [status, setStatus] = useState<{ status: PanelStatus; reason?: string }>({ status: "waiting" });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    // Recover warnings sent before this page connected (refresh or reconnect).
    fetch(`/api/calls/${encodeURIComponent(roomId)}`, { headers: { Authorization: `Bearer ${archiveAccessKey}` }, cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { warnings?: unknown[]; monitoringStatus?: string } | null) => {
        if (!active || !data) return;
        const seeded = (data.warnings ?? []).filter((item): item is Warning => isWarning(item, roomId));
        setWarnings((current) => seeded.reduce(upsert, current));
        if (data.monitoringStatus && STATUSES.has(data.monitoringStatus) && data.monitoringStatus !== "ended") {
          setStatus((current) => current.status === "waiting" ? { status: data.monitoringStatus as MonitoringStatus } : current);
        }
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [roomId, archiveAccessKey, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const decoder = new TextDecoder();
    const onData = (payload: Uint8Array, participant?: RemoteParticipant, _kind?: unknown, topic?: string) => {
      if (topic !== MONITORING_TOPIC || participant) return;
      let message: MonitoringMessage;
      try { message = JSON.parse(decoder.decode(payload)) as MonitoringMessage; } catch { return; }
      if (!message || message.v !== 1 || message.roomId !== roomId) return;
      if (message.type === "status" && STATUSES.has(message.status)) setStatus({ status: message.status, reason: message.reason });
      if (message.type === "warning" && isWarning(message.warning, roomId)) setWarnings((current) => upsert(current, message.warning));
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => { room.off(RoomEvent.DataReceived, onData); };
  }, [room, roomId, enabled]);

  return { warnings, status };
}

export function MonitoringPanel({ warnings, status }: ReturnType<typeof useMonitoring>) {
  const room = useRoomContext();
  const [actionError, setActionError] = useState("");
  const impaired = status.status === "degraded" || status.status === "unavailable";
  const ordered = sortWarnings(warnings);
  const score = riskScore(ordered);
  const top = ordered[0];
  const scoreUnavailable = impaired && !top;
  const immediateThreat = !!top && (top.categories.includes("threat_of_harm") || top.categories.includes("kidnapping_claim"));
  async function muteMicrophone() {
    try { await room.localParticipant.setMicrophoneEnabled(false); setActionError(""); }
    catch { setActionError("Could not mute the microphone. Use your device controls or end the call."); }
  }
  async function endCall() {
    try { await room.disconnect(true); setActionError(""); }
    catch { setActionError("Could not end the call. Close this tab to disconnect."); }
  }
  return (
    <section className={`monitor-panel${ordered[0] ? ` has-${ordered[0].concernLevel}` : ""}`} aria-labelledby="monitor-heading">
      <div className="safety-context-top">
        <ShieldAlert size={18} />
        <strong id="monitor-heading">Safety warnings</strong>
        <span className={`monitor-status is-${status.status}`} role="status">{STATUS_LABELS[status.status]}</span>
      </div>
      {impaired && (
        <p className="monitor-impaired" role="alert">
          <WifiOff size={15} />
          Monitoring is {status.status === "unavailable" ? "unavailable" : "degraded"}. Warnings may be delayed or missing. This does not mean the call is safe.
        </p>
      )}
      <div className={`risk-meter is-${score >= 85 ? "high" : score >= 60 ? "medium" : "quiet"}`} aria-label={scoreUnavailable ? "Concern score unavailable while monitoring is impaired" : `Concern score ${score} out of 100. ${riskLabel(score)}`}>
        <div className="risk-meter-heading"><span>Concern score</span><strong>{scoreUnavailable ? "—" : score}<small>{scoreUnavailable ? "" : "/100"}</small></strong></div>
        <div className="risk-meter-track"><span style={{ width: `${score}%` }} /></div>
        <p>{scoreUnavailable ? "Monitoring is impaired; no score is available." : `${riskLabel(score)} · Based on the highest validated warning, not a probability.`}</p>
      </div>
      <div className="monitor-warnings" aria-live="assertive">
        {ordered.length ? ordered.map((warning) => <WarningCard key={warning.id} warning={warning} />) : (
          <p className="monitor-empty">
            {status.status === "waiting" ? "Monitoring starts when the other person speaks." : "No suspicious request detected yet."} This does not mean the call is safe.
          </p>
        )}
      </div>
      {top && (
        <div className="monitor-response" role="group" aria-label="Call safety actions">
          <p>{immediateThreat ? "If you feel in danger, move somewhere safe and contact local emergency services or someone you trust. Verify any claim through a separate trusted channel." : "Do not share codes, passwords, or money. Verify the caller through an official or trusted channel."}</p>
          <div className="monitor-response-actions">
            <button type="button" onClick={muteMicrophone}><MicOff size={15} />Mute microphone</button>
            <button type="button" className="is-danger" onClick={endCall}><PhoneOff size={15} />End call</button>
          </div>
          {actionError && <p className="monitor-action-error" role="alert">{actionError}</p>}
        </div>
      )}
    </section>
  );
}
