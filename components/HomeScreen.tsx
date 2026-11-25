"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/system/AppShell";
import ToolDirectory from "@/components/ToolDirectory";
import { useStore } from "@/lib/store";
import { getDisplayName } from "@/lib/utils/format";

/**
 * The signed-in home screen: every tool on one page. Signing in lands here,
 * as does "/" while signed in; the header's grid button toggles it,
 * returning to wherever it was opened from (or My Mutes).
 */
export default function HomeScreen() {
  const router = useRouter();
  const session = useStore((state) => state.session);
  const userProfile = useStore((state) => state.userProfile);

  // While React hydrates, the store reads as signed out even with a saved
  // session, so check the real state before sending visitors home.
  useEffect(() => {
    if (!useStore.getState().session) router.replace("/");
  }, [session, router]);

  const name = getDisplayName(userProfile, "");

  return (
    <AppShell navActive="home" navActiveLabel="Home" width="regular">
      {session ? (
        <>
          <div className="mb-8">
            <div className="min-w-0">
              <h1 className="font-display font-bold text-3xl tracking-tight text-hi [text-wrap:balance]">
                {name ? `Hi, ${name}` : "Everything in Mutable"}
              </h1>
              <p className="mt-1.5 text-mid [text-wrap:pretty]">
                Every tool in Mutable. The grid button by the logo takes you
                back to where you were.
              </p>
            </div>
          </div>
          <ToolDirectory signedIn hideHeading />
        </>
      ) : null}
    </AppShell>
  );
}
