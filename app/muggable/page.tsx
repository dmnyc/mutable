import { Suspense } from "react";
import { Metadata } from "next";
import MuggableWrapper from "@/components/MuggableWrapper";

export const metadata: Metadata = {
  title: "Muggable by Mutable: Is your Nostr key holding Bitcoin?",
  description:
    "Check if your Nostr identity controls Bitcoin on-chain. A Nostr nsec is also a Bitcoin private key — see your exposure before someone else does.",
  openGraph: {
    title: "Muggable by Mutable: Is your Nostr key holding Bitcoin?",
    description:
      "Check if your Nostr identity controls Bitcoin on-chain. A Nostr nsec is also a Bitcoin private key — see your exposure before someone else does.",
    images: ["/muggable_social_card.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Muggable by Mutable: Is your Nostr key holding Bitcoin?",
    description:
      "Check if your Nostr identity controls Bitcoin on-chain. A Nostr nsec is also a Bitcoin private key — see your exposure before someone else does.",
    images: ["/muggable_social_card.png"],
  },
};

export default function MuggablePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800" />
      }
    >
      <MuggableWrapper />
    </Suspense>
  );
}
