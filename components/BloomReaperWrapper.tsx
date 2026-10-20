"use client";

import { Flower2 } from "lucide-react";
import BloomReaper from "./BloomReaper";
import AppShell from "@/components/system/AppShell";

export default function BloomReaperWrapper() {
  return (
    <AppShell
      navActive="bloomReaper"
      width="tool"
      authGate={{
        icon: <Flower2 size={30} className="text-red-600 dark:text-red-400" />,
        title: "Bloom Reaper",
        text: (
          <>
            Every file you&apos;ve uploaded to Blossom, on every server you
            use. Sign in so your servers will list what&apos;s under your key:
            find lost images, copy their links, or reap them.
          </>
        ),
      }}
    >
      <BloomReaper />
    </AppShell>
  );
}
