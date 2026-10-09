import { Suspense } from "react";
import type { Metadata } from "next";
import DraftableShell from "@/components/draftable/DraftableShell";
import DraftableEditor from "@/components/draftable/DraftableEditor";

export const metadata: Metadata = {
  title: "Draft a follow pack — Draftable by Mutable",
  description:
    "Make a Nostr follow pack. The people you add aren't asked and can't leave.",
  robots: { index: false },
};

export default function DraftableCreatePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800" />
      }
    >
      <DraftableShell>
        <DraftableEditor />
      </DraftableShell>
    </Suspense>
  );
}
