import { Suspense } from "react";
import { Metadata } from "next";
import ReciprocalsWrapper from "@/components/ReciprocalsWrapper";

export const metadata: Metadata = {
  title: "Reciprocals by Mutable: Find non-reciprocal Nostr follows",
  description:
    "Find people you follow who don't follow you back, then unfollow or mute them in bulk — with a local backup saved before any change.",
  openGraph: {
    title: "Reciprocals by Mutable: Find non-reciprocal Nostr follows",
    description:
      "Find people you follow who don't follow you back, then unfollow or mute them in bulk — with a local backup saved before any change.",
    images: ["/reciprocals_social_card.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Reciprocals by Mutable: Find non-reciprocal Nostr follows",
    description:
      "Find people you follow who don't follow you back, then unfollow or mute them in bulk — with a local backup saved before any change.",
    images: ["/reciprocals_social_card.png"],
  },
};

export default function ReciprocalsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800" />
      }
    >
      <ReciprocalsWrapper />
    </Suspense>
  );
}
