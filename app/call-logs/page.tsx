"use client";

import { ArrowLeft, Download, FileText, Shield } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ThemeToggle } from "../components/theme-toggle";
import { getSavedCalls, type SavedCall } from "@/lib/call-log-client";
import type { TranscriptSegment } from "@/lib/call-logs";

type CallRecord = SavedCall & { segments: TranscriptSegment[]; error?: string };

export default function CallLogsPage() {
  const [records, setRecords] = useState<CallRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const calls = getSavedCalls();
    Promise.all(calls.map(async (call): Promise<CallRecord> => {
      try {
        const response = await fetch(`/api/call-logs/${encodeURIComponent(call.roomId)}`, {
          headers: { Authorization: `Bearer ${call.archiveAccessKey}` }, cache: "no-store",
        });
        if (!response.ok) throw new Error(response.status === 403 ? "Access expired" : "Could not load transcript");
        const data = await response.json() as { segments: TranscriptSegment[] };
        return { ...call, segments: data.segments };
      } catch (error) {
        return { ...call, segments: [], error: error instanceof Error ? error.message : "Could not load transcript" };
      }
    })).then((loaded) => {
      if (!active) return;
      setRecords(loaded);
      setSelected(loaded[0]?.roomId ?? null);
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const record = records.find((item) => item.roomId === selected);

  async function downloadTranscript(call: CallRecord) {
    const response = await fetch(`/api/call-logs/${encodeURIComponent(call.roomId)}?format=txt`, {
      headers: { Authorization: `Bearer ${call.archiveAccessKey}` }, cache: "no-store",
    });
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${call.roomId}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return <main className="app-home">
    <header className="call-topbar">
      <Link href="/" className="wordmark"><span className="wordmark-mark"><Shield size={18} /></span><span>Call Safety</span></Link>
      <div className="header-tools"><Link href="/" className="header-link"><ArrowLeft size={15} />Calls</Link><ThemeToggle /></div>
    </header>
    <section className="logs-workspace">
      <div className="workspace-title"><p className="prejoin-eyebrow">HISTORY</p><h1>Call Logs</h1><p>Transcripts from calls joined in this browser. Access stays with this browser.</p></div>
      {loading ? <p className="logs-empty">Loading call logs…</p> : records.length === 0 ?
        <div className="logs-empty-card"><FileText size={28} /><h2>No calls yet</h2><p>Calls you join will appear here after transcription starts.</p><Link href="/" className="secondary-button">Go to calls</Link></div> :
        <div className="logs-layout">
          <nav className="logs-list" aria-label="Saved calls">{records.map((call) => <button key={call.roomId} className={`log-list-item${selected === call.roomId ? " is-selected" : ""}`} onClick={() => setSelected(call.roomId)}><FileText size={18} /><span><strong>Call {call.roomId.slice(-8)}</strong><small>{new Date(call.joinedAt).toLocaleString()} · {call.segments.length} lines</small></span></button>)}</nav>
          <article className="log-detail">
            {record && <><div className="log-detail-heading"><div><p className="prejoin-eyebrow">TRANSCRIPT</p><h2>Call {record.roomId.slice(-8)}</h2><span>{new Date(record.joinedAt).toLocaleString()} · You joined as {record.role}</span></div><button className="secondary-button" onClick={() => downloadTranscript(record)} disabled={!!record.error}><Download size={16} />Download .txt</button></div>
              {record.error ? <p className="inline-error" role="alert">{record.error}</p> : record.segments.length ? <div className="log-transcript">{record.segments.map((segment) => <div className="log-segment" key={segment.id}><span>{new Date(segment.at).toLocaleTimeString()} · {segment.speaker}</span><p>{segment.text}</p></div>)}</div> : <p className="logs-empty">No final speech segments saved for this call yet. A running transcription worker is required.</p>}
            </>}
          </article>
        </div>}
    </section>
  </main>;
}
