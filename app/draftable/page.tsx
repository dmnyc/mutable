import { Suspense } from "react";
import type { Metadata } from "next";
import { nip19 } from "nostr-tools";
import DraftableShell from "@/components/draftable/DraftableShell";
import Draftable from "@/components/draftable/Draftable";
import { resolvePubkey } from "@/lib/draftable/pack";
import { fetchPreviewProfiles, previewName } from "@/lib/draftable/server";

const TITLE = "Draftable by Mutable: Nostr draft packs you can't leave";
const DESCRIPTION =
  "Browse and make Nostr draft packs, and see which ones you've been drafted into. Anyone can draft anyone into a pack, and nobody can remove themselves.";

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
    `Draft packs ${identity} has been drafted into — Draftable`,
    `See every Nostr draft pack ${identity} has been drafted into. They can't leave any of them.`,
  );
}

export default function DraftablePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen" />
      }
    >
      <DraftableShell>
        <Draftable />
      </DraftableShell>
    </Suspense>
  );
}
