"use client";

import { Users } from "lucide-react";
import Muteuals from "./Muteuals";
import AppShell from "@/components/system/AppShell";

export default function MuteualsWrapper() {
  return (
    <AppShell
      navActive="muteuals"
      authGate={{
        icon: <Users size={30} className="text-red-600 dark:text-red-400" />,
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
