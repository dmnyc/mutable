"use client";

import { Flame } from "lucide-react";
import Purgatory from "./Purgatory";
import AppShell from "@/components/system/AppShell";

export default function PurgatoryWrapper() {
  return (
    <AppShell
      navActive="purgatory"
      width="regular"
      authGate={{
        icon: <Flame size={30} className="text-red-600 dark:text-red-400" />,
        title: "Purgatory",
        text: (
          <>
            Find follows using specific clients or posting in hellthreads, then
            mute or unfollow in bulk. Sign in to begin.
          </>
        ),
      }}
    >
      <Purgatory />
    </AppShell>
  );
}
