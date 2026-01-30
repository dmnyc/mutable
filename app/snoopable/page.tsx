import { Suspense } from "react";
import { Metadata } from "next";
import SnoopableWrapper from "@/components/SnoopableWrapper";

export const metadata: Metadata = {
  title: "Snoopable by Mutable: Your DMs aren't as private as you think",
  description:
    "Educational tool showing that NIP-04 DM metadata (who talks to whom, when, how often) is publicly visible on Nostr relays. Your DMs aren't as private as you think.",
  openGraph: {
    title: "Snoopable by Mutable: Your DMs aren't as private as you think",
    description:
      "See the public metadata of any Nostr user's DM activity - no decryption needed. Educational tool exposing NIP-04 privacy limitations.",
    images: ["/snoopable_social_card.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Snoopable by Mutable: Your DMs aren't as private as you think",
    description:
      "See the public metadata of any Nostr user's DM activity - no decryption needed. Educational tool exposing NIP-04 privacy limitations.",
    images: ["/snoopable_social_card.png"],
  },
};

export default function SnoopablePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800" />
      }
    >
      <SnoopableWrapper />
    </Suspense>
  );
}
