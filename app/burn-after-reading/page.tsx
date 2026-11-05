import type { Metadata } from "next";
import { Suspense } from "react";
import BurnAfterReading from "@/components/BurnAfterReading";

export const metadata: Metadata = {
  title: "🔥 Burn After Reading by Mutable: Delete your Nostr DMs",
  description:
    "Bulk-delete your Nostr direct messages: the NIP-04 DMs you sent and every NIP-17 private-DM gift wrap addressed to you, across relays with maximum coverage.",
  openGraph: {
    title: "🔥 Burn After Reading by Mutable: Delete your Nostr DMs",
    description:
      "Ask every relay we can reach to burn your DM envelopes. NIP-04 messages you sent and NIP-17 gift wraps addressed to you — content is never decrypted.",
    images: ["/burn_after_reading_social_card.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "🔥 Burn After Reading by Mutable: Delete your Nostr DMs",
    description:
      "Ask every relay we can reach to burn your DM envelopes. NIP-04 messages you sent and NIP-17 gift wraps addressed to you — content is never decrypted.",
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
