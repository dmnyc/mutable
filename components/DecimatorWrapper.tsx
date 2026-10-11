"use client";

import { Skull } from "lucide-react";
import Decimator from "./Decimator";
import AppShell from "@/components/system/AppShell";

export default function DecimatorWrapper() {
  return (
    <AppShell
      navActive="decimator"
      width="regular"
      authGate={{
        icon: <Skull size={30} className="text-red-600 dark:text-red-400" />,
        title: "Decimator",
        text: (
          <>
            Trim your follow list by percentage or count. Sign in to pick who
            goes — with a backup saved first.
          </>
        ),
      }}
    >
      <Decimator />
    </AppShell>
  );
}
