"use client";

import { Download, FileWarning, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConcernBadge, HighlightedText, sortWarnings } from "../components/warning-card";
import { getSavedCalls, type SavedCall } from "@/lib/call-log-client";
import type { CallDetail } from "@/lib/monitoring/call-record";
import { riskLabel, riskScore } from "@/lib/detector/risk-score";

type ReportCall = SavedCall;

function reportText(call: ReportCall, detail: CallDetail) {
  const score = riskScore(detail.warnings);
  const warningText = detail.warnings.length
    ? sortWarnings(detail.warnings).map((warning) => `- ${warning.title} (${warning.concernLevel}): ${warning.evidence.map((item) => `“${item.quote}”`).join("; ")}`).join("\n")
    : "- No alert was generated for this call.";
  const transcript = detail.segments.map((segment) => `${segment.speaker === call.role ? "Participant" : "Other person"}: ${segment.text}`).join("\n") || "No saved transcript.";
  return `SADASAFE — CRIME REPORT\n\nCall reference: ${call.roomId}\nThreat threshold: ${score}/100 (${riskLabel(score)})\nMonitoring: ${detail.monitoringStatus}\n\nDetected concerns\n${warningText}\n\nTranscript evidence\n${transcript}\n\nImportant: This is an automated safety report based on a browser call transcript. It does not verify a crime or replace police investigation.`;
}

export default function CrimeReportsPage() {
  const [calls, setCalls] = useState<ReportCall[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [error, setError] = useState("");
  const call = calls.find((item) => item.roomId === selected);

  useEffect(() => {
    const saved = getSavedCalls();
    setCalls(saved);
    setSelected(saved[0]?.roomId ?? null);
  }, []);

  useEffect(() => {
    if (!call) return;
    setDetail(null); setError("");
    fetch(`/api/calls/${encodeURIComponent(call.roomId)}`, { headers: { Authorization: `Bearer ${call.archiveAccessKey}` }, cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error("Could not load this call report."); return response.json() as Promise<CallDetail>; })
      .then(setDetail).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load this call report."));
  }, [call]);

  const score = useMemo(() => detail ? riskScore(detail.warnings) : 0, [detail]);
  function downloadReport() {
    if (!call || !detail) return;
    const blob = new Blob([reportText(call, detail)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `crime-report-${call.roomId.slice(-8)}.txt`; link.click();
    URL.revokeObjectURL(url);
  }

  return <main className="app-home"><section className="logs-workspace">
    <div className="workspace-title"><p className="prejoin-eyebrow">DOCUMENTED FROM SAVED CALL LOGS</p><h1>Crime reports</h1><p>Generate a concise incident report with warning evidence and the saved transcript for each call.</p></div>
    {!calls.length ? <div className="logs-empty-card"><FileWarning size={28} /><h2>No call reports yet.</h2><p>Reports become available after a call is joined in this browser.</p></div> :
      <div className="logs-layout"><nav className="logs-list" aria-label="Call reports">{calls.map((item) => <button key={item.roomId} className={`log-list-item${selected === item.roomId ? " is-selected" : ""}`} onClick={() => setSelected(item.roomId)}><FileWarning size={18} /><span><strong>Report {item.roomId.slice(-8)}</strong><small>Generate from saved call log</small></span></button>)}</nav>
        <article className="log-detail">{error ? <p className="inline-error" role="alert">{error}</p> : !call || !detail ? <p className="logs-empty">Preparing report…</p> : <>
          <div className="log-detail-heading"><div><p className="prejoin-eyebrow">AUTOMATED INCIDENT SUMMARY</p><h2>Crime report</h2><span>Call {call.roomId.slice(-8)}</span></div><button className="secondary-button" onClick={downloadReport}><Download size={16} />Download report</button></div>
          <div className={`risk-meter is-${score >= 85 ? "high" : score >= 60 ? "medium" : "quiet"}`}><div className="risk-meter-heading"><span>Threat threshold</span><strong>{score}<small>/100</small></strong></div><div className="risk-meter-track"><span style={{ width: `${score}%` }} /></div><p>{riskLabel(score)} · Generated from saved warnings.</p></div>
          <dl className="call-facts"><div><dt>Monitoring</dt><dd>{detail.monitoringStatus}</dd></div><div><dt>Detected warnings</dt><dd>{detail.warningCount}</dd></div><div><dt>Highest concern</dt><dd><ConcernBadge level={detail.highestConcern} /></dd></div></dl>
          <h3 className="log-section-title"><ShieldAlert size={15} />Evidence</h3>
          {detail.warnings.length ? <div className="log-warnings">{sortWarnings(detail.warnings).map((warning) => <article className="warning-card" key={warning.id}><strong>{warning.title}</strong><p>{warning.evidence.map((item) => <mark key={`${item.segmentId}-${item.quote}`}>{item.quote} </mark>)}</p><p>{warning.explanation}</p></article>)}</div> : <p className="logs-empty">No crime indicators were detected in this call log.</p>}
          <h3 className="log-section-title">Transcript evidence</h3>
          <div className="log-transcript">{detail.segments.map((segment) => <div className="log-segment" key={segment.id}><span>{segment.speaker === call.role ? "You" : "Other person"}</span><p><HighlightedText text={segment.text} quotes={detail.warnings.flatMap((warning) => warning.evidence.map((item) => item.quote))} /></p></div>)}</div>
        </>}</article></div>}
  </section></main>;
}
