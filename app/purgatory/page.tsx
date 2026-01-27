import { Suspense } from "react";
import { Metadata } from "next";
import PurgatoryWrapper from "@/components/PurgatoryWrapper";

export const metadata: Metadata = {
  title: "Purgatory by Mutable: Find and mute hellthread spammers",
  description:
    "Find follows engaging in destructive behavior like mass-tagging hellthreads or using spam apps, then bulk mute them.",
  openGraph: {
    title: "Purgatory by Mutable: Find and mute hellthread spammers",
    description:
      "Find follows engaging in destructive behavior like mass-tagging hellthreads or using spam apps, then bulk mute them.",
    images: ["/purgatory_social_card.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Purgatory by Mutable: Find and mute hellthread spammers",
    description:
      "Find follows engaging in destructive behavior like mass-tagging hellthreads or using spam apps, then bulk mute them.",
    images: ["/purgatory_social_card.png"],
  },
};

export default function PurgatoryPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800" />
      }
    >
      <PurgatoryWrapper />
    </Suspense>
  );
}
