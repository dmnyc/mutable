import type { Metadata } from "next";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import Dossier from "@/components/Dossier";

// Shares carry ?npub=, so the preview card renders that subject's folder.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const params = await searchParams;
  const npub = typeof params.npub === "string" ? params.npub : undefined;
  const card = npub
    ? `/dossier/card?npub=${encodeURIComponent(npub)}`
    : "/mutable_social_card.png";
  return {
    title: "The Dossier — Mutable",
    description:
      "Mute Score, reports, deletions and public footprint for any Nostr profile — one report, no login.",
    openGraph: {
      title: "The Dossier — Mutable",
      description:
        "Run anyone's public record: mute score, reports, deletions and footprint. No login required.",
      images: [{ url: card, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "The Dossier — Mutable",
      description:
        "Run anyone's public record: mute score, reports, deletions and footprint. No login required.",
      images: [card],
    },
  };
}

export default function DossierPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-red-600 animate-spin" />
        </div>
      }
    >
      <Dossier />
    </Suspense>
  );
}
