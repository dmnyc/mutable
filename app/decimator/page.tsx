import { Suspense } from "react";
import { Metadata } from "next";
import DecimatorWrapper from "@/components/DecimatorWrapper";

export const metadata: Metadata = {
  title: "Decimator by Mutable: Trim your Nostr follow list",
  description:
    "Trim your follow list. Randomly remove a percentage, shrink to a target count, or unfollow everyone — with a local backup saved before any change.",
  openGraph: {
    title: "Decimator by Mutable: Trim your Nostr follow list",
    description:
      "Trim your follow list. Randomly remove a percentage, shrink to a target count, or unfollow everyone — with a local backup saved before any change.",
    images: ["/decimator_social_card.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Decimator by Mutable: Trim your Nostr follow list",
    description:
      "Trim your follow list. Randomly remove a percentage, shrink to a target count, or unfollow everyone — with a local backup saved before any change.",
    images: ["/decimator_social_card.png"],
  },
};

export default function DecimatorPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800" />
      }
    >
      <DecimatorWrapper />
    </Suspense>
  );
}
