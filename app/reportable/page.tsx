import { Suspense } from "react";
import type { Metadata } from "next";
import { nip19 } from "nostr-tools";
import Reportable from "@/components/Reportable";
import { naMetadata, NaProfile } from "@/lib/nostrArchives";

const GENERIC_TITLE =
  "Reportable by Mutable: See who is publicly reporting whom on Nostr";
const GENERIC_DESCRIPTION =
  "Search any npub to see their public NIP-56 report history, or browse the live feed of reports across the network. No sign-in required.";

// Social scrapers (and the server render itself) won't wait on a slow
// metadata API — race it and fall back to npub-only text.
const PROFILE_TIMEOUT_MS = 2500;

function genericMetadata(): Metadata {
  return {
    title: GENERIC_TITLE,
    description: GENERIC_DESCRIPTION,
    openGraph: {
      title: GENERIC_TITLE,
      description: GENERIC_DESCRIPTION,
      images: [
        {
          url: "/reportable_social_card.png",
          width: 1200,
          height: 630,
          alt: "Reportable by Mutable — see who is publicly reporting whom on Nostr",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: GENERIC_TITLE,
      description: GENERIC_DESCRIPTION,
      images: ["/reportable_social_card.png"],
    },
  };
}

/** Decode the npub/nprofile URL param to a hex pubkey, or null. */
function decodeNpubParam(
  value: string | string[] | undefined,
): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const decoded = nip19.decode(value.trim());
    if (decoded.type === "npub") return decoded.data as string;
    if (decoded.type === "nprofile") {
      return (decoded.data as { pubkey: string }).pubkey;
    }
  } catch {
    // fall through
  }
  return null;
}

async function resolveProfile(pubkey: string): Promise<NaProfile | null> {
  try {
    const profiles = await Promise.race([
      naMetadata([pubkey]),
      new Promise<Awaited<ReturnType<typeof naMetadata>>>((resolve) =>
        setTimeout(() => resolve([]), PROFILE_TIMEOUT_MS),
      ),
    ]);
    return profiles.find((p) => p.pubkey === pubkey.toLowerCase()) ?? null;
  } catch {
    return null;
  }
}

/** Collapse whitespace and cap length so profile data can't bloat the tags. */
function cleanName(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
}

function shortNpub(npub: string): string {
  return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<Metadata> {
  const params = await searchParams;
  const npubParam = typeof params.npub === "string" ? params.npub : undefined;
  const pubkey = decodeNpubParam(npubParam);
  if (!pubkey) return genericMetadata();

  const profile = await resolveProfile(pubkey);
  const name = cleanName(
    profile?.display_name ?? profile?.preferred_name ?? profile?.name,
  );
  const nip05 = cleanName(profile?.nip05);

  let identity = shortNpub(npubParam as string);
  if (name && nip05 && name.length <= 24) {
    identity = `${name} (${nip05})`;
  } else if (name) {
    identity = name;
  } else if (nip05) {
    identity = nip05;
  }

  const filed = params.view === "filed";
  const title = filed
    ? `Reports filed by ${identity} — Reportable by Mutable`
    : `Reports about ${identity} — Reportable by Mutable`;
  const description = filed
    ? `See the public NIP-56 (kind:1984) reports ${identity} has filed against others on Nostr. No sign-in required.`
    : `See the public NIP-56 (kind:1984) reports filed against ${identity} on Nostr, plus who they have reported. No sign-in required.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [
        {
          url: "/reportable_social_card.png",
          width: 1200,
          height: 630,
          alt: "Reportable by Mutable — see who is publicly reporting whom on Nostr",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/reportable_social_card.png"],
    },
  };
}

export default function ReportablePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800" />
      }
    >
      <Reportable />
    </Suspense>
  );
}
