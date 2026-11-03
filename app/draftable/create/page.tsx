import { Suspense } from "react";
import type { Metadata } from "next";
import DraftableShell from "@/components/draftable/DraftableShell";
import DraftableEditor from "@/components/draftable/DraftableEditor";

export const metadata: Metadata = {
  title: "New draft pack — Draftable by Mutable",
  description:
    "Make a Nostr draft pack. The people you add can't leave.",
  robots: { index: false },
};

export default function DraftableCreatePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen" />
      }
    >
      <DraftableShell>
        <DraftableEditor />
      </DraftableShell>
    </Suspense>
  );
}
