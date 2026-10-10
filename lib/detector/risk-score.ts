import type { Warning } from "./types.ts";

/** A transparent urgency indicator, not a probability that the caller is guilty. */
export function riskScore(warnings: Pick<Warning, "concernLevel" | "categories">[]): number {
  return warnings.reduce((highest, warning) => {
    const base = { none: 0, low: 20, medium: 60, high: 85 }[warning.concernLevel];
    if (base === 0) return highest;
    const severeThreat = warning.categories.includes("threat_of_harm") || warning.categories.includes("kidnapping_claim");
    const score = severeThreat && warning.concernLevel === "high" ? 95
      : warning.categories.includes("extortion") && warning.concernLevel === "high" ? 90
      : base;
    return Math.max(highest, score);
  }, 0);
}

export function riskLabel(score: number): string {
  return score >= 85 ? "High concern" : score >= 60 ? "Possible scam or threat" : score > 0 ? "Review the call" : "No warning yet";
}
