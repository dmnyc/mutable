import type { Metadata } from "next";
import { Suspense } from "react";
import BurnAfterReading from "@/components/BurnAfterReading";

export const metadata: Metadata = {
  title: "🔥 Burn After Reading by Mutable: Delete your Nostr DMs",
  description:
    "NIP-04 DM metadata is public — who you message, when, how often. Burn your sent NIP-04 DMs and the NIP-17 gift wraps addressed to you, across relays with maximum coverage.",
  openGraph: {
    title: "🔥 Burn After Reading by Mutable: Delete your Nostr DMs",
    description:
      "NIP-04 DM metadata is public. Burn your DM envelopes: the NIP-04 DMs you sent, plus the NIP-17 gift wraps addressed to you — decrypted locally, deleted across relays.",
    images: ["/burn_after_reading_social_card.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "🔥 Burn After Reading by Mutable: Delete your Nostr DMs",
    description:
      "NIP-04 DM metadata is public. Burn your DM envelopes: the NIP-04 DMs you sent, plus the NIP-17 gift wraps addressed to you — decrypted locally, deleted across relays.",
    images: ["/burn_after_reading_social_card.png"],
  },
};

export default function BurnAfterReadingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen" />
      }
    >
      <BurnAfterReading />
    </Suspense>
  );
}
