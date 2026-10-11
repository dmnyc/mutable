import type { Metadata } from "next";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import Dossier from "@/components/Dossier";

export const metadata: Metadata = {
  title: "The Dossier — Mutable",
  description:
    "Mute Score, reports, deletions and public footprint for any Nostr profile — one report, no login.",
  openGraph: {
    title: "The Dossier — Mutable",
    description:
      "Run anyone's public record: mute score, reports, deletions and footprint. No login required.",
    images: [{ url: "/mutable_social_card.png", width: 1200, height: 630 }],
  },
};

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
