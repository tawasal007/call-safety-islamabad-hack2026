"use client";

import { Bell, Download, FileText } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ConcernBadge, HighlightedText, sortWarnings, WarningCard } from "../components/warning-card";
import { getSavedCalls, type SavedCall } from "@/lib/call-log-client";
import { localCallDetail } from "@/lib/local-call-record";
import type { CallDetail, CallSummary } from "@/lib/monitoring/call-record";
import { riskLabel, riskScore } from "@/lib/detector/risk-score";

type ListedCall = Omit<SavedCall, "role"> & { role: SavedCall["role"] | "guardian" };
type Loaded = { summary?: CallSummary; error?: string };

const ALERT_LABELS: Record<string, string> = {
  delivered: "Delivered",
  simulated: "Recorded in demo outbox (not sent)",
  failed: "Delivery failed",
  suppressed_cooldown: "Held back by cooldown",
};

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Unknown";
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "Unknown";
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** A guardian alert link looks like /call-logs?room=<id>#key=<room-scoped key>. */
function guardianLinkCall(): ListedCall | null {
  const room = new URLSearchParams(window.location.search).get("room");
  const key = new URLSearchParams(window.location.hash.slice(1)).get("key");
  if (!room || !key || !/^call-[0-9a-f-]{36}$/.test(room)) return null;
  // Remove the key from the address bar so it is not bookmarked or shared by accident.
  window.history.replaceState(null, "", window.location.pathname);
  return { roomId: room, archiveAccessKey: key, role: "guardian", joinedAt: new Date().toISOString() };
}

export default function CallLogsPage() {
  const [calls, setCalls] = useState<ListedCall[]>([]);
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const guardian = guardianLinkCall();
    const saved: ListedCall[] = getSavedCalls();
    const list = guardian ? [guardian, ...saved.filter((call) => call.roomId !== guardian.roomId)] : saved;
    setCalls(list);
    setSelected(list[0]?.roomId ?? null);
    const keys = list.slice(0, 25).map((call) => call.archiveAccessKey);
    if (!keys.length) { setLoading(false); return; }
    fetch("/api/calls", { headers: { "X-Call-Access": keys.join(",") }, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load call history");
        const data = await response.json() as { calls: (CallSummary | { roomId: string; error: string })[] };
        const next: Record<string, Loaded> = {};
        for (const call of list) next[call.roomId] = { error: "Access expired" };
        for (const item of data.calls) next[item.roomId] = "error" in item ? { error: item.error } : { summary: item };
        for (const item of list) {
          if (!next[item.roomId]?.error) continue;
          const local = localCallDetail(item.roomId);
          if (local) next[item.roomId] = { summary: local };
        }
        if (active) setLoaded(next);
      })
      .catch(() => { if (active) setLoaded(Object.fromEntries(list.map((call) => { const local = localCallDetail(call.roomId); return [call.roomId, local ? { summary: local } : { error: "Could not load call history" }]; }))); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const call = calls.find((item) => item.roomId === selected);

  useEffect(() => {
    if (!call) return;
    let active = true;
    setDetail(null);
    setDetailError("");
    fetch(`/api/calls/${encodeURIComponent(call.roomId)}`, { headers: { Authorization: `Bearer ${call.archiveAccessKey}` }, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 403 ? "Access expired" : "Could not load this call");
        const data = await response.json() as CallDetail;
        if (active) setDetail(data);
      })
      .catch((error) => { if (active) { const local = localCallDetail(call.roomId); if (local) setDetail(local); else setDetailError(error instanceof Error ? error.message : "Could not load this call"); } });
    return () => { active = false; };
  }, [call]);

  async function downloadTranscript(target: ListedCall) {
    const response = await fetch(`/api/call-logs/${encodeURIComponent(target.roomId)}?format=txt`, {
      headers: { Authorization: `Bearer ${target.archiveAccessKey}` }, cache: "no-store",
    });
    const fallback = localCallDetail(target.roomId);
    if (!response.ok && !fallback) return;
    const content = response.ok ? await response.blob() : new Blob([
      fallback!.segments.map((segment) => `${new Date(segment.at).toLocaleString()} ${segment.speaker}: ${segment.text}`).join("\n")
    ], { type: "text/plain" });
    const url = URL.createObjectURL(content);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${target.roomId}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const quotes = detail?.warnings.flatMap((warning) => warning.evidence.map((item) => item.quote)) ?? [];

  return <main className="app-home">
    <section className="logs-workspace">
      <div className="workspace-title"><p className="prejoin-eyebrow">YOUR CONVERSATIONS, REMEMBERED</p><h1>Call history</h1><p>Revisit captions and safety warnings from calls joined in this browser.</p></div>
      {loading && !calls.length ? <p className="logs-empty">Loading call logs…</p> : calls.length === 0 ?
        <div className="logs-empty-card"><FileText size={28} /><h2>Your conversations will live here.</h2><p>Start a call to keep saved captions and warnings in one place.</p><Link href="/calls" className="secondary-button">Make your first call</Link></div> :
        <div className="logs-layout">
          <nav className="logs-list" aria-label="Saved calls">{calls.map((item) => {
            const summary = loaded[item.roomId]?.summary;
            return <button key={item.roomId} className={`log-list-item${selected === item.roomId ? " is-selected" : ""}`} onClick={() => setSelected(item.roomId)} aria-current={selected === item.roomId}>
              <FileText size={18} />
              <span><strong>Call {item.roomId.slice(-8)}</strong><small>{formatTime(summary?.startedAt ?? item.joinedAt)}{summary ? ` · ${summary.warningCount} warning${summary.warningCount === 1 ? "" : "s"}` : loaded[item.roomId]?.error ? ` · ${loaded[item.roomId]?.error}` : ""}</small></span>
              {summary && summary.highestConcern !== "none" && <ConcernBadge level={summary.highestConcern} />}
            </button>;
          })}</nav>
          <article className="log-detail">
            {call && <><div className="log-detail-heading"><div><p className="prejoin-eyebrow">CALL RECORD</p><h2>Call {call.roomId.slice(-8)}</h2><span>{call.role === "guardian" ? "Opened from a guardian alert" : "Your browser call"}</span></div><button className="secondary-button" onClick={() => downloadTranscript(call)} disabled={!detail}><Download size={16} />Download .txt</button></div>
              {detailError ? <p className="inline-error" role="alert">{detailError}</p> : !detail ? <p className="logs-empty">Loading call record…</p> : <>
                <dl className="call-facts">
                  <div><dt>Participants</dt><dd>{detail.participants.length ? "You and another person" : "Unknown"}</dd></div>
                  <div><dt>Highest concern</dt><dd><ConcernBadge level={detail.highestConcern} /></dd></div>
                  <div><dt>Monitoring</dt><dd>{detail.monitoringStatus}</dd></div>
                </dl>
                {call.role === "receiver" && <div className={`risk-meter is-${riskScore(detail.warnings) >= 85 ? "high" : riskScore(detail.warnings) >= 60 ? "medium" : "quiet"}`} aria-label={`Threat threshold ${riskScore(detail.warnings)} out of 100`}>
                  <div className="risk-meter-heading"><span>Threat threshold</span><strong>{riskScore(detail.warnings)}<small>/100</small></strong></div>
                  <div className="risk-meter-track"><span style={{ width: `${riskScore(detail.warnings)}%` }} /></div>
                  <p>{riskLabel(riskScore(detail.warnings))} · Based on saved warnings, not a probability.</p>
                </div>}

                <h3 className="log-section-title">Warnings</h3>
                {detail.warnings.length ? <div className="log-warnings">{sortWarnings(detail.warnings).map((warning) => <WarningCard key={warning.id} warning={warning} />)}</div>
                  : <p className="logs-empty">No warnings were raised. This does not prove the call was safe; check the monitoring status below.</p>}

                <h3 className="log-section-title"><Bell size={15} />Guardian alerts</h3>
                {detail.alerts.length ? <ul className="alert-list">{detail.alerts.map((alert) => <li key={alert.id} className={`alert-item is-${alert.status}`}>
                  <div><strong>{alert.guardianName}</strong><span>{ALERT_LABELS[alert.status] ?? alert.status} · {formatTime(alert.at)} · {alert.trigger === "call_end" ? "end of call" : "live"}</span></div>
                  <details><summary>{alert.subject}</summary><pre>{alert.body}</pre></details>
                </li>)}</ul> : <p className="logs-empty">No guardian alerts for this call.</p>}

                {detail.statusChanges.length > 0 && <><h3 className="log-section-title">Monitoring status</h3>
                  <ul className="status-list">{detail.statusChanges.map((change) => <li key={`${change.at}-${change.status}`}><span>{new Date(change.at).toLocaleTimeString()}</span><strong>{change.status}</strong>{change.reason && <small>{change.reason}</small>}</li>)}</ul></>}

                <h3 className="log-section-title">Transcript</h3>
                {detail.segments.length ? <div className="log-transcript">{detail.segments.map((segment) => <div className="log-segment" key={segment.id}><span>{new Date(segment.at).toLocaleTimeString()} · {call.role === "guardian" ? segment.speaker === "receiver" ? "Protected participant" : "Other person" : segment.speaker === call.role ? "You" : "Other person"}</span><p>{segment.speaker === "caller" ? <HighlightedText text={segment.text} quotes={quotes} /> : segment.text}</p>{(segment.translation || segment.translatedText) ? <p className="log-translation"><strong>English</strong> {segment.speaker === "caller" ? <HighlightedText text={segment.translation || segment.translatedText || ""} quotes={quotes} /> : segment.translation || segment.translatedText}</p> : segment.language && segment.language !== "en" ? <p className="translation-unavailable">English translation unavailable</p> : null}</div>)}</div>
                  : <p className="logs-empty">No final speech segments saved for this call yet. A running transcription worker is required.</p>}
              </>}
            </>}
          </article>
        </div>}
    </section>
  </main>;
}
