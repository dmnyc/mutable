import type { Metadata } from "next";
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import ZombieCheck from "@/components/ZombieCheck";

export const metadata: Metadata = {
  title: "Zombie Check by Mutable: Is that Nostr user a zombie?",
  description:
    "Check whether any Nostr user is a zombie and see how long they've been gone. A deep relay scan plus deletion-request history, no sign-in required.",
  openGraph: {
    title: "Zombie Check by Mutable: Is that Nostr user a zombie?",
    description:
      "Check whether any Nostr user is a zombie and see how long they've been gone. A deep relay scan plus deletion-request history, no sign-in required.",
    images: [
      {
        url: "/zombie_check_social_card.png",
        width: 1200,
        height: 630,
        alt: "Zombie Check by Mutable and Plebs vs. Zombies",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Zombie Check by Mutable: Is that Nostr user a zombie?",
    description:
      "Check whether any Nostr user is a zombie and see how long they've been gone. A deep relay scan plus deletion-request history, no sign-in required.",
    images: ["/zombie_check_social_card.png"],
  },
};

export default function ZombieCheckPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-green-600 animate-spin" />
        </div>
      }
    >
      <ZombieCheck />
    </Suspense>
  );
}
