import { Suspense } from "react";
import type { Metadata } from "next";
import { nip19 } from "nostr-tools";
import Redactable from "@/components/Redactable";
import { naMetadata, NaProfile } from "@/lib/nostrArchives";

const GENERIC_TITLE =
  "Redactable by Mutable: See which posts Nostr users are deleting";
const GENERIC_DESCRIPTION =
  "Search any npub to see every post they have requested to delete, or browse the live feed of NIP-09 deletion requests. No sign-in required.";

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
          url: "/redactable_social_card.png",
          width: 1200,
          height: 630,
          alt: "Redactable by Mutable — see which posts Nostr users are deleting",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: GENERIC_TITLE,
      description: GENERIC_DESCRIPTION,
      images: ["/redactable_social_card.png"],
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

  const title = `Posts deleted by ${identity} — Redactable by Mutable`;
  const description = `See every post ${identity} has requested to delete on Nostr — their public NIP-09 (kind:5) deletion history. No sign-in required.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [
        {
          url: "/redactable_social_card.png",
          width: 1200,
          height: 630,
          alt: "Redactable by Mutable — see which posts Nostr users are deleting",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/redactable_social_card.png"],
    },
  };
}

export default function RedactablePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800" />
      }
    >
      <Redactable />
    </Suspense>
  );
}
