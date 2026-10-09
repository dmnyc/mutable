import { Suspense } from "react";
import type { Metadata } from "next";
import { nip19 } from "nostr-tools";
import DraftableShell from "@/components/draftable/DraftableShell";
import Draftable from "@/components/draftable/Draftable";
import { resolvePubkey } from "@/lib/draftable/pack";
import { fetchPreviewProfiles, previewName } from "@/lib/draftable/server";

const TITLE = "Draftable by Mutable: Nostr follow packs you can't leave";
const DESCRIPTION =
  "Browse and make Nostr follow packs, and see which ones you've been drafted into. Anyone can draft anyone into a pack, and nobody can remove themselves.";

function metadataFor(title: string, description: string): Metadata {
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [
        {
          url: "/draftable_social_card.png",
          width: 1200,
          height: 630,
          alt: "Draftable by Mutable",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/draftable_social_card.png"],
    },
  };
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<Metadata> {
  const params = await searchParams;
  const pubkey = resolvePubkey(
    typeof params.npub === "string" ? params.npub : null,
  );
  if (!pubkey) return metadataFor(TITLE, DESCRIPTION);

  const profiles = await fetchPreviewProfiles([pubkey]);
  const npub = nip19.npubEncode(pubkey);
  const identity =
    previewName(profiles.get(pubkey)) ?? `${npub.slice(0, 10)}…${npub.slice(-4)}`;
  return metadataFor(
    `Follow packs ${identity} has been drafted into — Draftable`,
    `See every Nostr follow pack ${identity} has been drafted into. Nobody asked them, and they can't leave any of them.`,
  );
}

export default function DraftablePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800" />
      }
    >
      <DraftableShell>
        <Draftable />
      </DraftableShell>
    </Suspense>
  );
}
