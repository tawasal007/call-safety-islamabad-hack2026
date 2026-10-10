import { AlertTriangle, ShieldAlert } from "lucide-react";
import { CATEGORY_LABELS, concernRank, type Warning } from "@/lib/detector/types";
import { highlightParts } from "@/lib/highlight";

export function HighlightedText({ text, quotes }: { text: string; quotes: string[] }) {
  return <>{highlightParts(text, quotes).map((part, index) => part.highlighted ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</>;
}

export function sortWarnings(warnings: Warning[]): Warning[] {
  return [...warnings].sort((a, b) => concernRank(b.concernLevel) - concernRank(a.concernLevel) || b.updatedAt.localeCompare(a.updatedAt));
}

export function ConcernBadge({ level }: { level: Warning["concernLevel"] }) {
  return <span className={`concern-badge is-${level}`}>{level === "none" ? "No" : level[0].toUpperCase() + level.slice(1)} concern</span>;
}

/** One evidence-based warning. Shared by the live receiver panel and Call Logs. */
export function WarningCard({ warning }: { warning: Warning }) {
  const Icon = warning.concernLevel === "high" ? ShieldAlert : AlertTriangle;
  return (
    <article className={`warning-card is-${warning.concernLevel}`} aria-label={`${warning.title}, ${warning.concernLevel} concern`}>
      <header className="warning-card-head">
        <Icon size={18} aria-hidden="true" />
        <strong>{warning.title}</strong>
        <ConcernBadge level={warning.concernLevel} />
      </header>
      <ul className="warning-tags" aria-label="Detected categories">
        {warning.categories.map((category) => <li key={category}>{CATEGORY_LABELS[category]}</li>)}
      </ul>
      <div className="warning-evidence">
        <span>Exact words</span>
        {warning.evidence.map((item) => <blockquote key={`${item.segmentId}-${item.quote}`}><mark>{item.quote}</mark></blockquote>)}
      </div>
      <p className="warning-explanation">{warning.explanation}</p>
      <p className="warning-action"><strong>What to do</strong>{warning.suggestedAction}</p>
      <p className="warning-uncertainty">{warning.uncertainty} Automated detection can be wrong.</p>
    </article>
  );
}