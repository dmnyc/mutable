import { Suspense } from "react";
import { Metadata } from "next";
import ReciprocalsWrapper from "@/components/ReciprocalsWrapper";

const reciprocalsImage = {
  url: "/reciprocals_social_card.png",
  width: 1200,
  height: 630,
  alt: "Reciprocals by Mutable — Find non-reciprocal Nostr follows",
};

export const metadata: Metadata = {
  title: "Reciprocals by Mutable: Find non-reciprocal Nostr follows",
  description:
    "Find people you follow who don't follow you back, then unfollow or mute them in bulk — with a local backup saved before any change.",
  openGraph: {
    type: "website",
    title: "Reciprocals by Mutable: Find non-reciprocal Nostr follows",
    description:
      "Find people you follow who don't follow you back, then unfollow or mute them in bulk — with a local backup saved before any change.",
    images: [reciprocalsImage],
  },
  twitter: {
    card: "summary_large_image",
    title: "Reciprocals by Mutable: Find non-reciprocal Nostr follows",
    description:
      "Find people you follow who don't follow you back, then unfollow or mute them in bulk — with a local backup saved before any change.",
    images: [reciprocalsImage],
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
