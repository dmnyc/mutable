// Share-note builder for Zombie Check results. Pure so the wording and tags
// can be tested without mounting the component; the component supplies the
// verdict and the Blossom URL of the rendered card image. Ported from Plebs
// vs. Zombies' lib/sharing/noteText.js.

export const ZOMBIE_CHECK_SHARE_URL = "https://mutable.top/zombie-check";

export interface ZombieShareResult {
  pubkey: string;
  npub: string;
  name: string | null;
  displayName: string | null;
  /** Verdict line, e.g. "💚 Alive!" or "💀 Ancient Zombie". */
  verdictLine: string;
  detail: string;
  /** Deletion status line including its icon, e.g. "✅ No deletion request found." */
  deletionLine: string;
}

/**
 * Build the kind-1 note content and tags for a shared Zombie Check result.
 *
 * Lead with a first-person opener and reference the subject purely as a
 * nostr: mention — clients render it as @name and thread it via the p-tag,
 * so a plain name beside it just reads as a duplicate. A plain name (or
 * Anonymous) only appears when there's no npub to link.
 *
 * `imageUrl` is the Blossom URL of the rendered card image, appended on its
 * own line so clients render it as the note's picture.
 */
export function buildZombieShareNote(
  result: ZombieShareResult,
  { imageUrl = null }: { imageUrl?: string | null } = {},
): { content: string; tags: string[][] } {
  const npub = result.npub || "";
  const name = result.displayName || result.name || "";

  const subject = npub ? `nostr:${npub}` : name || "Anonymous";

  const lines = [
    `I just ran a zombie check on ${subject} and here's what I found:`,
    "",
    result.verdictLine,
  ];

  if (result.detail) {
    lines.push(result.detail);
  }
  if (result.deletionLine) {
    lines.push(result.deletionLine);
  }

  lines.push("");
  // The subject's npub already rides in the opener's mention — this CTA
  // invites the reader to check their own follows, so it stays a bare link
  // rather than deep-linking a re-run of the subject's check.
  lines.push(`🧟 Run your own zombie check: ${ZOMBIE_CHECK_SHARE_URL}`);

  if (imageUrl) {
    lines.push("");
    lines.push(imageUrl);
  }

  const tags: string[][] = [
    ["t", "ZombieCheck"],
    ["t", "Mutable"],
    ["client", "Mutable"],
  ];
  // Tag the subject so clients thread the report to them, matching how the
  // note already mentions them via nostr:npub.
  if (result.pubkey) {
    tags.unshift(["p", result.pubkey]);
  }

  return { content: lines.join("\n"), tags };
}
