import { describe, it, expect } from "vitest";
import {
  getReportScore,
  isAutomatedReporter,
  isAutomatedContent,
  findSwarmReportIds,
  findAutomatedReportIds,
  AUTOMATED_REPORTER_ABSOLUTE,
  AUTOMATED_BURST_MIN,
} from "@/lib/utils/reportScore";

describe("getReportScore", () => {
  it("treats zero reporters as clean", () => {
    expect(getReportScore(0).label).toBe("Clean");
    expect(getReportScore(0).emoji).toBe("⬜");
  });

  it("assigns the documented bands", () => {
    expect(getReportScore(1).label).toBe("Flagged");
    expect(getReportScore(2).label).toBe("Flagged");
    expect(getReportScore(3).label).toBe("Avoidable");
    expect(getReportScore(5).label).toBe("Avoidable");
    expect(getReportScore(6).label).toBe("Alarming");
    expect(getReportScore(10).label).toBe("Alarming");
    expect(getReportScore(11).label).toBe("Detestable");
    expect(getReportScore(20).label).toBe("Detestable");
    expect(getReportScore(21).label).toBe("Despicable");
    expect(getReportScore(40).label).toBe("Despicable");
    expect(getReportScore(41).label).toBe("Deplorable");
    expect(getReportScore(75).label).toBe("Deplorable");
    expect(getReportScore(76).label).toBe("Irredeemable");
    expect(getReportScore(99999).label).toBe("Irredeemable");
  });

  it("uses unique reporters, so heavy single reporters cannot inflate it", () => {
    // One account filing 50 reports is still one reporter: Flagged.
    expect(getReportScore(1).label).toBe("Flagged");
  });
});

describe("isAutomatedReporter", () => {
  it("trips on the absolute threshold regardless of feed size", () => {
    expect(isAutomatedReporter(AUTOMATED_REPORTER_ABSOLUTE, 100)).toBe(true);
    expect(isAutomatedReporter(AUTOMATED_REPORTER_ABSOLUTE, 5)).toBe(true);
  });

  it("stays under the absolute threshold for small counts", () => {
    expect(isAutomatedReporter(AUTOMATED_REPORTER_ABSOLUTE - 1, 100)).toBe(
      false,
    );
  });

  it("trips on the share rule once the feed is large enough", () => {
    // Counts must stay under the absolute threshold so only the share rule
    // is exercised: 20% of 25 = 5.
    expect(isAutomatedReporter(5, 25)).toBe(true);
    expect(isAutomatedReporter(4, 25)).toBe(false);
  });

  it("never trips the share rule on small feeds", () => {
    // 3 of 5 entries is 60% of the feed, but the feed is too small for a
    // share to mean anything.
    expect(isAutomatedReporter(3, 5)).toBe(false);
    expect(isAutomatedReporter(9, 19)).toBe(false);
  });
});

describe("isAutomatedContent", () => {
  it("matches self-declared bot reports", () => {
    expect(
      isAutomatedContent(
        "Automated NSFW Detection Report\n\nScore: 7/10\nClassification: nudity",
      ),
    ).toBe(true);
  });

  it("leaves human-written reports alone", () => {
    expect(isAutomatedContent("This account keeps spamming my replies")).toBe(
      false,
    );
    expect(isAutomatedContent("")).toBe(false);
    expect(isAutomatedContent(undefined)).toBe(false);
  });
});

describe("findSwarmReportIds", () => {
  const HOUR = 60 * 60;
  const swarmReport = (n: number, at: number, type = "impersonation") => ({
    eventId: `e${n}`,
    reportedBy: `pk${n}`,
    reportType: type,
    content: "",
    reportedAt: at,
  });

  it("flags a burst of same-type empty reports from distinct reporters", () => {
    const reports = Array.from({ length: AUTOMATED_BURST_MIN }, (_, i) =>
      swarmReport(i, 1_000_000 + i * HOUR),
    );
    expect(findSwarmReportIds(reports).size).toBe(AUTOMATED_BURST_MIN);
  });

  it("ignores a handful of empty reports", () => {
    const reports = Array.from({ length: AUTOMATED_BURST_MIN - 1 }, (_, i) =>
      swarmReport(i, 1_000_000 + i * HOUR),
    );
    expect(findSwarmReportIds(reports).size).toBe(0);
  });

  it("ignores one account filing many reports — unique scoring already handles that", () => {
    const reports = Array.from({ length: 20 }, (_, i) => ({
      ...swarmReport(i, 1_000_000 + i * HOUR),
      reportedBy: "same-pk",
    }));
    expect(findSwarmReportIds(reports).size).toBe(0);
  });

  it("ignores bursts spread wider than the window", () => {
    const reports = Array.from({ length: AUTOMATED_BURST_MIN }, (_, i) =>
      swarmReport(i, 1_000_000 + i * 100 * HOUR),
    );
    expect(findSwarmReportIds(reports).size).toBe(0);
  });

  it("does not mix report types or written reports into a swarm", () => {
    const reports = [
      ...Array.from({ length: 3 }, (_, i) => swarmReport(i, 1_000_000)),
      ...Array.from({ length: 3 }, (_, i) => swarmReport(100 + i, 1_000_000, "spam")),
    ];
    expect(findSwarmReportIds(reports).size).toBe(0);
  });
});

describe("findAutomatedReportIds", () => {
  it("unites bot-signed reports and swarm members", () => {
    const HOUR = 60 * 60;
    const bot = {
      eventId: "bot-event",
      reportedBy: "bot-pk",
      reportType: "nudity",
      content: "Automated NSFW Detection Report\nScore: 4/10",
      reportedAt: 2_000_000,
    };
    const swarm = Array.from({ length: 6 }, (_, i) => ({
      eventId: `swarm${i}`,
      reportedBy: `pk${i}`,
      reportType: "impersonation",
      content: "",
      reportedAt: 1_000_000 + i * HOUR,
    }));
    const human = {
      eventId: "human-event",
      reportedBy: "human-pk",
      reportType: "spam",
      content: "kept posting scam links",
      reportedAt: 1_500_000,
    };

    const ids = findAutomatedReportIds([bot, human, ...swarm]);
    expect(ids.size).toBe(7);
    expect(ids.has("human-event")).toBe(false);
  });
});
