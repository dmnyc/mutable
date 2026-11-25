"use client";

// The full tool directory ("Everything in Mutable"). The homepage shows it
// below the lookup; signed in, it's the "All tools" panel the header's grid
// button toggles. One list, so new tools and badges land in both places.

import Image from "next/image";
import Link from "next/link";
import {
  Lock,
  LockOpen,
  Flag,
  Eraser,
  Medal,
  Radiation,
  Skull,
  Flame,
  Wrench,
  Dna,
  AtSign,
  FileSearch,
  ArrowLeftRight,
  VolumeX,
  Package,
  BrushCleaning,
  DatabaseBackup,
} from "lucide-react";
import SnoopableGlasses from "@/components/SnoopableGlasses";
import Pitchfork from "@/components/Pitchfork";
import MuteualsHand from "@/components/MuteualsHand";
import ZombieHand from "@/components/ZombieHand";
import WiltedRose from "@/components/bloom-reaper/WiltedRose";

interface ToolDirectoryProps {
  /**
   * Homepage: lookup-aware tools carry the typed name or npub through.
   * Without it, those cards are plain links to the tool.
   */
  onLookup?: (path: string) => void;
  /** Signed in: account tools first, and no lock labels. */
  signedIn?: boolean;
  /** Called when any card is chosen (e.g. to close the panel). */
  onNavigate?: () => void;
  /** Hide the "Everything in Mutable" rule (the panel has its own title). */
  hideHeading?: boolean;
}

export default function ToolDirectory({
  onLookup,
  signedIn = false,
  onNavigate,
  hideHeading = false,
}: ToolDirectoryProps) {
  const lookup = (path: string) =>
    onLookup
      ? {
          href: null,
          onClick: () => {
            onNavigate?.();
            onLookup(path);
          },
        }
      : { href: path, onClick: onNavigate };
  const link = { onClick: onNavigate };

  const noLogin = (
    <div className="grid sm:grid-cols-2 lg:grid-cols-2 gap-3">
      <DirectoryCard
        href="/dossier"
        {...link}
        chip={
          <ChipTone tone="red">
            <FileSearch size={16} />
          </ChipTone>
        }
        title="The Dossier"
        badge="NEW"
        text="Every public record, in one report."
      />
      <DirectoryCard
        {...lookup("/zombie-check")}
        chip={
          <ChipTone tone="green">
            <ZombieHand size={18} />
          </ChipTone>
        }
        title="Zombie Check"
        badge="NEW"
        text="Is that Nostr user a zombie?"
      />
      <DirectoryCard
        {...lookup("/draftable")}
        chip={
          <span className="camo w-9 h-9 rounded-[9px] flex items-center justify-center flex-none [--camo-size:80px]">
            <Medal size={16} className="text-white drop-shadow" />
          </span>
        }
        title="Draftable"
        badge="NEW"
        text="Draft packs you can't leave."
      />
      <DirectoryCard
        {...lookup("/reportable")}
        chip={
          <ChipTone tone="orange">
            <Flag size={16} />
          </ChipTone>
        }
        title="Reportable"
        text="Public reports filed about any account."
      />
      <DirectoryCard
        {...lookup("/redactable")}
        chip={
          <ChipTone tone="gray">
            <Eraser size={16} />
          </ChipTone>
        }
        title="Redactable"
        text="What an account asked relays to delete."
      />
      <DirectoryCard
        {...lookup("/mute-o-scope")}
        chip={
          <ChipTone tone="blue">
            <Image
              src="/mute_o_scope_icon_dark.svg"
              alt=""
              width={16}
              height={16}
              className="block dark:hidden"
            />
            <Image
              src="/mute_o_scope_icon_white.svg"
              alt=""
              width={16}
              height={16}
              className="hidden dark:block"
            />
          </ChipTone>
        }
        title="Mute-o-Scope"
        text="Who is publicly muting any profile."
      />
      <DirectoryCard
        {...lookup("/snoopable")}
        chip={
          <ChipTone tone="purple">
            <SnoopableGlasses width={18} height={15} />
          </ChipTone>
        }
        title="Snoopable"
        text="The public metadata of anyone’s DMs."
      />
      <DirectoryCard
        {...lookup("/muggable")}
        chip={
          <ChipTone tone="amber">
            <Wrench size={16} />
          </ChipTone>
        }
        title="Muggable"
        text="Is that Nostr key holding Bitcoin?"
      />
      <DirectoryCard
        href="/clonable"
        {...link}
        chip={
          <ChipTone tone="cyan">
            <Dna size={16} />
          </ChipTone>
        }
        title="Clonable"
        text="Copy your profile, follows and mutes."
      />
    </div>
  );

  const account = (
    <div className="grid sm:grid-cols-2 lg:grid-cols-2 gap-3">
      <DirectoryCard
        href="/burn-after-reading"
        {...link}
        chip={
          <ChipTone tone="orange">
            <Flame size={16} />
          </ChipTone>
        }
        title="Burn After Reading"
        badge="NEW"
        text="Burn your sent DMs and gift wraps."
      />
      <DirectoryCard
        href="/bloom-reaper"
        {...link}
        chip={
          <span className="w-9 h-9 rounded-[9px] flex items-center justify-center flex-none bg-slate-800">
            <WiltedRose size={22} className="text-white" />
          </span>
        }
        title="Bloom Reaper"
        badge="NEW"
        text="Find or reap your lost Blossom photos."
      />
      <DirectoryCard
        href="/dashboard?tab=myList"
        {...link}
        chip={
          <ChipTone tone="red">
            <VolumeX size={16} />
          </ChipTone>
        }
        title="My Mutes"
        text="View, edit and publish your mute list."
      />
      <DirectoryCard
        href="/dashboard?tab=publicLists"
        {...link}
        chip={
          <ChipTone tone="gray">
            <Package size={16} />
          </ChipTone>
        }
        title="Mute Packs"
        text="Subscribe to or publish mute lists."
      />
      <DirectoryCard
        href="/reciprocals"
        {...link}
        chip={
          <ChipTone tone="teal">
            <ArrowLeftRight size={16} />
          </ChipTone>
        }
        title="Reciprocals"
        text="Who you follow that doesn't follow back."
      />
      <DirectoryCard
        href="/dashboard?tab=muteuals"
        {...link}
        chip={
          <ChipTone tone="purple">
            <MuteualsHand size={18} />
          </ChipTone>
        }
        title="Muteuals"
        text="Who has publicly muted you."
      />
      <DirectoryCard
        href="/purgatory"
        {...link}
        chip={
          <ChipTone tone="red">
            <Pitchfork size={16} />
          </ChipTone>
        }
        title="Purgatory"
        text="Find follows by client or hellthread."
      />
      <DirectoryCard
        href="/decimator"
        {...link}
        chip={
          <ChipTone tone="orange">
            <Skull size={16} />
          </ChipTone>
        }
        title="Decimator"
        text="Trim follows by percentage or count."
      />
      <DirectoryCard
        href="/note-nuke"
        {...link}
        chip={
          <ChipTone tone="yellow">
            <Radiation size={16} />
          </ChipTone>
        }
        title="Note Nuke"
        text="Ask every relay to delete a note."
      />
      <DirectoryCard
        href="/dashboard?tab=listCleaner"
        {...link}
        chip={
          <ChipTone tone="green">
            <BrushCleaning size={16} />
          </ChipTone>
        }
        title="List Cleaner"
        text="Scan your mute list for inactives."
      />
      <DirectoryCard
        href="/dashboard?tab=domainPurge"
        {...link}
        chip={
          <ChipTone tone="blue">
            <AtSign size={16} />
          </ChipTone>
        }
        title="Domain Purge"
        text="Purge all followers of a NIP-05 domain."
      />
      <DirectoryCard
        href="/dashboard?tab=backups"
        {...link}
        chip={
          <ChipTone tone="gray">
            <DatabaseBackup size={16} />
          </ChipTone>
        }
        title="Backups"
        text="Exports, signed events, relay recovery."
      />
    </div>
  );

  const label = (text: string, icon: React.ReactNode, first: boolean) => (
    <p
      className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-mut mb-3 ${first ? "" : "mt-8"}`}
    >
      {icon}
      {text}
    </p>
  );

  return (
    <>
      {!hideHeading && (
        <div className="flex items-center gap-4 mb-5">
          <span className="flex-1 h-px bg-line" />
          <h2 className="font-display font-semibold text-[13px] tracking-[0.14em] uppercase text-mut">
            Everything in Mutable
          </h2>
          <span className="flex-1 h-px bg-line" />
        </div>
      )}
      {signedIn ? (
        <>
          {label("Your account", null, true)}
          {account}
          {label("Look anyone up", null, false)}
          {noLogin}
        </>
      ) : (
        <>
          {label("No login", <LockOpen size={16} aria-hidden="true" />, true)}
          {noLogin}
          {label(
            "Connect to use",
            <Lock size={16} aria-hidden="true" />,
            false,
          )}
          {account}
        </>
      )}
    </>
  );
}

function ChipTone({
  tone,
  children,
}: {
  tone:
    | "red"
    | "gray"
    | "teal"
    | "purple"
    | "amber"
    | "orange"
    | "cyan"
    | "yellow"
    | "green"
    | "blue";
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    red: "bg-red-500/15 text-red-700 dark:text-red-400",
    gray: "bg-gray-500/15 text-gray-700 dark:text-gray-300",
    teal: "bg-teal-500/15 text-teal-700 dark:text-teal-400",
    purple: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    orange: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    cyan: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
    yellow: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
    green: "bg-green-500/15 text-green-700 dark:text-green-400",
    blue: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  };
  return (
    <span
      className={`w-9 h-9 rounded-[9px] flex items-center justify-center flex-none ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function DirectoryCard({
  href,
  onClick,
  chip,
  title,
  text,
  badge,
}: {
  href: string | null;
  onClick?: () => void;
  chip: React.ReactNode;
  title: string;
  text: string;
  badge?: "NEW" | "LOGIN";
}) {
  const inner = (
    <>
      {chip}
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-2">
          <span className="text-sm font-semibold text-hi">{title}</span>
          {badge === "LOGIN" && (
            <span className="text-[9px] font-bold tracking-wide px-1.5 py-px rounded uppercase bg-black/5 dark:bg-white/10 text-mut">
              LOGIN
            </span>
          )}
          {badge === "NEW" && (
            <span className="text-[9px] font-bold tracking-wide px-1.5 py-px rounded uppercase bg-primary text-white">
              NEW
            </span>
          )}
        </span>
        {/* Supporting copy is kept short enough for one desktop line. */}
        <span className="block text-[13px] text-mut mt-0.5 leading-snug">
          {text}
        </span>
      </span>
    </>
  );
  const cls =
    "flex items-start gap-3 p-3.5 rounded-xl border border-line bg-white/50 dark:bg-white/[0.03] transition-all duration-150 hover:-translate-y-0.5 hover:border-line-2 hover:shadow-panel text-left";
  return href ? (
    <Link href={href} onClick={onClick} className={cls}>
      {inner}
    </Link>
  ) : (
    <button onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}
