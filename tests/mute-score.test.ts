import { describe, it, expect } from "vitest";
import {
  getMuteScore,
  getMuteRatioSignal,
  formatPerThousand,
} from "@/lib/utils/muteScore";

describe("getMuteScore", () => {
  it("treats zero mutes as pristine", () => {
    expect(getMuteScore(0).label).toBe("Pristine");
  });

  it("assigns the documented bands", () => {
    expect(getMuteScore(1).label).toBe("Low");
    expect(getMuteScore(25).label).toBe("Low");
    expect(getMuteScore(26).label).toBe("Average");
    expect(getMuteScore(50).label).toBe("Average");
    expect(getMuteScore(75).label).toBe("Moderate");
    expect(getMuteScore(100).label).toBe("High");
    expect(getMuteScore(200).label).toBe("Severe");
    expect(getMuteScore(300).label).toBe("Legendary");
    expect(getMuteScore(400).label).toBe("Shitlisted");
    expect(getMuteScore(401).label).toBe("Blacklisted");
    expect(getMuteScore(99999).label).toBe("Blacklisted");
  });
});

describe("getMuteRatioSignal", () => {
  it("returns no signal when there are no mutes", () => {
    const r = getMuteRatioSignal(0, 1000);
    expect(r.label).toBe("No signal");
    expect(r.perThousand).toBe(0);
  });

  it("avoids dividing by zero when the note count is unknown", () => {
    const r = getMuteRatioSignal(50, 0);
    expect(r.perThousand).toBe(0);
    expect(r.label).toBe("No signal");
  });

  it("scales to mutes per 1,000 notes", () => {
    expect(getMuteRatioSignal(10, 1000).perThousand).toBe(10);
    expect(getMuteRatioSignal(10, 2000).perThousand).toBe(5);
    expect(getMuteRatioSignal(1, 10000).perThousand).toBe(0.1);
  });

  it("assigns the documented bands", () => {
    expect(getMuteRatioSignal(0.5, 1000).label).toBe("Negligible");
    expect(getMuteRatioSignal(3, 1000).label).toBe("Low");
    expect(getMuteRatioSignal(10, 1000).label).toBe("Notable");
    expect(getMuteRatioSignal(30, 1000).label).toBe("Elevated");
    expect(getMuteRatioSignal(100, 1000).label).toBe("High");
    expect(getMuteRatioSignal(200, 1000).label).toBe("Extreme");
  });

  it("is the point of the metric: low volume with mutes outranks high volume", () => {
    // 5 mutes over 50 notes is a far stronger signal than 5 over 50,000,
    // even though the raw Mute Score is identical.
    const noisy = getMuteRatioSignal(5, 50);
    const prolific = getMuteRatioSignal(5, 50000);
    expect(noisy.perThousand).toBeGreaterThan(prolific.perThousand);
    expect(noisy.label).toBe("High");
    expect(prolific.label).toBe("Negligible");
    expect(getMuteScore(5).label).toBe(getMuteScore(5).label); // same raw score
  });
});

describe("formatPerThousand", () => {
  it("prints zero plainly", () => {
    expect(formatPerThousand(0)).toBe("0");
  });

  it("keeps precision for very small ratios", () => {
    expect(formatPerThousand(0.02)).toBe("0.02");
  });

  it("uses one decimal below ten", () => {
    expect(formatPerThousand(3.14)).toBe("3.1");
  });

  it("rounds to whole numbers at ten and above", () => {
    expect(formatPerThousand(10)).toBe("10");
    expect(formatPerThousand(60.4)).toBe("60");
    expect(formatPerThousand(149.6)).toBe("150");
  });
});
