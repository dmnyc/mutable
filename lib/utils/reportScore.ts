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

/**
 * Content signatures of self-declared bots, e.g. "Automated NSFW Detection
 * Report". The reporter labels itself, so this is evidence rather than a
 * heuristic guess.
 */
const AUTOMATED_CONTENT_PATTERN = /\bautomated\b[\s\S]*\breport\b/i;

export function isAutomatedContent(content?: string): boolean {
  if (!content) return false;
  return AUTOMATED_CONTENT_PATTERN.test(content);
}

/** Fewest distinct same-type empty-content reporters inside the window that reads as a swarm. */
export const AUTOMATED_BURST_MIN = 5;
/** Window length in seconds — report timestamps are unix seconds. */
export const AUTOMATED_BURST_WINDOW_SECONDS = 72 * 60 * 60;

/** The report fields the swarm detector needs — ReportResult satisfies this. */
export interface ReportLike {
  eventId: string;
  reportedBy: string;
  reportType?: string;
  content?: string;
  reportedAt: number;
}

/**
 * Event IDs belonging to a coordinated swarm: at least AUTOMATED_BURST_MIN
 * distinct reporters filing same-type, empty-content reports inside the
 * window. Unique-reporter scoring already neutralizes one account filing
 * many reports; this catches the inverse — many accounts each filing one.
 */
export function findSwarmReportIds(reports: ReportLike[]): Set<string> {
  const byType = new Map<string, ReportLike[]>();
  for (const report of reports) {
    if ((report.content ?? "").trim()) continue;
    const key = (report.reportType || "other").toLowerCase();
    const list = byType.get(key);
    if (list) list.push(report);
    else byType.set(key, [report]);
  }

  const flagged = new Set<string>();
  for (const list of byType.values()) {
    const sorted = [...list].sort((a, b) => a.reportedAt - b.reportedAt);
    for (let start = 0; start < sorted.length; start++) {
      const inWindow: ReportLike[] = [];
      for (
        let end = start;
        end < sorted.length &&
        sorted[end].reportedAt - sorted[start].reportedAt <=
          AUTOMATED_BURST_WINDOW_SECONDS;
        end++
      ) {
        inWindow.push(sorted[end]);
      }
      if (
        new Set(inWindow.map((report) => report.reportedBy)).size >=
        AUTOMATED_BURST_MIN
      ) {
        for (const report of inWindow) flagged.add(report.eventId);
      }
    }
  }
  return flagged;
}

/**
 * Received reports judged automated: self-declared bots plus swarm members.
 * They stay readable behind a toggle but never count toward the Report
 * Score — automation is not independent human judgment.
 */
export function findAutomatedReportIds(reports: ReportLike[]): Set<string> {
  const ids = new Set<string>();
  for (const report of reports) {
    if (isAutomatedContent(report.content)) ids.add(report.eventId);
  }
  for (const id of findSwarmReportIds(reports)) ids.add(id);
  return ids;
}
