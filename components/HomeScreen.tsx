"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Hatchling from "@/components/Hatchling";
import { hexToNpub } from "@/lib/nostr";
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
          {/* #MyFirstNote banner: the repost button lives on your own
              Dossier, so this opens it with your npub filled in. */}
          <Link
            href={`/dossier?npub=${hexToNpub(session.pubkey)}`}
            className="group mb-8 panel relative rounded-xl border border-line shadow-panel p-4 sm:p-5 flex items-center gap-4 text-left hover:border-line-strong transition-colors"
          >
            <span className="flex-none w-11 h-11 rounded-[10px] bg-gradient-to-br from-red-500 to-red-700 text-white flex items-center justify-center shadow-[inset_0_1px_0_rgb(255_255_255/0.25)]">
              <Hatchling size={30} />
            </span>
            <span className="flex-1 min-w-0">
              <span className="flex items-center gap-2 font-display font-semibold text-base tracking-tight text-hi">
                Find your first note
                <span className="flex-none text-[9px] leading-normal font-sans font-bold tracking-wide px-1.5 py-px rounded uppercase bg-primary text-white">
                  NEW
                </span>
              </span>
              <span className="block text-sm text-mid mt-0.5 text-balance">
                Repost your oldest note as{" "}
                <span className="inline-block align-baseline px-2 py-px rounded-full bg-red-500/15 text-xs font-semibold text-red-600 dark:text-red-400 whitespace-nowrap">
                  #MyFirstNote
                </span>
              </span>
            </span>
            <span className="flex-none h-10 w-10 sm:w-auto sm:px-4 sm:gap-2 rounded-[10px] bg-gradient-to-b from-primary to-primary-deep text-white text-sm font-semibold flex items-center justify-center shadow-[0_4px_16px_-6px_rgb(220_38_38/0.55),inset_0_1px_0_rgb(255_255_255/0.25)] group-hover:brightness-105 group-hover:-translate-y-px transition-all">
              <span className="hidden sm:inline">Find it</span>
              <ArrowRight size={18} />
            </span>
          </Link>
          <ToolDirectory signedIn hideHeading />
        </>
      ) : null}
    </AppShell>
  );
}
