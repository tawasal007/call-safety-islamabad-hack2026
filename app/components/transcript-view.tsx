"use client";
import { useState } from "react";
import type { CaptionSegment } from "@/lib/transcription";

export function timestamp(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function EvidenceText({ segment, language = "en", text = segment.english }: { segment: CaptionSegment; language?: "en" | "ur"; text?: string }) {
  const quotes = [...new Set(segment.matches.filter(m => (m.evidenceLanguage || "en") === language).map(m => m.evidence))].sort((a, b) => b.length - a.length);
  if (!quotes.length) return <>{text}</>;
  const escaped = quotes.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "g"));
  return <>{parts.map((p, i) => quotes.includes(p) ? <mark key={i}>{p}</mark> : p)}</>;
}

export function TranscriptView({ segments, live = false }: { segments: CaptionSegment[]; live?: boolean }) {
  const [language, setLanguage] = useState("both");
  return <div className="transcript-view">
    <div className="transcript-toolbar"><label>Captions <select value={language} onChange={e => setLanguage(e.target.value)}>
      <option value="both">English + Urdu</option><option value="english">English</option><option value="urdu">Urdu</option><option value="original">Original speech</option>
    </select></label><span>{segments.filter(s => s.final).length} finalized segments</span></div>
    <div className="transcript-list" role="log" aria-label="Call captions" aria-live={live ? "polite" : "off"} aria-relevant="additions text">
      {!segments.length && <p className="transcript-empty">{live ? "Captions will appear here when someone speaks. Both microphones are transcribed separately." : "No finalized speech was saved for this call."}</p>}
      {segments.map(segment => <article key={segment.segmentId} className={`transcript-segment${segment.final ? "" : " is-interim"}`}>
        <div className="segment-meta"><strong>{segment.speaker === "caller" ? "Caller" : "Receiver"}</strong><time>{timestamp(segment.startMs)}</time><span>{segment.language.toUpperCase()}</span><span>{segment.final ? "Final" : "Provisional…"}</span></div>
        {(language === "both" || language === "english") && (segment.english ? <p lang="en"><EvidenceText segment={segment} /></p> : <p className="translation-note">{segment.translationStatus === "unavailable" ? "English translation unavailable for this segment" : segment.final ? "Translating to English…" : "English translation follows finalized speech"}</p>)}
        {(language === "both" || language === "urdu") && (segment.urdu ? <p lang="ur" dir="rtl" className="urdu-caption"><EvidenceText segment={segment} language="ur" text={segment.urdu} /></p> : <p className="translation-note">{segment.translationStatus === "unavailable" ? "Urdu translation unavailable for this segment" : segment.final ? "Translating to Urdu…" : "Urdu translation follows finalized speech"}</p>)}
        {language === "original" && <p lang={segment.language} dir={["ur", "ar", "fa"].includes(segment.language) ? "rtl" : "auto"}>{segment.original}</p>}
        {language === "both" && !["en", "ur"].includes(segment.language) && <p className="source-caption" dir="auto">Original: {segment.original}</p>}
        {segment.matches.length > 0 && <div className="keyword-tags">{[...new Set(segment.matches.map(m => m.category))].map(c => <span key={c}>{c.replaceAll("_", " ")}</span>)}</div>}
      </article>)}
    </div>
  </div>;
}
