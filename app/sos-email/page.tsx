"use client";

import { CheckCircle2, MailWarning, Send, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { getSavedCalls, type SavedCall } from "@/lib/call-log-client";
import type { CallDetail } from "@/lib/monitoring/call-record";
import { riskScore } from "@/lib/detector/risk-score";

const CHILD = { name: "Ayesha Khan", age: 14, guardian: "parent@example.com" };
const storageKey = "call-safety-demo-sos-email";

function makeEmail(call: SavedCall, detail: CallDetail) {
  const warning = detail.warnings[0];
  const evidence = warning?.evidence.map((item) => `“${item.quote}”`).join(" · ") || "No quoted evidence available.";
  return {
    subject: `SOS: ${CHILD.name} may need help during a call`,
    body: `This is a SadaSafe demo SOS notification.\n\nChild account: ${CHILD.name}, age ${CHILD.age}\nCall reference: ${call.roomId}\nThreat threshold: ${riskScore(detail.warnings)}/100\nDetected concern: ${warning?.title || "Suspicious call"}\nEvidence: ${evidence}\n\nPlease contact ${CHILD.name} through a separate trusted channel and check their safety. This is an automated warning and must be verified.`,
  };
}

export default function SosEmailPage() {
  const [call, setCall] = useState<SavedCall | null>(null);
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const latest = getSavedCalls()[0] ?? null;
    setCall(latest);
    if (!latest) { setLoading(false); return; }
    fetch(`/api/calls/${encodeURIComponent(latest.roomId)}`, { headers: { Authorization: `Bearer ${latest.archiveAccessKey}` }, cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<CallDetail> : null)
      .then((data) => { setDetail(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const email = call && detail ? makeEmail(call, detail) : null;
  function sendDemoSos() {
    if (!email) return;
    localStorage.setItem(storageKey, JSON.stringify({ at: new Date().toISOString(), roomId: call?.roomId, email }));
    setSent(true);
  }

  return <main className="app-home"><section className="logs-workspace sos-workspace">
    <div className="workspace-title"><p className="prejoin-eyebrow">CHILD ACCOUNT DEMO</p><h1>SOS email</h1><p>Send a guardian an SOS notification using the latest saved call log.</p></div>
    <section className="sos-card">
      <div className="sos-card-heading"><span><ShieldAlert size={24} /></span><div><p>Protected child account</p><h2>{CHILD.name} <small>Age {CHILD.age}</small></h2><strong>Guardian: {CHILD.guardian}</strong></div></div>
      {loading ? <p className="logs-empty">Preparing the latest call alert…</p> : !email ? <p className="inline-error">No saved call log is available. Join a call first, then return here to create the demo SOS email.</p> : <>
        <div className="sos-email-preview"><div><span>To</span><strong>{CHILD.guardian}</strong></div><div><span>Subject</span><strong>{email.subject}</strong></div><pre>{email.body}</pre></div>
        <button className="join-button sos-send" onClick={sendDemoSos} disabled={sent}>{sent ? <><CheckCircle2 size={18} />SOS email marked sent</> : <><Send size={18} />Send SOS email</>}</button>
        <p className="sos-note"><MailWarning size={15} />Demo mode: this records a simulated delivery in this browser. Connect an email provider before using it for a real emergency.</p>
      </>}
    </section>
  </section></main>;
}
