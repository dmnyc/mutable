// One-off live probe for Reportable — run manually, not part of CI:
//   PROBE=1 npx vitest run tests/reportable-live-probe.test.ts
// Writes findings to /tmp/reportable-probe.json (vitest swallows console.log).
// Skipped unless PROBE is set, so `npm test` stays offline and fast.
import { test } from "vitest";
import { nip19 } from "nostr-tools";
import * as fs from "fs";
import {
  searchReportsNetworkWide,
  searchReportsFiledBy,
  fetchProfile,
  DEFAULT_RELAYS,
} from "@/lib/nostr";

const NPUB =
  "npub1az9xj85cmxv8e9j9y80lvqp97crsqdu2fpu3srwthd99qfu9qsgstam8y8";

test.skipIf(!process.env.PROBE)(
  "reportable live probe",
  async () => {
    const hex = nip19.decode(NPUB).data as string;

    const profile = await fetchProfile(hex, DEFAULT_RELAYS);

    const received = await searchReportsNetworkWide(hex, DEFAULT_RELAYS);
    const uniqueReporters = new Set(received.map((r) => r.reportedBy)).size;
    const byType: Record<string, number> = {};
    for (const r of received) {
      const k = (r.reportType || "other").toLowerCase();
      byType[k] = (byType[k] || 0) + 1;
    }

    const filed = await searchReportsFiledBy(hex, DEFAULT_RELAYS);
    const uniqueTargets = new Set(filed.flatMap((f) => f.reportedPubkeys)).size;
    const fTypes: Record<string, number> = {};
    for (const f of filed) {
      const k = (f.reportType || "other").toLowerCase();
      fTypes[k] = (fTypes[k] || 0) + 1;
    }

    fs.writeFileSync(
      "/tmp/reportable-probe.json",
      JSON.stringify(
        {
          npub: NPUB,
          hex,
          profile: profile
            ? {
                display_name: profile.display_name,
                name: profile.name,
                nip05: profile.nip05,
              }
            : null,
          received: {
            total: received.length,
            uniqueReporters,
            byType,
            sample: received.slice(0, 5).map((r) => ({
              by: r.reportedBy.slice(0, 8),
              type: r.reportType,
              at: new Date(r.reportedAt * 1000).toISOString(),
              content: r.content?.slice(0, 80),
            })),
          },
          filed: {
            total: filed.length,
            uniqueTargets,
            byType: fTypes,
            sample: filed.slice(0, 5).map((f) => ({
              targetCount: f.reportedPubkeys.length,
              firstTarget: f.reportedPubkeys[0]?.slice(0, 8),
              type: f.reportType,
              at: new Date(f.reportedAt * 1000).toISOString(),
              content: f.content?.slice(0, 80),
            })),
          },
        },
        null,
        2,
      ),
    );
  },
  120_000,
);
