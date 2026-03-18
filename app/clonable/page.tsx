import { Suspense } from "react";
import { Metadata } from "next";
import ClonableWrapper from "@/components/ClonableWrapper";

export const metadata: Metadata = {
  title: "Clonable by Mutable: Migrate your Nostr identity to a new key",
  description:
    "Quickly clone your profile, follows, mutes, and relays from a compromised key to your new keyset. Supports full nsec migration with private mute decryption.",
  openGraph: {
    title: "Clonable by Mutable: Migrate your Nostr identity to a new key",
    description:
      "Clone your profile, follows, mutes, and relays from an old key to a new one. Essential tool for recovering from a compromised nsec.",
    images: ["/clonable_social_card.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Clonable by Mutable: Migrate your Nostr identity to a new key",
    description:
      "Clone your profile, follows, mutes, and relays from an old key to a new one. Essential tool for recovering from a compromised nsec.",
    images: ["/clonable_social_card.png"],
  },
};

export default function ClonablePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800" />
      }
    >
      <ClonableWrapper />
    </Suspense>
  );
}
