"use client";

import { ArrowLeft, Download, FileText, History, LayoutDashboard, RefreshCw, ShieldCheck, Users } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { CallLog } from "@/lib/transcription";
import { historyEntries } from "../../components/call-history-access";
import { ThemeToggle } from "../../components/theme-toggle";
import { TranscriptView } from "../../components/transcript-view";

export default function CallHistoryPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const [log, setLog] = useState<CallLog | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const entry = historyEntries().find(e => e.roomId === roomId);
    if (!entry) {
      setError("This browser has no valid access key for this call log. You must join or create the call to view its private history.");
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(`/api/calls/${encodeURIComponent(roomId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ historyKey: entry!.historyKey }),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        if (active) {
          setLog(data);
          setError("");
          if (data.status !== "ended") timer = setTimeout(load, 5000);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Log unavailable.");
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [roomId, reload]);

  function download(format: "json" | "txt") {
    if (!log) return;
    const text =
      format === "json"
        ? JSON.stringify(log, null, 2)
        : [
            `Call ID: ${log.roomId}`,
            `Started At: ${log.startedAt}`,
            `Ended At: ${log.endedAt || "In progress"}`,
            "",
            ...log.segments.map(
              s =>
                `[${(s.startMs / 1000).toFixed(1)}s] ${s.speaker} (${s.language})\nOriginal: ${s.original}\nEnglish: ${s.english}\nUrdu: ${s.urdu || "Unavailable"}\n${s.matches.map(m => `${m.category}: ${m.evidence}`).join("\n")}\n`
            ),
          ].join("\n");

    const url = URL.createObjectURL(
      new Blob([text], { type: format === "json" ? "application/json" : "text/plain;charset=utf-8" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${roomId}.${format}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <main className="guardian-shell">
      <aside className="guardian-sidebar">
        <Link href="/" className="guardian-brand">
          <span className="brand-icon-wrap"><ShieldCheck size={22} /></span>
          <span className="brand-title">Guardian<span className="brand-dot">Link</span></span>
        </Link>

        <p className="nav-caption">WORKSPACE</p>
        <nav aria-label="History navigation">
          <Link href="/">
            <LayoutDashboard size={18} />
            Overview
          </Link>
          <Link href="/?tab=family">
            <Users size={18} />
            Family Circle
          </Link>
          <Link href="/history" className="active">
            <History size={18} />
            Call History
          </Link>
        </nav>

        <div className="sidebar-note">
          <ShieldCheck size={20} />
          <strong>Durable Call Log</strong>
          <p>Finalized bilingual captions, translations, and keyword scam evidence.</p>
        </div>

        <div className="sidebar-profile">
          <ThemeToggle />
        </div>
      </aside>

      <div className="guardian-main">
        <header className="guardian-topbar">
          <div className="topbar-status">
            <Link href="/history" className="panel-link" style={{ fontSize: "13px" }}>
              <ArrowLeft size={16} /> Back to all calls
            </Link>
          </div>
          <ThemeToggle />
        </header>

        <section className="guardian-content">
          <div className="dashboard-title">
            <div>
              <p className="prejoin-eyebrow">SAVED TRANSCRIPT LOG</p>
              <h1>Call {roomId.slice(-8)}</h1>
              <p>Review the full bilingual transcript, speech timestamps, and detection events.</p>
            </div>

            <div style={{ display: "flex", gap: "10px" }}>
              <button className="guardian-secondary btn-sm" onClick={() => download("txt")}>
                <FileText size={14} /> Download TXT
              </button>
              <button className="guardian-secondary btn-sm" onClick={() => download("json")}>
                <Download size={14} /> Download JSON
              </button>
              <button className="guardian-secondary btn-sm" onClick={() => setReload(n => n + 1)}>
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          {error && <p className="call-error">{error}</p>}

          {log && (
            <div className="guardian-panel">
              <div className="panel-heading">
                <div>
                  <h2>Transcript & Translation Records</h2>
                  <p>
                    Started: {new Date(log.startedAt).toLocaleString()} · Status:{" "}
                    <strong style={{ color: "var(--accent)" }}>{log.status}</strong>
                  </p>
                </div>
                <span className={`monitor-status status-${log.status}`}>{log.status}</span>
              </div>

              <TranscriptView segments={log.segments} />

              {log.events.length > 0 && (
                <details className="monitor-events" style={{ marginTop: "24px" }}>
                  <summary style={{ fontWeight: 600, cursor: "pointer" }}>
                    Monitoring System Event Log ({log.events.length})
                  </summary>
                  <div style={{ marginTop: "12px", display: "grid", gap: "8px" }}>
                    {log.events.map((e, i) => (
                      <p key={i} style={{ margin: 0, fontSize: "12px", color: "var(--muted)" }}>
                        <time>{new Date(e.timestamp).toLocaleTimeString()}</time> · <strong>{e.status}</strong>: {e.message}
                      </p>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
