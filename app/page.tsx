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
import Hatchling from "@/components/Hatchling";
import {
  Lock,
  User,
  Loader2,
  Flag,
  Eraser,
  FileSearch,
  Sun,
  Moon,
  ArrowRight,
} from "lucide-react";
import {
  searchProfiles,
  hexToNpub,
  fetchEventById,
  DEFAULT_RELAYS,
} from "@/lib/nostr";
import {
  isDirectLookup,
  noUserFoundMessage,
  resolveLookupInput,
} from "@/lib/lookupInput";
import { Profile } from "@/types";
import ToolDirectory from "@/components/ToolDirectory";

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
  const { isConnected, session } = useAuth();
  const [theme, setTheme] = useTheme();
  // Where sign-in should land. "dossier" comes from the "Find your first
  // note" card: the repost button only exists on your own Dossier, so after
  // connecting we open it instead of the dashboard. The page stays mounted
  // through sign-in, so plain state carries this; whichever entry point was
  // clicked last decides.
  const [afterSignIn, setAfterSignIn] = useState<"dossier" | null>(null);

  useEffect(() => {
    if (!isConnected) return;
    if (afterSignIn === "dossier") {
      // Wait for the session's pubkey; this effect re-runs when it arrives.
      if (session?.pubkey) {
        router.push(`/dossier?npub=${hexToNpub(session.pubkey)}`);
      }
      return;
    }
    // Signed in, "/" is the home screen: every tool, one click away.
    router.push("/home");
  }, [isConnected, session?.pubkey, afterSignIn, router]);

  // Real-time profile search
  useEffect(() => {
    const searchUserProfiles = async () => {
      if (!searchQuery.trim()) {
        setProfileSearchResults([]);
        setShowProfileResults(false);
        return;
      }

      // Don't search for identifiers (npub, nprofile, nevent, hex, even a
      // pasted private key): they resolve directly, and a name search would
      // only send them to relays as a search term.
      if (isDirectLookup(searchQuery)) {
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
      const resolution = await resolveLookupInput(query, (id, relays) =>
        fetchEventById(id, relays.length ? relays : DEFAULT_RELAYS),
      );
      if (resolution.ok === false) {
        setLookupError(resolution.message);
        return;
      }
      let target: string;
      if (resolution.ok === true) {
        target = hexToNpub(resolution.pubkey);
      } else {
        const profiles = await searchProfiles(
          resolution.query,
          DEFAULT_RELAYS,
          10,
        );
        if (profiles.length === 0) {
          setLookupError(noUserFoundMessage(resolution.query));
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

  // "Find your first note": with a name or npub already typed, open that
  // Dossier (no sign-in needed, same as the lookup below). Otherwise the
  // visitor wants their own, so sign in and land on it.
  const handleFirstNote = () => {
    if (resolving) return;
    if (searchQuery.trim()) {
      setShowProfileResults(false);
      handleToolSearch("/dossier");
      return;
    }
    setAfterSignIn("dossier");
    setShowAuthModal(true);
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
              Back up, edit and share mute lists, plus account dossiers, zombie
              checks, DM forensics, public reports and event deletion.
            </p>
            <div className="mt-6">
              <button
                onClick={() => {
                  setAfterSignIn(null);
                  setShowAuthModal(true);
                }}
                className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-b from-primary to-primary-deep text-white rounded-[10px] font-semibold shadow-[0_4px_16px_-6px_rgb(220_38_38/0.55),inset_0_1px_0_rgb(255_255_255/0.25)] hover:shadow-[0_6px_22px_-6px_rgb(220_38_38/0.7),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-105 hover:-translate-y-px transition-all"
              >
                <Lock size={18} />
                Connect with Nostr
              </button>
            </div>
          </div>

          {/* First-note hook: the Dossier digs up a person's oldest surviving
              note, which they can repost as #MyFirstNote once signed in. With
              a name or npub already typed below, this opens that Dossier
              (no sign-in). Otherwise it signs the visitor in and lands them
              on their own Dossier, where the repost button lives. */}
          <div className="max-w-2xl mx-auto mt-8 animate-rise stagger-1">
            {/* The card is a container, not a button (a button can't hold
                another button). Clicks anywhere on it open the Dossier for
                mouse users; the arrow is the real, focusable control that
                keyboard and screen-reader users get. Its click bubbles up to
                the card's handler, so the action runs once. */}
            <div
              onClick={handleFirstNote}
              className={`group w-full panel relative rounded-xl border border-line shadow-panel p-4 sm:p-5 flex items-center gap-4 text-left hover:border-line-strong transition-colors ${
                resolving ? "opacity-70" : "cursor-pointer"
              }`}
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
              <button
                type="button"
                disabled={resolving}
                aria-label={
                  searchQuery.trim()
                    ? "Open the Dossier"
                    : "Connect with Nostr to find your first note"
                }
                title={
                  searchQuery.trim()
                    ? "Open the Dossier"
                    : "Connect with Nostr to find your first note"
                }
                className="flex-none h-10 w-10 sm:w-auto sm:px-4 sm:gap-2 rounded-[10px] bg-gradient-to-b from-primary to-primary-deep text-white text-sm font-semibold flex items-center justify-center shadow-[0_4px_16px_-6px_rgb(220_38_38/0.55),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-105 hover:-translate-y-px transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:opacity-70 disabled:pointer-events-none"
              >
                {/* Words on wider screens only; mobile keeps just the arrow.
                    Empty field signs in, a typed name or npub opens it. */}
                <span className="hidden sm:inline">
                  {searchQuery.trim() ? "Open" : "Connect"}
                </span>
                {resolving ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <ArrowRight
                    size={18}
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                )}
              </button>
            </div>
          </div>

          {/* Universal No-Sign-In Lookup — one field feeds every anonymous
              tool: resolve a name, NIP-05, or npub once, then pick the lens
              to open it in. */}
          <div className="max-w-2xl mx-auto mt-6 animate-rise stagger-2">
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
                        // Enter opens the Dossier, the default lens; the
                        // buttons below pick a different one.
                        if (e.key === "Enter") {
                          setShowProfileResults(false);
                          handleToolSearch("/dossier");
                        }
                      }}
                      onFocus={() => {
                        if (profileSearchResults.length > 0) {
                          setShowProfileResults(true);
                        }
                      }}
                      placeholder="npub, NIP-05, name or hex pubkey"
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
                Open the Dossier
              </button>

              {/* Lens buttons */}
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
                  title="Public reports filed about them and by them"
                  className={`${lensClass} bg-gradient-to-b from-orange-500 to-orange-700 shadow-[0_6px_18px_-8px_rgb(234_88_12/0.7),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-110`}
                >
                  <Flag size={16} />
                  Reportable
                </button>
                <button
                  onClick={() => handleToolSearch("/redactable")}
                  title="Their deletion requests and deleted posts"
                  className={`${lensClass} bg-gradient-to-b from-slate-600 to-slate-900 shadow-[0_6px_18px_-8px_rgb(15_23_42/0.8),inset_0_1px_0_rgb(255_255_255/0.18)] ring-1 ring-white/10 hover:brightness-125`}
                >
                  <Eraser size={16} />
                  Redactable
                </button>
              </div>

              {lookupError && (
                <p
                  role="alert"
                  className="mt-3 text-xs text-red-600 dark:text-red-400 [overflow-wrap:anywhere] [text-wrap:pretty]"
                >
                  {lookupError}
                </p>
              )}
            </section>
          </div>

          {/* Directory — everything the lookup above doesn't cover, grouped
              by whether a session is needed. */}
          <section className="max-w-4xl mx-auto mt-14 animate-rise stagger-2">
            <ToolDirectory onLookup={handleToolSearch} />
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
