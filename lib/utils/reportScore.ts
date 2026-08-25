/**
 * Shared scoring helpers for Reportable.
 *
 * Kept in one place so the results view, the share modal, and the explainer
 * modal can never drift apart on thresholds or labels.
 */

export interface ReportScoreLevel {
  emoji: string;
  label: string;
  /** Display-only range of unique reporters, e.g. "1-2" or "76+". */
  range: string;
  /** Inclusive upper bound of unique reporters for this level. */
  max: number;
}

/**
 * The full ladder, low to high. Deadpan at the bottom — a couple of reports
 * is a weak signal, so the low tiers stay clinical — then the language
 * escalates with the count, Mute-o-Scope style.
 */
export const REPORT_SCORE_LEVELS: ReportScoreLevel[] = [
  { emoji: "⬜", label: "Clean", range: "0", max: 0 },
  { emoji: "🟦", label: "Flagged", range: "1-2", max: 2 },
  { emoji: "🟩", label: "Avoidable", range: "3-5", max: 5 },
  { emoji: "🟨", label: "Alarming", range: "6-10", max: 10 },
  { emoji: "🟧", label: "Detestable", range: "11-20", max: 20 },
  { emoji: "🟥", label: "Despicable", range: "21-40", max: 40 },
  { emoji: "🟪", label: "Deplorable", range: "41-75", max: 75 },
  { emoji: "⬛", label: "Irredeemable", range: "76+", max: Infinity },
];

/**
 * Report Score from the number of unique reporters. Scored on unique
 * reporters (not raw report events) so one account filing fifty reports
 * can't inflate a target past what independent accounts are saying.
 */
export function getReportScore(uniqueReporters: number): ReportScoreLevel {
  for (const level of REPORT_SCORE_LEVELS) {
    if (uniqueReporters <= level.max) return level;
  }
  return REPORT_SCORE_LEVELS[REPORT_SCORE_LEVELS.length - 1];
}

/**
 * Thresholds above which a reporter in the live feed is treated as
 * automated. Bulk reporters (anti-spam bots and the like) bury every human
 * report in the feed, so entries from accounts at or past either threshold
 * are collapsed behind a toggle.
 */
export const AUTOMATED_REPORTER_ABSOLUTE = 10;
export const AUTOMATED_REPORTER_SHARE = 0.2;
/** Feeds smaller than this never trip the share rule — noise outweighs signal. */
export const AUTOMATED_REPORTER_MIN_FEED = 20;

export function isAutomatedReporter(
  reportCount: number,
  feedSize: number,
): boolean {
  if (reportCount >= AUTOMATED_REPORTER_ABSOLUTE) return true;
  if (feedSize >= AUTOMATED_REPORTER_MIN_FEED) {
    return reportCount / feedSize >= AUTOMATED_REPORTER_SHARE;
  }
  return false;
}
