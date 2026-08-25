import { describe, it, expect } from "vitest";
import {
  getReportScore,
  isAutomatedReporter,
  AUTOMATED_REPORTER_ABSOLUTE,
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
