/**
 * Shared scoring helpers for Reportable.
 *
 * Kept in one place so the results view, the share modal, and the explainer
 * modal can never drift apart on thresholds or labels.
 */

export interface ReportScoreLevel {
  emoji: string;
  label: string;
}

/**
 * Report Score from the number of unique reporters. Scored on unique
 * reporters (not raw report events) so one account filing fifty reports
 * can't inflate a target past what independent accounts are saying.
 */
export function getReportScore(uniqueReporters: number): ReportScoreLevel {
  if (uniqueReporters === 0) return { emoji: "⬜", label: "Clean" };
  if (uniqueReporters <= 2) return { emoji: "🟦", label: "Flagged" };
  if (uniqueReporters <= 5) return { emoji: "🟩", label: "Noted" };
  if (uniqueReporters <= 10) return { emoji: "🟨", label: "Concerning" };
  if (uniqueReporters <= 20) return { emoji: "🟧", label: "Risky" };
  if (uniqueReporters <= 40) return { emoji: "🟥", label: "Dangerous" };
  if (uniqueReporters <= 75) return { emoji: "🟪", label: "Severe" };
  return { emoji: "⬛", label: "Critical" };
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
