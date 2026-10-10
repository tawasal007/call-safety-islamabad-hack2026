"use client";

import { ArrowRight, FileText, Headphones, Link2, Mic, Phone, Shield, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ThemeToggle } from "./components/theme-toggle";
import type { CallLanguage } from "@/lib/sessions";

type CreateRoomResponse = {
  roomId: string;
  callerAccessKey: string;
  inviteUrl: string;
  error?: string;
};

export default function HomePage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [invitation, setInvitation] = useState("");
  const [createError, setCreateError] = useState("");
  const [joinError, setJoinError] = useState("");
  const [language, setLanguage] = useState<CallLanguage>("en");

  async function createCall() {
    setCreating(true);
    setCreateError("");
    try {
      const response = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language }) });
      const data = (await response.json()) as CreateRoomResponse;
      if (!response.ok) throw new Error(data.error || "Could not create a room.");
      sessionStorage.setItem(["caller-access", data.roomId].join(":"), data.callerAccessKey);
      sessionStorage.setItem(["receiver-invite", data.roomId].join(":"), data.inviteUrl);
      router.push("/call/" + encodeURIComponent(data.roomId));
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "Could not create a room.");
      setCreating(false);
    }
  }

  function openInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setJoinError("");
    try {
      const url = new URL(invitation.trim());
      const accessKey = url.searchParams.get("invite");
      if (url.origin !== window.location.origin ||
          !/^\/call\/call-[0-9a-f-]{36}$/i.test(url.pathname) ||
          !accessKey || accessKey.length > 2048) {
        throw new Error("Paste a receiver invitation from this app, including the full link.");
      }
      router.push(url.pathname + "?invite=" + encodeURIComponent(accessKey));
    } catch (cause) {
      setJoinError(cause instanceof Error && cause.message.startsWith("Paste") ? cause.message : "Enter a valid invitation link.");
    }
  }

  return (
    <main className="app-home">
      <header className="call-topbar">
        <a href="/" className="wordmark"><span className="wordmark-mark"><Shield size={18} /></span><span>Call Safety</span></a>
        <div className="header-tools"><Link href="/call-logs" className="header-link"><FileText size={15} />Call Logs</Link><ThemeToggle /></div>
      </header>

      <section className="home-workspace" aria-labelledby="home-heading">
        <div className="workspace-title">
          <p className="prejoin-eyebrow">HOME</p>
          <h1 id="home-heading">Calls</h1>
          <p>Start a room or join someone with their invitation.</p>
        </div>

        <div className="home-room-actions">
          <section className="home-action-card create-room-card" aria-labelledby="create-heading">
            <span className="home-action-icon"><Phone size={23} /></span>
            <h2 id="create-heading">New room</h2>
            <p>Invite one other person to an audio call.</p>
            <label className="language-choice" htmlFor="call-language">Speech language
              <select id="call-language" value={language} onChange={(event) => setLanguage(event.target.value as CallLanguage)} disabled={creating}>
                <option value="en">English</option><option value="ur">Urdu → English</option><option value="pa">Punjabi → English</option>
              </select>
            </label>
            <p className="language-help">Both speakers use this language setting. Translations appear after each speaking turn.</p>
            <div className="room-capacity"><Users size={16} />2 people <span>·</span><Mic size={15} />Audio only</div>
            <button className="join-button" onClick={createCall} disabled={creating}><Phone size={17} />{creating ? "Creating room…" : "Create room"}</button>
            {createError && <p className="inline-error" role="alert">{createError}</p>}
          </section>

          <section className="home-action-card" aria-labelledby="join-heading">
            <span className="home-action-icon"><Link2 size={23} /></span>
            <h2 id="join-heading">Join a room</h2>
            <p>Paste the invitation shared by the caller.</p>
            <form onSubmit={openInvitation} className="join-invitation-form">
              <label htmlFor="invitation">Invitation link</label>
              <input id="invitation" type="text" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://…/call/…?invite=…" value={invitation} onChange={(event) => { setInvitation(event.target.value); setJoinError(""); }} aria-invalid={!!joinError} aria-describedby={joinError ? "join-error" : undefined} />
              <button className="secondary-button" type="submit" disabled={creating || !invitation.trim()}>Open room<ArrowRight size={16} /></button>
              {joinError && <p id="join-error" className="inline-error" role="alert">{joinError}</p>}
            </form>
          </section>
        </div>
        <p className="home-device-note"><Headphones size={16} />Use headphones when testing on nearby devices.</p>
      </section>
      <footer className="app-status-footer"><Shield size={14} /><span>Calls can be transcribed and saved when the transcription worker is running</span></footer>
    </main>
  );
}
