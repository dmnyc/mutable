"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import AuthModal from "@/components/AuthModal";
import Footer from "@/components/Footer";
import SnoopableGlasses from "@/components/SnoopableGlasses";
import Pitchfork from "@/components/Pitchfork";
import {
  Lock,
  User,
  Loader2,
  Flag,
  Trash2,
  Search,
  Medal,
  Radiation,
  Skull,
  Copy,
  FileSearch,
  ArrowLeftRight,
  Sun,
  Moon,
  Bitcoin,
  VolumeX,
  Package,
  UserX,
  BrushCleaning,
  Globe,
  DatabaseBackup,
} from "lucide-react";
import { searchProfiles, hexToNpub, DEFAULT_RELAYS } from "@/lib/nostr";
import { Profile } from "@/types";

export default function Home() {
  const router = useRouter();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [resolvedPubkey, setResolvedPubkey] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [profileSearchResults, setProfileSearchResults] = useState<Profile[]>(
    [],
  );
  const [isSearchingProfiles, setIsSearchingProfiles] = useState(false);
  const [showProfileResults, setShowProfileResults] = useState(false);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const { isConnected } = useAuth();
  const [theme, setTheme] = useTheme();

  useEffect(() => {
    if (isConnected) {
      router.push("/dashboard");
    }
  }, [isConnected, router]);

  // Real-time profile search
  useEffect(() => {
    const searchUserProfiles = async () => {
      if (!searchQuery.trim()) {
        setProfileSearchResults([]);
        setShowProfileResults(false);
        return;
      }

      // Don't search if it's already a valid npub, nprofile, or hex pubkey
      if (
        searchQuery.startsWith("npub") ||
        searchQuery.startsWith("nprofile") ||
        searchQuery.match(/^[0-9a-f]{64}$/i)
      ) {
        setProfileSearchResults([]);
        setShowProfileResults(false);
        return;
      }

      // A profile was just picked — its pubkey is stored, so don't re-search
      // the display name and reopen the dropdown over the lens buttons.
      // Editing the input clears the pick and searching resumes.
      if (resolvedPubkey) {
        setProfileSearchResults([]);
        setShowProfileResults(false);
        return;
      }

      setIsSearchingProfiles(true);
      setShowProfileResults(true);
      try {
        const results = await searchProfiles(searchQuery, DEFAULT_RELAYS, 10);
        setProfileSearchResults(results);
      } catch (error) {
        console.error("Profile search failed:", error);
        setProfileSearchResults([]);
      } finally {
        setIsSearchingProfiles(false);
      }
    };

    // Debounce search - wait 300ms after user stops typing
    const timeoutId = setTimeout(searchUserProfiles, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, resolvedPubkey]);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchDropdownRef.current &&
        !searchDropdownRef.current.contains(event.target as Node)
      ) {
        setShowProfileResults(false);
      }
    };

    if (showProfileResults) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showProfileResults]);

  // One lookup feeds every no-sign-in tool: resolve whatever was typed
  // (npub/nprofile passes through, hex converts, names/NIP-05 resolve via
  // profile search) into an npub, then jump to the chosen lens. With an
  // empty field the lens buttons simply open that tool's own home screen.
  const handleToolSearch = async (path: string) => {
    const query = searchQuery.trim();
    if (resolving) return;
    setShowProfileResults(false);

    if (!query) {
      router.push(path);
      return;
    }

    if (resolvedPubkey) {
      router.push(
        `${path}?npub=${encodeURIComponent(hexToNpub(resolvedPubkey))}`,
      );
      return;
    }

    setResolving(true);
    setLookupError(null);
    try {
      let target: string;
      if (query.startsWith("npub") || query.startsWith("nprofile")) {
        target = query;
      } else if (query.match(/^[0-9a-f]{64}$/i)) {
        target = hexToNpub(query);
      } else {
        const profiles = await searchProfiles(query, DEFAULT_RELAYS, 10);
        if (profiles.length === 0) {
          setLookupError(
            `No user found for "${query}". Try a name, NIP-05, or npub.`,
          );
          return;
        }
        target = hexToNpub(profiles[0].pubkey);
      }
      router.push(`${path}?npub=${encodeURIComponent(target)}`);
    } catch (error) {
      console.error("Failed to resolve user:", error);
      setLookupError("Could not resolve that user. Please try again.");
    } finally {
      setResolving(false);
    }
  };

  // Picking from the dropdown stores the pubkey so clicking a lens needs no
  // second relay round trip.
  const handleSelectProfile = (profile: Profile) => {
    setSearchQuery(profile.display_name || profile.name || profile.nip05 || "");
    setResolvedPubkey(profile.pubkey);
    setLookupError(null);
    setShowProfileResults(false);
  };

  if (isConnected) {
    return <div>Redirecting...</div>;
  }

  const lensClass =
    "relative flex items-center gap-3 px-3.5 py-3 rounded-[10px] text-white text-left font-semibold text-sm transition-all duration-150 hover:-translate-y-0.5";

  return (
    <>
      <div className="min-h-screen flex flex-col">
        {/* Top bar */}
        <div className="max-w-6xl w-full mx-auto px-6 pt-5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image
              src="/mutable_logo.svg"
              alt="Mutable"
              width={28}
              height={28}
              priority
            />
            <span>
              <Image
                src="/mutable_text_dark.svg"
                alt="Mutable"
                width={88}
                height={18}
                priority
                className="block dark:hidden"
              />
              <Image
                src="/mutable_text.svg"
                alt="Mutable"
                width={88}
                height={18}
                priority
                className="hidden dark:block"
              />
            </span>
          </Link>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="w-9 h-9 rounded-[10px] border border-line-2 text-mut hover:text-hi flex items-center justify-center transition-colors"
            title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          >
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </div>

        <div className="flex-1 px-6 pb-16">
          {/* Hero */}
          <div className="text-center max-w-2xl mx-auto mt-14 animate-rise">
            <div className="flex justify-center items-center gap-4">
              <Image
                src="/mutable_logo.svg"
                alt="Mutable"
                width={84}
                height={84}
                priority
              />
              <Image
                src="/mutable_text_dark.svg"
                alt="Mutable"
                width={250}
                height={50}
                priority
                className="block dark:hidden"
              />
              <Image
                src="/mutable_text.svg"
                alt="Mutable"
                width={250}
                height={50}
                priority
                className="hidden dark:block"
              />
            </div>
            <p className="text-lg text-mid mt-5 text-balance">
              <span className="font-semibold text-hi">
                Your Nostr mute list manager.
              </span>{" "}
              Back up, edit, discover and share mute lists — plus DM forensics,
              follow packs, reciprocal audits and event deletion.
            </p>
            <div className="mt-6">
              <button
                onClick={() => setShowAuthModal(true)}
                className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-b from-primary to-primary-deep text-white rounded-[10px] font-semibold shadow-[0_4px_16px_-6px_rgb(220_38_38/0.55),inset_0_1px_0_rgb(255_255_255/0.25)] hover:shadow-[0_6px_22px_-6px_rgb(220_38_38/0.7),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-105 hover:-translate-y-px transition-all"
              >
                <Lock size={18} />
                Connect with Nostr
              </button>
            </div>
          </div>

          {/* Universal No-Sign-In Lookup — one field feeds every anonymous
              tool: resolve a name, NIP-05, or npub once, then pick the lens
              to open it in. */}
          <div className="max-w-2xl mx-auto mt-10 animate-rise stagger-1">
            <section className="panel relative rounded-xl border border-line shadow-panel p-5">
              <h2 className="font-display font-semibold text-base tracking-tight text-hi">
                Look up any user
              </h2>
              <p className="text-sm text-mut mt-0.5">No login required.</p>

              <div className="relative mt-4" ref={searchDropdownRef}>
                <div className="flex gap-2.5">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setResolvedPubkey(null);
                        setLookupError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          setShowProfileResults(false);
                          handleToolSearch("/mute-o-scope");
                        }
                      }}
                      onFocus={() => {
                        if (profileSearchResults.length > 0) {
                          setShowProfileResults(true);
                        }
                      }}
                      placeholder="npub, NIP-05 or hex pubkey"
                      className="w-full px-4 py-2.5 pr-10 bg-inset border border-line-strong rounded-[10px] text-hi text-sm"
                    />
                    {(resolving || isSearchingProfiles) && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <Loader2
                          size={16}
                          className="animate-spin text-mut"
                        />
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setShowProfileResults(false);
                      handleToolSearch("/mute-o-scope");
                    }}
                    className="px-5 py-2.5 bg-gradient-to-b from-primary to-primary-deep text-white rounded-[10px] font-semibold text-sm shadow-[0_4px_16px_-6px_rgb(220_38_38/0.55),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-105 transition-all"
                  >
                    Search
                  </button>
                </div>

                {/* Profile search results dropdown */}
                {showProfileResults && profileSearchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 panel border border-line-2 rounded-xl shadow-panel max-h-60 overflow-y-auto z-50">
                    {profileSearchResults.map((profile) => (
                      <button
                        key={profile.pubkey}
                        onClick={() => handleSelectProfile(profile)}
                        className="w-full flex items-center gap-3 p-3 hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-left"
                      >
                        {profile.picture ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={profile.picture}
                            alt={profile.display_name || profile.name || "User"}
                            className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display =
                                "none";
                            }}
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-black/10 dark:bg-white/10 flex items-center justify-center flex-shrink-0">
                            <User size={20} className="text-mut" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-hi truncate">
                            {profile.display_name ||
                              profile.name ||
                              "Anonymous"}
                          </p>
                          {profile.nip05 && (
                            <p className="text-xs text-green-600 dark:text-green-400 truncate">
                              ✓ {profile.nip05}
                            </p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* The Dossier — one report from every public record */}
              <button
                onClick={() => {
                  setShowProfileResults(false);
                  handleToolSearch("/dossier");
                }}
                className="w-full mt-2.5 px-4 py-3 bg-gradient-to-b from-primary to-primary-deep text-white rounded-[10px] font-semibold text-sm shadow-[0_4px_16px_-6px_rgb(220_38_38/0.55),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-105 hover:-translate-y-px transition-all flex items-center justify-center gap-2"
              >
                <FileSearch size={16} />
                Open the Dossier — the full public record
              </button>

              {/* Lens buttons — NEW stays on both Reportable and Redactable */}
              <div className="grid sm:grid-cols-2 gap-2.5 mt-4">
                <button
                  onClick={() => handleToolSearch("/mute-o-scope")}
                  title="Who is publicly muting them"
                  className={`${lensClass} bg-gradient-to-b from-blue-500 to-blue-700 shadow-[0_6px_18px_-8px_rgb(37_99_235/0.7),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-110`}
                >
                  <Image
                    src="/mute_o_scope_icon_white.svg"
                    alt=""
                    width={17}
                    height={17}
                  />
                  Mute-o-Scope
                </button>
                <button
                  onClick={() => handleToolSearch("/snoopable")}
                  title="How public their activity really is"
                  className={`${lensClass} bg-gradient-to-b from-purple-500 to-purple-700 shadow-[0_6px_18px_-8px_rgb(147_51_234/0.7),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-110`}
                >
                  <SnoopableGlasses className="flex-shrink-0" />
                  Snoopable
                </button>
                <button
                  onClick={() => handleToolSearch("/reportable")}
                  title="Public reports filed about them — and by them"
                  className={`${lensClass} bg-gradient-to-b from-orange-500 to-orange-700 shadow-[0_6px_18px_-8px_rgb(234_88_12/0.7),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-110`}
                >
                  <Flag size={16} />
                  Reportable
                  <span className="absolute top-2 right-2 text-[10px] font-bold px-1.5 py-px bg-white/25 rounded">
                    NEW
                  </span>
                </button>
                <button
                  onClick={() => handleToolSearch("/redactable")}
                  title="Their deletion requests and deleted posts"
                  className={`${lensClass} bg-gradient-to-b from-slate-600 to-slate-900 shadow-[0_6px_18px_-8px_rgb(15_23_42/0.8),inset_0_1px_0_rgb(255_255_255/0.18)] ring-1 ring-white/10 hover:brightness-125`}
                >
                  <Trash2 size={16} />
                  Redactable
                  <span className="absolute top-2 right-2 text-[10px] font-bold px-1.5 py-px bg-white/25 rounded">
                    NEW
                  </span>
                </button>
              </div>

              {lookupError && (
                <p className="mt-3 text-xs text-red-600 dark:text-red-400">
                  {lookupError}
                </p>
              )}
            </section>
          </div>

          {/* Directory — everything the lookup above doesn't cover, grouped
              by whether a session is needed. */}
          <section className="max-w-4xl mx-auto mt-14 animate-rise stagger-2">
            <div className="flex items-center gap-4 mb-5">
              <span className="flex-1 h-px bg-line" />
              <h2 className="font-display font-semibold text-[13px] tracking-[0.14em] uppercase text-mut">
                Everything else
              </h2>
              <span className="flex-1 h-px bg-line" />
            </div>

            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-mut mb-3">
              No login
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-2 gap-3">
              <DirectoryCard
                href="/dossier"
                chip={<ChipTone tone="gray"><FileSearch size={16} /></ChipTone>}
                title="The Dossier"
                badge="NEW"
                text="Mutes, reports, deletions, Bitcoin, DMs and footprint — one report."
              />
              <DirectoryCard
                href={null}
                onClick={() => handleToolSearch("/draftable")}
                chip={
                  <span className="camo w-9 h-9 rounded-[9px] flex items-center justify-center flex-none [--camo-size:80px]">
                    <Medal size={16} className="text-white drop-shadow" />
                  </span>
                }
                title="Draftable"
                badge="NEW"
                text="Follow packs you can't leave."
              />
              <DirectoryCard
                href="/muggable"
                chip={<ChipTone tone="amber"><Bitcoin size={16} /></ChipTone>}
                title="Muggable"
                text="Check whether a Nostr key is holding Bitcoin on-chain."
              />
              <DirectoryCard
                href="/clonable"
                chip={<ChipTone tone="violet"><Copy size={16} /></ChipTone>}
                title="Clonable"
                text="Clone any public list into your own mute list."
              />
            </div>

            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-mut mb-3 mt-8">
              Connect to use
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-2 gap-3">
              <DirectoryCard
                href="/dashboard?tab=myList"
                chip={<ChipTone tone="red"><VolumeX size={16} /></ChipTone>}
                title="My Mutes"
                text="View, edit and publish your kind:10000 mute list."
              />
              <DirectoryCard
                href="/dashboard?tab=publicLists"
                chip={<ChipTone tone="gray"><Package size={16} /></ChipTone>}
                title="Mute Packs"
                text="Subscribe to public mute lists, or publish your own."
              />
              <DirectoryCard
                href="/reciprocals"
                chip={<ChipTone tone="teal"><ArrowLeftRight size={16} /></ChipTone>}
                title="Reciprocals"
                text="Who you follow that doesn't follow back."
              />
              <DirectoryCard
                href="/dashboard?tab=muteuals"
                chip={<ChipTone tone="purple"><UserX size={16} /></ChipTone>}
                title="Muteuals"
                text="Who has publicly muted you."
              />
              <DirectoryCard
                href="/purgatory"
                chip={<ChipTone tone="amber"><Pitchfork size={16} /></ChipTone>}
                title="Purgatory"
                text="Find follows by client or hellthread participation."
              />
              <DirectoryCard
                href="/decimator"
                chip={<ChipTone tone="orange"><Skull size={16} /></ChipTone>}
                title="Decimator"
                text="Trim your follow list by percentage or count."
              />
              <DirectoryCard
                href="/note-nuke"
                chip={<ChipTone tone="red"><Radiation size={16} /></ChipTone>}
                title="Note Nuke"
                text="Ask every relay we can reach to delete a note."
              />
              <DirectoryCard
                href="/dashboard?tab=listCleaner"
                chip={<ChipTone tone="green"><BrushCleaning size={16} /></ChipTone>}
                title="List Cleaner"
                text="Scan your mute list for inactive profiles."
              />
              <DirectoryCard
                href="/dashboard?tab=domainPurge"
                chip={<ChipTone tone="blue"><Globe size={16} /></ChipTone>}
                title="Domain Purge"
                text="Remove every follower of a NIP-05 domain."
              />
              <DirectoryCard
                href="/dashboard?tab=backups"
                chip={<ChipTone tone="gray"><DatabaseBackup size={16} /></ChipTone>}
                title="Backups"
                text="Exports, signed events and relay-history recovery."
              />
            </div>
          </section>

          {/* Creator credits */}
          <div className="max-w-md mx-auto w-full mt-12 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-sm text-mut animate-rise stagger-3">
            <span className="whitespace-nowrap">From the creator of</span>
            <a
              href="https://plebsvszombies.cc"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 whitespace-nowrap hover:text-purple-600 dark:hover:text-purple-400 transition-colors font-medium"
            >
              <Image
                src="/plebs_vs_zombies_logo.svg"
                alt="Plebs vs. Zombies"
                width={20}
                height={20}
              />
              Plebs vs. Zombies
            </a>
            <span>and</span>
            <a
              href="https://sidecar.top"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 whitespace-nowrap hover:text-red-600 dark:hover:text-red-400 transition-colors font-medium"
            >
              <Image
                src="/sidecar_icon.svg"
                alt="Sidecar"
                width={18}
                height={20}
              />
              Sidecar
            </a>
          </div>
        </div>

        <Footer />
      </div>

      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />
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
    | "violet"
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
    violet: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
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
        <span className="block text-[13px] text-mut mt-0.5 leading-snug">
          {text}
        </span>
      </span>
    </>
  );
  const cls =
    "flex items-start gap-3 p-3.5 rounded-xl border border-line bg-white/50 dark:bg-white/[0.03] transition-all duration-150 hover:-translate-y-0.5 hover:border-line-2 hover:shadow-panel text-left";
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <button onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}
