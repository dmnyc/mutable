"use client";

import BloomReaper from "./BloomReaper";
import WiltedRose from "@/components/bloom-reaper/WiltedRose";
import AppShell from "@/components/system/AppShell";

export default function BloomReaperWrapper() {
  return (
    <AppShell
      navActive="bloomReaper"
      width="tool"
      authGate={{
        icon: (
          <span className="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center">
            <WiltedRose size={34} className="text-white" />
          </span>
        ),
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
