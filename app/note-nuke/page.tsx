import { Suspense } from "react";
import { Metadata } from "next";
import NoteNukeWrapper from "@/components/NoteNukeWrapper";

export const metadata: Metadata = {
  title: "☢️ Note Nuke by Mutable: Delete Nostr events across relays",
  description:
    "Publish deletion events to your connected relays with maximum coverage. Delete your notes, clear your relay history, and clean up with complete control.",
  openGraph: {
    title: "☢️ Note Nuke by Mutable: Delete Nostr events across relays",
    description:
      "Delete your notes, clear your relay history, and clean up with maximum relay coverage for best results.",
    images: ["/note_nuke_social_card.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "☢️ Note Nuke by Mutable: Delete Nostr events across relays",
    description:
      "Delete your notes, clear your relay history, and clean up with maximum relay coverage for best results.",
    images: ["/note_nuke_social_card.png"],
  },
};

export default function NoteNukePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen" />
      }
    >
      <NoteNukeWrapper />
    </Suspense>
  );
}
