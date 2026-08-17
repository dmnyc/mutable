/**
 * Shared scoring helpers for Mute-o-Scope.
 *
 * Kept in one place so the results view, the share modal, and the explainer
 * modal can never drift apart on thresholds or labels.
 */

export interface ScoreLevel {
  emoji: string;
  label: string;
}

/** How many public mute lists include this user. */
export function getMuteScore(count: number): ScoreLevel {
  if (count === 0) return { emoji: "⬜", label: "Pristine" };
  if (count <= 25) return { emoji: "🟦", label: "Low" };
  if (count <= 50) return { emoji: "🟩", label: "Average" };
  if (count <= 75) return { emoji: "🟨", label: "Moderate" };
  if (count <= 100) return { emoji: "🟧", label: "High" };
  if (count <= 200) return { emoji: "🟥", label: "Severe" };
  if (count <= 300) return { emoji: "🟪", label: "Legendary" };
  if (count <= 400) return { emoji: "🟫", label: "Shitlisted" };
  return { emoji: "⬛", label: "Blacklisted" };
}

/**
 * Mutes per 1,000 notes. Normalizes the raw score against how much someone
 * actually posts, so a prolific poster isn't penalized for volume alone —
 * and someone muted heavily despite posting little stands out.
 *
 * Raw mutes-per-note is an unreadable decimal, hence the per-1k scale.
 */
export const MUTE_RATIO_SCALE = 1000;

export interface MuteRatioSignal extends ScoreLevel {
  perThousand: number;
}

export function getMuteRatioSignal(
  mutes: number,
  notes: number,
): MuteRatioSignal {
  const perThousand = notes > 0 ? (mutes / notes) * MUTE_RATIO_SCALE : 0;
  if (perThousand === 0) return { emoji: "⬜", label: "No signal", perThousand };
  if (perThousand < 1) return { emoji: "🟦", label: "Negligible", perThousand };
  if (perThousand < 5) return { emoji: "🟩", label: "Low", perThousand };
  if (perThousand < 20) return { emoji: "🟨", label: "Notable", perThousand };
  if (perThousand < 50) return { emoji: "🟧", label: "Elevated", perThousand };
  if (perThousand < 150) return { emoji: "🟥", label: "High", perThousand };
  return { emoji: "⬛", label: "Extreme", perThousand };
}

/** Keep small ratios legible without printing misleading precision. */
export function formatPerThousand(value: number): string {
  if (value === 0) return "0";
  if (value < 0.1) return value.toFixed(2);
  if (value < 10) return value.toFixed(1);
  return Math.round(value).toString();
}
