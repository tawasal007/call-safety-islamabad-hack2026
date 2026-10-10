"use client";

import { ArrowRight, History, LayoutDashboard, Phone, RefreshCw, ShieldCheck, Users, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { historyEntries } from "../components/call-history-access";
import { ThemeToggle } from "../components/theme-toggle";

type Summary = {
  roomId: string;
  startedAt?: string;
  endedAt?: string;
  status: string;
  message: string;
  segmentCount?: number;
  matchCount?: number;
};

export default function HistoryPage() {
  const [calls, setCalls] = useState<Summary[]>([]);
  const [message, setMessage] = useState("Loading saved calls…");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const entries = historyEntries();
    if (!entries.length) {
      setMessage("Calls you create or join in this browser will appear here. History access lasts 30 days.");
      return;
    }
    async function load() {
      try {
        const response = await fetch("/api/calls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries }),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setCalls(data.calls);
        setMessage("");
      } catch (cause) {
        if (!controller.signal.aborted) {
          setMessage(cause instanceof Error ? cause.message : "Call history unavailable.");
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [reload]);

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
            <span className="nav-count">{calls.length}</span>
          </Link>
        </nav>

        <div className="sidebar-note">
          <ShieldCheck size={20} />
          <strong>Protected Records</strong>
          <p>Audio is not recorded. Transcripts and detection events are preserved locally.</p>
        </div>

        <div className="sidebar-profile">
          <div className="profile-meta">
            <span className="profile-avatar">Y</span>
            <div>
              <strong>Secure Browser</strong>
              <small>Saved on this device</small>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </aside>

      <div className="guardian-main">
        <header className="guardian-topbar">
          <div className="topbar-status">
            <span className="status-badge-live">
              <span className="live-dot" />
              Verified Call Records
            </span>
          </div>
          <ThemeToggle />
        </header>

        <section className="guardian-content">
          <div className="dashboard-title">
            <div>
              <p className="prejoin-eyebrow">SAVED CALL TRANSCRIPTS</p>
              <h1>Call History Records</h1>
              <p>Each call includes its full bilingual transcript, translation pairs, and keyword safety evidence.</p>
            </div>
            <button className="guardian-secondary" onClick={() => setReload(n => n + 1)}>
              <RefreshCw size={15} /> Refresh List
            </button>
          </div>

          <div className="guardian-panel">
            {message && <p className="monitor-message">{message}</p>}

            {calls.length > 0 ? (
              <div className="history-card-list">
                {calls.map(call => (
                  <div className="history-card-item" key={call.roomId}>
                    <div className="history-left-meta">
                      <span className={`history-call-icon ${call.status === "ended" ? "ended" : ""}`}>
                        <Phone size={18} />
                      </span>
                      <div className="history-details">
                        <strong>Call Room {call.roomId.slice(-8)}</strong>
                        <p>
                          {call.startedAt ? new Date(call.startedAt).toLocaleString() : "Log saved"} ·
                          Status: <span style={{ textTransform: "capitalize", fontWeight: 600 }}>{call.status}</span> ·
                          {call.segmentCount !== undefined ? ` ${call.segmentCount} segments` : " —"}
                          {call.matchCount !== undefined && call.matchCount > 0 && ` · ${call.matchCount} keyword flags`}
                        </p>
                      </div>
                    </div>

                    <div className="history-stats-pill">
                      <Link className="guardian-primary btn-sm" href={`/history/${call.roomId}`}>
                        Open Transcript <ExternalLink size={13} />
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : !message && (
              <div className="recent-empty">
                <History size={26} />
                <p>No saved calls found on this device.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
