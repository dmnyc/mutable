"use client";

import Muteuals from "./Muteuals";
import MuteualsHand from "./MuteualsHand";
import AppShell from "@/components/system/AppShell";

export default function MuteualsWrapper() {
  return (
    <AppShell
      navActive="muteuals"
      authGate={{
        icon: (
          <MuteualsHand
            size={34}
            className="text-red-600 dark:text-red-400"
          />
        ),
        title: "Muteuals",
        text: (
          <>
            Find who muted you and who you muted but still follow. Sign in to
            scan your mute relationships.
          </>
        ),
      }}
    >
      <Muteuals />
    </AppShell>
  );
}
