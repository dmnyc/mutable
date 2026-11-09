// One-off live probe for Mute-o-Scope's unblock verification — run
// manually, not part of CI:
//   PROBE=1 npx vitest run tests/muteoscope-live-probe.test.ts
// Writes findings to /tmp/muteoscope-probe.json (vitest swallows console.log).
// Skipped unless PROBE is set, so `npm test` stays offline and fast.
import { test, expect } from "vitest";
import { SimplePool } from "nostr-tools";
import * as fs from "fs";
import {
  searchMutealsNetworkWide,
  getMuteScanRelayList,
  DEFAULT_RELAYS,
} from "@/lib/nostr";

// The pubkey from the user-reported complaint that motivated the
// verification pass: 7 of their 51 reported blockers had actually unblocked.
const HEX_PUBKEY =
  "b3f585f3e038f1dccdfaf2d7a1449a418605c392cd33ba7f137bca24842f5f90";

test.skipIf(!process.env.PROBE)(
  "mute-o-scope unblock verification live probe",
  { timeout: 180_000 },
  async () => {
    const hex = HEX_PUBKEY;
    const scanRelays = getMuteScanRelayList(DEFAULT_RELAYS);

    const results = await searchMutealsNetworkWide(hex, scanRelays);

    // Independently re-check every reported blocker's newest kind:10000.
    // The scan's own verification guarantees these all still list the
    // pubkey, so any exception here means the pass is broken.
    const pool = new SimplePool();
    const authors = results.map((r) => r.mutedBy);
    const latest = new Map<string, number>(); // author -> newest created_at
    const latestMutes = new Set<string>(); // "author" entries that still mute
    for (let i = 0; i < authors.length; i += 100) {
      const batch = authors.slice(i, i + 100);
      const events = await pool.querySync(scanRelays, {
        kinds: [10000],
        authors: batch,
      });
      for (const ev of events) {
        const cur = latest.get(ev.pubkey);
        if (cur === undefined || ev.created_at >= cur) {
          latest.set(ev.pubkey, ev.created_at);
          if (ev.tags.some((t) => t[0] === "p" && t[1] === hex)) {
            latestMutes.add(ev.pubkey);
          } else {
            latestMutes.delete(ev.pubkey);
          }
        }
      }
    }
    pool.close(scanRelays);

    const stale = authors.filter((a) => latest.has(a) && !latestMutes.has(a));
    const findings = {
      pubkey: HEX_PUBKEY,
      reportedBlockers: results.length,
      independentlyConfirmed: latestMutes.size,
      staleButStillReported: stale,
    };
    fs.writeFileSync(
      "/tmp/muteoscope-probe.json",
      JSON.stringify(findings, null, 2),
    );

    expect(results.length).toBeGreaterThan(0);
    expect(stale).toEqual([]);
  },
);
