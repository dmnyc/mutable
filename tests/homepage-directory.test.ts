// The tool directory lists new tools first within each section
// ("No login" and "Connect to use"). Retiring or adding a NEW badge changes
// which cards qualify, so the order has to be kept in step by hand; this
// fails when a NEW card sits below a non-NEW one.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.resolve(__dirname, "../components/ToolDirectory.tsx"),
  "utf8",
);

interface Card {
  title: string;
  isNew: boolean;
}

function sectionCards(from: string, to: string): Card[] {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error(`Directory markers not found: ${from}`);
  return source
    .slice(start, end)
    .split("<DirectoryCard")
    .slice(1)
    .map((chunk) => ({
      title: /\btitle="([^"]+)"/.exec(chunk)?.[1] ?? "(untitled)",
      isNew: chunk.includes('badge="NEW"'),
    }));
}

const SECTIONS: Record<string, [string, string]> = {
  "No login": ["const noLogin = (", "const account = ("],
  "Connect to use": ["const account = (", "const label = ("],
};

describe("homepage directory", () => {
  for (const [name, [from, to]] of Object.entries(SECTIONS)) {
    it(`lists NEW cards first in “${name}”`, () => {
      const cards = sectionCards(from, to);
      expect(cards.length).toBeGreaterThan(0);
      const firstOld = cards.findIndex((c) => !c.isNew);
      const lateNew = cards
        .slice(firstOld < 0 ? cards.length : firstOld)
        .filter((c) => c.isNew)
        .map((c) => c.title);
      expect(
        lateNew,
        `These NEW cards sit below a card without a NEW badge in “${name}”. ` +
          "Move them to the top of the section, or retire their badge.",
      ).toEqual([]);
    });
  }
});
