"use client";

import {
  ArrowRight, Check, Copy, Headphones, History, LayoutDashboard,
  Link2, Mic, Plus, Shield, ShieldCheck, Trash2, Users, X, Phone,
  Sparkles, Table, Network, Split, Search, RefreshCw, Clock, ExternalLink
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent, type CSSProperties } from "react";
import { ThemeToggle } from "./components/theme-toggle";
import { historyEntries, type HistoryEntry } from "./components/call-history-access";

type Member = {
  id: string;
  name: string;
  relation: string;
  color: string;
  language?: string;
  status?: string;
};

type CallSummary = {
  roomId: string;
  startedAt?: string;
  endedAt?: string;
  status: string;
  message: string;
  segmentCount?: number;
  matchCount?: number;
};

const STORAGE_KEY = "call-safety-family-v1";
const colors = ["#10b981", "#06b6d4", "#8b5cf6", "#ec4899", "#f59e0b"];

const initialPreview: Member[] = [
  { id: "demo-0", name: "Ammi", relation: "Mother", color: colors[0], language: "Urdu", status: "Protected" },
  { id: "demo-1", name: "Abu", relation: "Father", color: colors[1], language: "Urdu", status: "Protected" },
  { id: "demo-2", name: "Sara", relation: "Sister", color: colors[2], language: "English", status: "Protected" },
  { id: "demo-3", name: "Dadi", relation: "Grandmother", color: colors[3], language: "Urdu", status: "Protected" },
];

function initials(name: string) {
  return name.split(/\s+/).map(p => p[0]).slice(0, 2).join("").toUpperCase();
}

export default function HomePage() {
  const router = useRouter();
  const [tab, setTab] = useState<"dashboard" | "family" | "history">("dashboard");
  const [members, setMembers] = useState<Member[]>([]);
  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [historySummaries, setHistorySummaries] = useState<CallSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Graph Table view states
  const [viewMode, setViewMode] = useState<"split" | "graph" | "table">("split");
  const [searchQuery, setSearchQuery] = useState("");

  // Room creation and Join states
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const [room, setRoom] = useState<{ roomId: string; inviteUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [invitation, setInvitation] = useState("");
  const [joinError, setJoinError] = useState("");

  // Add Member Dialog states
  const [addOpen, setAddOpen] = useState(false);
  const memberDialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [memberLang, setMemberLang] = useState("Urdu");
  const [language, setLanguage] = useState("en");

  // Load contacts and call history on mount
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(stored) && stored.length > 0) {
        setMembers(stored.filter(m => m && typeof m.id === "string" && typeof m.name === "string").slice(0, 20));
      } else {
        setMembers(initialPreview);
      }
    } catch {
      setStorageError("Family contacts could not be loaded from this browser.");
      setMembers(initialPreview);
    }

    const currentEntries = historyEntries();
    setEntries(currentEntries);
    setReady(true);
  }, []);

  // Save contacts to localStorage
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(members));
    } catch {
      setStorageError("Browser storage is unavailable. Contacts will only last for this visit.");
    }
  }, [members, ready]);

  // Fetch detailed call summaries when switching to history or dashboard
  useEffect(() => {
    if (!entries.length) return;
    let active = true;
    async function fetchSummaries() {
      setHistoryLoading(true);
      try {
        const response = await fetch("/api/calls", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries }),
        });
        const data = await response.json();
        if (response.ok && active && Array.isArray(data.calls)) {
          setHistorySummaries(data.calls);
        }
      } catch {
        // Fallback gracefully
      } finally {
        if (active) setHistoryLoading(false);
      }
    }
    void fetchSummaries();
    return () => { active = false; };
  }, [entries]);

  // Modal dialog handling
  useEffect(() => {
    if (addOpen) memberDialog.current?.showModal();
    else memberDialog.current?.close();
  }, [addOpen]);

  const displayedMembers = members.filter(m =>
    m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.relation.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedMember = members.find(m => m.id === selected);

  async function createCall(customLang?: string) {
    setCreating(true);
    setError("");
    setCopied(false);
    const spokenLang = customLang || language;
    try {
      const response = await fetch("/api/rooms", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create a room.");

      sessionStorage.setItem(`caller-access:${data.roomId}`, data.callerAccessKey);
      sessionStorage.setItem(`receiver-invite:${data.roomId}`, data.inviteUrl);
      sessionStorage.setItem(`speech-language:${data.roomId}`, spokenLang);
      setRoom({ roomId: data.roomId, inviteUrl: data.inviteUrl });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a room.");
    } finally {
      setCreating(false);
    }
  }

  async function copyInvite() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.inviteUrl);
      setCopied(true);
      setError("");
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Select the invitation below and copy it manually.");
    }
  }

  function openInvitation(e: FormEvent) {
    e.preventDefault();
    setJoinError("");
    try {
      const url = new URL(invitation.trim());
      const key = url.searchParams.get("invite");
      if (url.origin !== window.location.origin || !/^\/call\/call-[0-9a-f-]{36}$/i.test(url.pathname) || !key || key.length > 2048) {
        throw new Error();
      }
      router.push(url.pathname + "?invite=" + encodeURIComponent(key));
    } catch {
      setJoinError("Paste a valid receiver invitation link from this website.");
    }
  }

  function addMember(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !relation.trim() || members.length >= 24) return;
    const m: Member = {
      id: crypto.randomUUID(),
      name: name.trim(),
      relation: relation.trim(),
      color: colors[members.length % colors.length],
      language: memberLang,
      status: "Protected",
    };
    setMembers([...members, m]);
    setSelected(m.id);
    setName("");
    setRelation("");
    setAddOpen(false);
  }

  function removeMember(id: string) {
    setMembers(members.filter(m => m.id !== id));
    if (selected === id) setSelected(null);
  }

  return (
    <main className="guardian-shell">
      {/* Enhanced Unified Navigation Sidebar */}
      <aside className="guardian-sidebar">
        <Link href="/" className="guardian-brand">
          <span className="brand-icon-wrap"><ShieldCheck size={22} /></span>
          <span className="brand-title">Guardian<span className="brand-dot">Link</span></span>
        </Link>

        <p className="nav-caption">WORKSPACE NAVIGATION</p>
        <nav aria-label="Main navigation">
          <button
            className={tab === "dashboard" ? "active" : ""}
            onClick={() => setTab("dashboard")}
          >
            <LayoutDashboard size={18} />
            Overview
          </button>
          <button
            className={tab === "family" ? "active" : ""}
            onClick={() => setTab("family")}
          >
            <Users size={18} />
            Family Circle
            <span className="nav-count">{members.length}</span>
          </button>
          <button
            className={tab === "history" ? "active" : ""}
            onClick={() => setTab("history")}
          >
            <History size={18} />
            Call History
            {entries.length > 0 && <span className="nav-count">{entries.length}</span>}
          </button>
        </nav>

        <div className="sidebar-note">
          <Shield size={20} />
          <strong>Bilingual Live Safety</strong>
          <p>Real-time speech translation and threat detection in Urdu & English.</p>
        </div>

        <div className="sidebar-profile">
          <div className="profile-meta">
            <span className="profile-avatar">Y</span>
            <div>
              <strong>Secure Browser</strong>
              <small>Protected session</small>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="guardian-main">
        <header className="guardian-topbar">
          <div className="topbar-status">
            <span className="status-badge-live">
              <span className="live-dot" />
              English & Urdu Live STT Active
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              className="guardian-secondary btn-sm"
              onClick={() => { setTab("family"); setAddOpen(true); }}
            >
              <Plus size={15} /> Add Member
            </button>
            <ThemeToggle />
          </div>
        </header>

        <section className="guardian-content">
          {/* Top Title Banner */}
          <div className="dashboard-title">
            <div>
              <p className="prejoin-eyebrow">
                {tab === "dashboard" && "SMART CALL SAFETY SYSTEM"}
                {tab === "family" && "FAMILY NETWORK & DIRECTORY"}
                {tab === "history" && "CALL LOGS & VERIFIED TRANSCRIPTS"}
              </p>
              <h1>
                {tab === "dashboard" && "Real-Time Audio Protection."}
                {tab === "family" && "Family Circle & Directory Table."}
                {tab === "history" && "Call History & Recordings."}
              </h1>
              <p>
                {tab === "dashboard" && "Two-way audio calls with real-time bilingual transcription, AI threat detection, and instant verification."}
                {tab === "family" && "Interactive network graph and verified contact directory with instant call launching."}
                {tab === "history" && "Review finalized bilingual call transcripts, scam analysis, and monitoring events."}
              </p>
            </div>
          </div>

          {/* =================================================================
              TAB 1: DASHBOARD / OVERVIEW
             ================================================================= */}
          {tab === "dashboard" && (
            <>
              {/* Premium Hero Banner */}
              <div className="dashboard-hero">
                <div className="hero-copy">
                  <span className="hero-label">
                    <Sparkles size={13} /> ISLAMABAD HACK 2026 PROTOTYPE
                  </span>
                  <h2>
                    Protect your family.<br />
                    <em>Clear, safe audio calls.</em>
                  </h2>
                  <p>
                    Talk in English or Urdu with streaming speech-to-text, live translations,
                    and intelligent keyword scam detection during the call.
                  </p>
                  <div className="hero-actions">
                    <button className="guardian-primary" onClick={() => createCall()} disabled={creating}>
                      <Phone size={17} />
                      {creating ? "Creating call…" : "Start Protected Call"}
                      <ArrowRight size={16} />
                    </button>
                    <button className="hero-text-button" onClick={() => setTab("family")}>
                      View Family Graph & Table →
                    </button>
                  </div>
                  <span className="hero-footnote">
                    <Headphones size={14} />
                    Two-person browser audio · LiveKit Cloud · Independent speaker streams
                  </span>
                </div>

                <div className="hero-orbit" aria-hidden="true">
                  <div className="orbit-ring" />
                  <div className="orbit-ring ring-two" />
                  <div className="orbit-center">
                    <ShieldCheck size={42} />
                  </div>
                  <span className="orbit-person person-one">ا</span>
                  <span className="orbit-person person-two">A</span>
                  <div className="orbit-translation">
                    <span>"Hello, how are you?"</span>
                    <b lang="ur" dir="rtl">سلام، آپ کیسے ہیں؟</b>
                    <small>Live Bilingual Translation</small>
                  </div>
                </div>
              </div>

              {/* Stats Overview */}
              <div className="dashboard-stats">
                <div className="stat-card">
                  <span className="stat-icon"><Users size={22} /></span>
                  <div>
                    <strong>{members.length}</strong>
                    <span>Protected Circle Members</span>
                  </div>
                </div>
                <div className="stat-card">
                  <span className="stat-icon blue"><History size={22} /></span>
                  <div>
                    <strong>{entries.length}</strong>
                    <span>Calls Saved in Browser</span>
                  </div>
                </div>
                <div className="stat-card">
                  <span className="stat-icon purple"><Mic size={22} /></span>
                  <div>
                    <strong>Bilingual</strong>
                    <span>Deepgram Nova-3 & Gemini STT</span>
                  </div>
                </div>
              </div>

              {/* Quick Connect & Invitation Section */}
              <div className="guardian-grid">
                {/* Mini Graph & Family Preview */}
                <section className="guardian-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Family Safety Circle</h2>
                      <p>Click any member to start a call</p>
                    </div>
                    <button className="panel-link" onClick={() => setTab("family")}>
                      Open Full Graph & Table <ArrowRight size={13} />
                    </button>
                  </div>

                  <div className="family-graph-wrap" style={{ minHeight: "280px" }}>
                    <svg className="graph-canvas" viewBox="0 0 600 350" preserveAspectRatio="none">
                      {members.slice(0, 6).map((m, i) => {
                        const angle = (2 * Math.PI * i) / Math.min(members.length, 6) - Math.PI / 2;
                        const x = 300 + Math.cos(angle) * 190;
                        const y = 175 + Math.sin(angle) * 110;
                        return (
                          <line
                            key={m.id}
                            x1="300"
                            y1="175"
                            x2={x}
                            y2={y}
                            className={`graph-edge ${selected === m.id ? "selected-edge" : ""}`}
                          />
                        );
                      })}
                    </svg>

                    <button
                      className="family-node self-node"
                      style={{ left: "50%", top: "50%" }}
                      onClick={() => setSelected(null)}
                      title="You (Center)"
                    >
                      <span className="node-avatar"><ShieldCheck size={28} /></span>
                      <strong>You</strong>
                      <small>Protected</small>
                    </button>

                    {members.slice(0, 6).map((m, i) => {
                      const angle = (2 * Math.PI * i) / Math.min(members.length, 6) - Math.PI / 2;
                      const xPercent = 50 + Math.cos(angle) * 32;
                      const yPercent = 50 + Math.sin(angle) * 31;
                      return (
                        <button
                          key={m.id}
                          className={`family-node ${selected === m.id ? "selected" : ""}`}
                          style={{
                            left: `${xPercent}%`,
                            top: `${yPercent}%`,
                            "--member-color": m.color,
                          } as CSSProperties}
                          onClick={() => setSelected(m.id)}
                          title={`${m.name} · ${m.relation}`}
                        >
                          <span className="node-avatar" style={{ borderColor: m.color, color: m.color }}>
                            {initials(m.name)}
                          </span>
                          <strong>{m.name}</strong>
                          <small>{m.relation}</small>
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Instant Call Launch Panel */}
                <aside className="guardian-panel connection-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>{selectedMember ? `Call ${selectedMember.name}` : "Start a Call"}</h2>
                      <p>{selectedMember ? `Relationship: ${selectedMember.relation}` : "Generate a private room and share the invite"}</p>
                    </div>
                    <Link2 size={18} />
                  </div>

                  {selectedMember && (
                    <div className="selected-member-card">
                      <span
                        className="selected-avatar-large"
                        style={{ background: `${selectedMember.color}22`, color: selectedMember.color }}
                      >
                        {initials(selectedMember.name)}
                      </span>
                      <h3>{selectedMember.name}</h3>
                      <p>{selectedMember.relation} · {selectedMember.language || "Urdu"}</p>
                      <span className="tag-badge tag-status-safe">
                        <Check size={12} /> Verified Contact
                      </span>
                    </div>
                  )}

                  {!room ? (
                    <>
                      <div className="call-steps">
                        <div className="call-step-item">
                          <span>1</span>
                          <p><strong>Spoken Language</strong>Choose your language preference for live captions.</p>
                        </div>
                        <div className="call-step-item">
                          <span>2</span>
                          <p><strong>Private Invitation</strong>Recipient opens direct link without any password.</p>
                        </div>
                      </div>

                      <label className="dashboard-language">
                        Your Spoken Language
                        <select value={language} onChange={e => setLanguage(e.target.value)}>
                          <option value="en">English — Live captions & translation</option>
                          <option value="ur">Urdu / اردو — Live captions & translation</option>
                        </select>
                      </label>

                      <button
                        className="guardian-primary full-width"
                        onClick={() => createCall(selectedMember?.language === "Urdu" ? "ur" : "en")}
                        disabled={creating}
                      >
                        <Phone size={17} />
                        {creating ? "Creating Room…" : selectedMember ? `Start Call with ${selectedMember.name}` : "Create Call Room"}
                      </button>
                    </>
                  ) : (
                    <div className="dashboard-invite">
                      <span className="room-ready-badge">
                        <Check size={16} /> Room Ready!
                      </span>
                      <h3>Invite Recipient</h3>
                      <p>Send this link to the second person. It grants instant audio call access.</p>

                      <div className="invite-input-row">
                        <input value={room.inviteUrl} readOnly onFocus={e => e.target.select()} />
                        <button className="guardian-secondary" onClick={copyInvite}>
                          {copied ? <Check size={16} /> : <Copy size={16} />}
                        </button>
                      </div>

                      <Link className="guardian-primary full-width" href={`/call/${room.roomId}`}>
                        <Phone size={17} /> Enter Call Room <ArrowRight size={16} />
                      </Link>
                      <button className="panel-link" onClick={() => setRoom(null)}>
                        Create another room
                      </button>
                    </div>
                  )}

                  {error && <p className="call-error">{error}</p>}
                </aside>
              </div>

              {/* Bottom Dashboard Grid: Recent Logs & Join Invitation */}
              <div className="dashboard-bottom">
                {/* Recent Calls */}
                <section className="guardian-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Recent Protected Calls</h2>
                      <p>View transcripts and safety evidence</p>
                    </div>
                    <button className="panel-link" onClick={() => setTab("history")}>
                      View All Logs <ArrowRight size={13} />
                    </button>
                  </div>

                  {entries.length > 0 ? (
                    entries.slice(0, 4).map(e => (
                      <Link className="recent-conversation" key={e.roomId} href={`/history/${e.roomId}`}>
                        <span className="recent-icon"><Phone size={16} /></span>
                        <div>
                          <strong>Call {e.roomId.slice(-8)}</strong>
                          <small>{new Date(e.savedAt).toLocaleDateString()} · Bilingual Captions & Safety Logs</small>
                        </div>
                        <ArrowRight size={16} />
                      </Link>
                    ))
                  ) : (
                    <div className="recent-empty">
                      <History size={24} />
                      <p>No call history yet. Start your first call above.</p>
                    </div>
                  )}
                </section>

                {/* Join Call via Link Form */}
                <section className="guardian-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Join an Existing Call</h2>
                      <p>Have an invitation link from a family member?</p>
                    </div>
                    <Link2 size={18} />
                  </div>

                  <form onSubmit={openInvitation}>
                    <label style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 600 }}>
                      Paste Invitation Link
                    </label>
                    <div className="invitation-input">
                      <input
                        value={invitation}
                        onChange={e => setInvitation(e.target.value)}
                        placeholder="http://localhost:3000/call/call-..."
                        autoComplete="off"
                      />
                      <button type="submit" aria-label="Join call" disabled={!invitation.trim()}>
                        <ArrowRight size={18} />
                      </button>
                    </div>
                    {joinError && <p className="call-error">{joinError}</p>}
                  </form>
                  <p className="connection-note">
                    <ShieldCheck size={14} /> Links are signed and grant receiver access to the call.
                  </p>
                </section>
              </div>
            </>
          )}

          {/* =================================================================
              TAB 2: FAMILY CIRCLE & GRAPH TABLE (ENHANCED VIEW)
             ================================================================= */}
          {tab === "family" && (
            <div className="graph-table-container">
              {/* Header Controls: View Switcher, Search, Add Member */}
              <div className="graph-table-header-controls">
                <div className="view-mode-selector">
                  <button
                    className={`view-mode-btn ${viewMode === "split" ? "active" : ""}`}
                    onClick={() => setViewMode("split")}
                  >
                    <Split size={15} /> Split View
                  </button>
                  <button
                    className={`view-mode-btn ${viewMode === "graph" ? "active" : ""}`}
                    onClick={() => setViewMode("graph")}
                  >
                    <Network size={15} /> Graph Only
                  </button>
                  <button
                    className={`view-mode-btn ${viewMode === "table" ? "active" : ""}`}
                    onClick={() => setViewMode("table")}
                  >
                    <Table size={15} /> Table Only
                  </button>
                </div>

                <div className="graph-table-actions">
                  <div className="search-input-wrap">
                    <Search size={15} />
                    <input
                      placeholder="Search member or relation..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                    />
                  </div>
                  <button className="guardian-primary btn-sm" onClick={() => setAddOpen(true)}>
                    <Plus size={15} /> Add Member
                  </button>
                </div>
              </div>

              {/* Layout depending on View Mode */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: viewMode === "split" ? "1.2fr 1fr" : "1fr",
                  gap: "24px",
                  alignItems: "start",
                }}
              >
                {/* 1. Network Graph */}
                {(viewMode === "split" || viewMode === "graph") && (
                  <section className="guardian-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Interactive Network Graph</h2>
                        <p>Click any node to select and view contact details</p>
                      </div>
                      <span className="tag-badge tag-status-safe">
                        <Users size={12} /> {displayedMembers.length} Connections
                      </span>
                    </div>

                    <div className={`family-graph-wrap ${viewMode === "graph" ? "expanded" : ""}`}>
                      <svg className="graph-canvas" viewBox="0 0 600 400" preserveAspectRatio="none">
                        {displayedMembers.map((m, i) => {
                          const angle = (2 * Math.PI * i) / displayedMembers.length - Math.PI / 2;
                          const x = 300 + Math.cos(angle) * 200;
                          const y = 200 + Math.sin(angle) * 130;
                          return (
                            <line
                              key={m.id}
                              x1="300"
                              y1="200"
                              x2={x}
                              y2={y}
                              className={`graph-edge ${selected === m.id ? "selected-edge" : ""}`}
                            />
                          );
                        })}
                      </svg>

                      {/* Central Self Node */}
                      <button
                        className="family-node self-node"
                        style={{ left: "50%", top: "50%" }}
                        onClick={() => setSelected(null)}
                      >
                        <span className="node-avatar"><ShieldCheck size={28} /></span>
                        <strong>You</strong>
                        <small>Guardian</small>
                      </button>

                      {/* Orbiting Member Nodes */}
                      {displayedMembers.map((m, i) => {
                        const angle = (2 * Math.PI * i) / displayedMembers.length - Math.PI / 2;
                        const xPercent = 50 + Math.cos(angle) * 33;
                        const yPercent = 50 + Math.sin(angle) * 32;
                        return (
                          <button
                            key={m.id}
                            className={`family-node ${selected === m.id ? "selected" : ""}`}
                            style={{
                              left: `${xPercent}%`,
                              top: `${yPercent}%`,
                              "--member-color": m.color,
                            } as CSSProperties}
                            onClick={() => setSelected(m.id)}
                          >
                            <span className="node-avatar" style={{ borderColor: m.color, color: m.color }}>
                              {initials(m.name)}
                            </span>
                            <strong>{m.name}</strong>
                            <small>{m.relation}</small>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}

                {/* 2. Directory Table ("The Graph Table") */}
                {(viewMode === "split" || viewMode === "table") && (
                  <section className="guardian-panel">
                    <div className="panel-heading">
                      <div>
                        <h2>Member Directory Table</h2>
                        <p>Verified contacts with quick call launch</p>
                      </div>
                      <span className="tag-badge tag-language">
                        Auto-Synchronized
                      </span>
                    </div>

                    <div className="graph-table-table-wrap">
                      <table className="graph-table">
                        <thead>
                          <tr>
                            <th>Contact</th>
                            <th>Relation</th>
                            <th>Language</th>
                            <th>Status</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {displayedMembers.length > 0 ? (
                            displayedMembers.map(m => (
                              <tr
                                key={m.id}
                                className={selected === m.id ? "selected-row" : ""}
                                onClick={() => setSelected(m.id)}
                              >
                                <td>
                                  <div className="table-member-info">
                                    <span
                                      className="table-avatar"
                                      style={{ background: `${m.color}22`, color: m.color }}
                                    >
                                      {initials(m.name)}
                                    </span>
                                    <div className="table-name-wrap">
                                      <strong>{m.name}</strong>
                                      <small>ID: {m.id.slice(0, 6)}</small>
                                    </div>
                                  </div>
                                </td>
                                <td>
                                  <span className="tag-badge tag-relation">{m.relation}</span>
                                </td>
                                <td>
                                  <span className="tag-badge tag-language">{m.language || "Urdu"}</span>
                                </td>
                                <td>
                                  <span className="tag-badge tag-status-safe">
                                    <Check size={11} /> {m.status || "Protected"}
                                  </span>
                                </td>
                                <td>
                                  <div className="table-actions" onClick={e => e.stopPropagation()}>
                                    <button
                                      className="btn-icon-table call-btn"
                                      title={`Start call with ${m.name}`}
                                      onClick={() => {
                                        setSelected(m.id);
                                        createCall(m.language === "English" ? "en" : "ur");
                                      }}
                                    >
                                      <Phone size={14} />
                                    </button>
                                    <button
                                      className="btn-icon-table delete-btn"
                                      title="Remove from circle"
                                      onClick={() => removeMember(m.id)}
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={5} style={{ textAlign: "center", padding: "30px", color: "var(--muted)" }}>
                                No matching contacts found.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
              </div>
            </div>
          )}

          {/* =================================================================
              TAB 3: CALL HISTORY (INTEGRATED VIEW)
             ================================================================= */}
          {tab === "history" && (
            <div className="guardian-panel">
              <div className="panel-heading">
                <div>
                  <h2>Protected Call Records</h2>
                  <p>Encrypted per-call logs with bilingual transcripts and detection events</p>
                </div>
                <button
                  className="guardian-secondary btn-sm"
                  onClick={() => setEntries(historyEntries())}
                  disabled={historyLoading}
                >
                  <RefreshCw size={14} className={historyLoading ? "spin" : ""} /> Refresh
                </button>
              </div>

              {entries.length > 0 ? (
                <div className="history-card-list">
                  {entries.map(e => {
                    const summary = historySummaries.find(s => s.roomId === e.roomId);
                    return (
                      <div className="history-card-item" key={e.roomId}>
                        <div className="history-left-meta">
                          <span className={`history-call-icon ${summary?.status === "ended" ? "ended" : ""}`}>
                            <Phone size={18} />
                          </span>
                          <div className="history-details">
                            <strong>Call Room {e.roomId.slice(-8)}</strong>
                            <p>
                              {new Date(e.savedAt).toLocaleString()} ·
                              Status: {summary?.status || "Saved"}
                              {summary?.segmentCount !== undefined && ` · ${summary.segmentCount} segments`}
                              {summary?.matchCount !== undefined && summary.matchCount > 0 && ` · ${summary.matchCount} flags`}
                            </p>
                          </div>
                        </div>

                        <div className="history-stats-pill">
                          <Link className="guardian-secondary btn-sm" href={`/history/${e.roomId}`}>
                            View Full Transcript <ExternalLink size={13} />
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="recent-empty">
                  <History size={26} />
                  <div>
                    <strong>No call logs stored on this browser yet.</strong>
                    <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: "12px" }}>
                      Each call you create or join will store its bilingual transcripts here for 30 days.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <footer className="guardian-footer">
            <span><ShieldCheck size={14} /> Built for Islamabad Hack 2026 · LiveKit & Bilingual STT</span>
            <span>Microphone audio remains local · Transcripts stored in browser session</span>
          </footer>
        </section>
      </div>

      {/* Add Member Dialog Modal */}
      <dialog
        ref={memberDialog}
        className="member-backdrop"
        onCancel={() => setAddOpen(false)}
        onClick={e => { if (e.target === e.currentTarget) setAddOpen(false); }}
      >
        <div className="member-modal" role="dialog" aria-modal="true">
          <button className="modal-close" onClick={() => setAddOpen(false)}>
            <X size={18} />
          </button>
          <h2>Add to Family Circle</h2>
          <p>Add a contact to your protected circle for one-click calling and status tracking.</p>

          <form onSubmit={addMember}>
            <div className="form-group">
              <label htmlFor="member-name">Full Name</label>
              <input
                id="member-name"
                required
                maxLength={40}
                placeholder="e.g. Ammi, Tariq, Zainab"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label htmlFor="member-relation">Relationship</label>
              <input
                id="member-relation"
                required
                maxLength={30}
                placeholder="e.g. Mother, Brother, Friend"
                value={relation}
                onChange={e => setRelation(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="member-lang">Preferred Spoken Language</label>
              <select
                id="member-lang"
                value={memberLang}
                onChange={e => setMemberLang(e.target.value)}
              >
                <option value="Urdu">Urdu / اردو</option>
                <option value="English">English</option>
              </select>
            </div>

            <button
              className="guardian-primary full-width"
              type="submit"
              disabled={!name.trim() || !relation.trim()}
              style={{ marginTop: "16px" }}
            >
              <Plus size={16} /> Save to Family Circle
            </button>
          </form>
        </div>
      </dialog>
    </main>
  );
}
