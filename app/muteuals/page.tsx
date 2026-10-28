import { Suspense } from "react";
import { Metadata } from "next";
import MuteualsWrapper from "@/components/MuteualsWrapper";

const muteualsImage = {
  url: "/muteuals_social_card.png",
  width: 1200,
  height: 630,
  alt: "Muteuals by Mutable — Who muted you, and who you muted but still follow",
};

export const metadata: Metadata = {
  title: "Muteuals by Mutable: Who muted you, and who you muted but still follow",
  description:
    "Discover users who have publicly muted you, and purge accounts you're muting but still follow — with a local backup saved before any change.",
  openGraph: {
    type: "website",
    title: "Muteuals by Mutable: Who muted you, and who you muted but still follow",
    description:
      "Discover users who have publicly muted you, and purge accounts you're muting but still follow — with a local backup saved before any change.",
    images: [muteualsImage],
  },
  twitter: {
    card: "summary_large_image",
    title: "Muteuals by Mutable: Who muted you, and who you muted but still follow",
    description:
      "Discover users who have publicly muted you, and purge accounts you're muting but still follow — with a local backup saved before any change.",
    images: [muteualsImage],
  },
};

export default function MuteualsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen" />
      }
    >
      <MuteualsWrapper />
    </Suspense>
  );
}
