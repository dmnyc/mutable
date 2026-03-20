"use client";

import { useState, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import {
  Shield,
  AlertTriangle,
  Check,
  X,
  Key,
  Eye,
  Loader2,
  Copy as CopyIcon,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
} from "lucide-react";
import { nip19 } from "nostr-tools";
import { NsecSigner } from "@/lib/signers/NsecSigner";
import {
  fetchSourceData,
  publishClonedProfile,
  publishClonedFollows,
  publishClonedMutes,
  publishClonedRelayList,
  publishClonedPinnedNotes,
  publishClonedBookmarks,
  publishClonedCommunities,
  publishClonedSearchRelays,
  publishClonedInterests,
  publishClonedEmojiLists,
  publishClonedDmRelays,
  CloneableData,
} from "@/lib/clonableService";
import { hexToNpub, DEFAULT_RELAYS } from "@/lib/nostr";
import { Profile } from "@/types";

type Step = "mode" | "input" | "preview" | "publishing" | "done";
type Mode = "nsec" | "npub";

interface PublishStatus {
  profile: "pending" | "publishing" | "success" | "error" | "skipped";
  follows: "pending" | "publishing" | "success" | "error" | "skipped";
  mutes: "pending" | "publishing" | "success" | "error" | "skipped";
  relays: "pending" | "publishing" | "success" | "error" | "skipped";
  pinnedNotes: "pending" | "publishing" | "success" | "error" | "skipped";
  bookmarks: "pending" | "publishing" | "success" | "error" | "skipped";
  communities: "pending" | "publishing" | "success" | "error" | "skipped";
  searchRelays: "pending" | "publishing" | "success" | "error" | "skipped";
  interests: "pending" | "publishing" | "success" | "error" | "skipped";
  emojiLists: "pending" | "publishing" | "success" | "error" | "skipped";
  dmRelays: "pending" | "publishing" | "success" | "error" | "skipped";
}

const INITIAL_SELECTED = {
  profile: true,
  follows: true,
  mutes: true,
  relays: true,
  pinnedNotes: true,
  bookmarks: true,
  communities: true,
  searchRelays: true,
  interests: true,
  emojiLists: true,
  dmRelays: true,
};

const INITIAL_PUBLISH_STATUS: PublishStatus = {
  profile: "pending",
  follows: "pending",
  mutes: "pending",
  relays: "pending",
  pinnedNotes: "pending",
  bookmarks: "pending",
  communities: "pending",
  searchRelays: "pending",
  interests: "pending",
  emojiLists: "pending",
  dmRelays: "pending",
};

export default function Clonable() {
  const { session } = useAuth();
  const [step, setStep] = useState<Step>("mode");
  const [mode, setMode] = useState<Mode | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [sourcePubkey, setSourcePubkey] = useState<string | null>(null);
  const [sourceProfile, setSourceProfile] = useState<Profile | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [cloneData, setCloneData] = useState<CloneableData | null>(null);
  const [selected, setSelected] = useState(INITIAL_SELECTED);
  const [publishStatus, setPublishStatus] = useState<PublishStatus>(INITIAL_PUBLISH_STATUS);
  const [publishErrors, setPublishErrors] = useState<Record<string, string>>({});
  const nsecSignerRef = useRef<NsecSigner | null>(null);

  // Destination nsec state (used when no session is active)
  const [destKeyInput, setDestKeyInput] = useState("");
  const [destInputError, setDestInputError] = useState<string | null>(null);
  const [destPubkey, setDestPubkey] = useState<string | null>(null);
  const destSignerRef = useRef<NsecSigner | null>(null);

  const reset = () => {
    if (nsecSignerRef.current) {
      nsecSignerRef.current.destroy();
      nsecSignerRef.current = null;
    }
    if (destSignerRef.current) {
      destSignerRef.current.destroy();
      destSignerRef.current = null;
    }
    setStep("mode");
    setMode(null);
    setKeyInput("");
    setInputError(null);
    setSourcePubkey(null);
    setSourceProfile(null);
    setFetching(false);
    setFetchError(null);
    setCloneData(null);
    setSelected(INITIAL_SELECTED);
    setPublishStatus(INITIAL_PUBLISH_STATUS);
    setPublishErrors({});
    setDestKeyInput("");
    setDestInputError(null);
    setDestPubkey(null);
  };

  const handleDestNsec = async () => {
    const trimmed = destKeyInput.trim();
    setDestInputError(null);
    if (!trimmed.startsWith("nsec1")) {
      setDestInputError("Please enter a valid nsec (starts with nsec1)");
      return;
    }
    try {
      const signer = NsecSigner.fromNsec(trimmed);
      const pubkey = await signer.getPublicKey();
      destSignerRef.current = signer;
      setDestPubkey(pubkey);
      setDestKeyInput("");
    } catch {
      setDestInputError("Invalid nsec. Please check and try again.");
    }
  };

  const handleModeSelect = (selectedMode: Mode) => {
    setMode(selectedMode);
    setStep("input");
  };

  const validateAndParseKey = (input: string): { pubkey: string; signer?: NsecSigner } | null => {
    const trimmed = input.trim();
    setInputError(null);

    try {
      if (mode === "nsec") {
        if (!trimmed.startsWith("nsec1")) {
          setInputError("Please enter a valid nsec (starts with nsec1)");
          return null;
        }
        const signer = NsecSigner.fromNsec(trimmed);
        // We need to get the pubkey synchronously for validation display,
        // but getPublicKey is async. We'll handle this in fetchData.
        return { pubkey: "", signer };
      } else {
        if (!trimmed.startsWith("npub1") && !trimmed.startsWith("nprofile1")) {
          setInputError("Please enter a valid npub (starts with npub1)");
          return null;
        }
        const decoded = nip19.decode(trimmed);
        let pubkey: string;
        if (decoded.type === "npub") {
          pubkey = decoded.data;
        } else if (decoded.type === "nprofile") {
          pubkey = decoded.data.pubkey;
        } else {
          setInputError("Invalid format. Please enter an npub or nprofile.");
          return null;
        }
        return { pubkey };
      }
    } catch {
      setInputError(
        mode === "nsec"
          ? "Invalid nsec. Please check and try again."
          : "Invalid npub. Please check and try again.",
      );
      return null;
    }
  };

  const handleFetchData = async () => {
    const result = validateAndParseKey(keyInput);
    if (!result) return;

    setFetching(true);
    setFetchError(null);

    try {
      let pubkey = result.pubkey;
      let signer = result.signer;

      // For nsec mode, get the pubkey from the signer
      if (signer) {
        pubkey = await signer.getPublicKey();
        nsecSignerRef.current = signer;
      }

      // Check that source is different from logged-in or destination account
      if (session && pubkey === session.pubkey) {
        setFetchError("The source account is the same as your logged-in account. Please enter a different key.");
        setFetching(false);
        return;
      }
      if (!session && destPubkey && pubkey === destPubkey) {
        setFetchError("The source account is the same as the destination account. Please enter a different key.");
        setFetching(false);
        return;
      }

      setSourcePubkey(pubkey);

      // Fetch all data
      const data = await fetchSourceData(pubkey, signer || undefined);
      setCloneData(data);

      if (data.profile) {
        setSourceProfile(data.profile.parsed);
      }

      setStep("preview");
    } catch (error) {
      setFetchError(
        error instanceof Error
          ? error.message
          : "Failed to fetch data from source account",
      );
    } finally {
      setFetching(false);
    }
  };

  const handlePublish = async () => {
    if (!cloneData) return;
    if (!session && !destSignerRef.current) return;

    setStep("publishing");
    const destinationSigner = destSignerRef.current ?? undefined;
    const relays = session?.relays ?? DEFAULT_RELAYS;
    const errors: Record<string, string> = {};

    // Profile
    if (selected.profile && cloneData.profile) {
      setPublishStatus((prev) => ({ ...prev, profile: "publishing" }));
      try {
        await publishClonedProfile(cloneData.profile.rawContent, relays, destinationSigner);
        setPublishStatus((prev) => ({ ...prev, profile: "success" }));
      } catch (error) {
        errors.profile = error instanceof Error ? error.message : "Failed";
        setPublishStatus((prev) => ({ ...prev, profile: "error" }));
      }
      await delay(500);
    } else {
      setPublishStatus((prev) => ({ ...prev, profile: "skipped" }));
    }

    // Follows
    if (selected.follows && cloneData.followList) {
      setPublishStatus((prev) => ({ ...prev, follows: "publishing" }));
      try {
        await publishClonedFollows(
          cloneData.followList,
          relays,
          cloneData.followListContent,
          destinationSigner,
        );
        setPublishStatus((prev) => ({ ...prev, follows: "success" }));
      } catch (error) {
        errors.follows = error instanceof Error ? error.message : "Failed";
        setPublishStatus((prev) => ({ ...prev, follows: "error" }));
      }
      await delay(500);
    } else {
      setPublishStatus((prev) => ({ ...prev, follows: "skipped" }));
    }

    // Mutes
    if (selected.mutes && cloneData.muteList) {
      setPublishStatus((prev) => ({ ...prev, mutes: "publishing" }));
      try {
        await publishClonedMutes(cloneData.muteList, relays, destinationSigner);
        setPublishStatus((prev) => ({ ...prev, mutes: "success" }));
      } catch (error) {
        errors.mutes = error instanceof Error ? error.message : "Failed";
        setPublishStatus((prev) => ({ ...prev, mutes: "error" }));
      }
      await delay(500);
    } else {
      setPublishStatus((prev) => ({ ...prev, mutes: "skipped" }));
    }

    // Relays
    if (selected.relays && cloneData.relayList) {
      setPublishStatus((prev) => ({ ...prev, relays: "publishing" }));
      try {
        await publishClonedRelayList(cloneData.relayList, relays, destinationSigner);
        setPublishStatus((prev) => ({ ...prev, relays: "success" }));
      } catch (error) {
        errors.relays = error instanceof Error ? error.message : "Failed";
        setPublishStatus((prev) => ({ ...prev, relays: "error" }));
      }
      await delay(500);
    } else {
      setPublishStatus((prev) => ({ ...prev, relays: "skipped" }));
    }

    // Pinned Notes
    if (selected.pinnedNotes && cloneData.pinnedNotes) {
      setPublishStatus((prev) => ({ ...prev, pinnedNotes: "publishing" }));
      try {
        await publishClonedPinnedNotes(cloneData.pinnedNotes, relays, destinationSigner);
        setPublishStatus((prev) => ({ ...prev, pinnedNotes: "success" }));
      } catch (error) {
        errors.pinnedNotes = error instanceof Error ? error.message : "Failed";
        setPublishStatus((prev) => ({ ...prev, pinnedNotes: "error" }));
      }
      await delay(500);
    } else {
      setPublishStatus((prev) => ({ ...prev, pinnedNotes: "skipped" }));
    }

    // Bookmarks
    if (selected.bookmarks && cloneData.bookmarks) {
      setPublishStatus((prev) => ({ ...prev, bookmarks: "publishing" }));
      try {
        await publishClonedBookmarks(cloneData.bookmarks, relays, destinationSigner);
        setPublishStatus((prev) => ({ ...prev, bookmarks: "success" }));
      } catch (error) {
        errors.bookmarks = error instanceof Error ? error.message : "Failed";
        setPublishStatus((prev) => ({ ...prev, bookmarks: "error" }));
      }
      await delay(500);
    } else {
      setPublishStatus((prev) => ({ ...prev, bookmarks: "skipped" }));
    }

    // Communities
    if (selected.communities && cloneData.communities) {
      setPublishStatus((prev) => ({ ...prev, communities: "publishing" }));
      try {
        await publishClonedCommunities(cloneData.communities, relays, destinationSigner);
        setPublishStatus((prev) => ({ ...prev, communities: "success" }));
      } catch (error) {
        errors.communities = error instanceof Error ? error.message : "Failed";
        setPublishStatus((prev) => ({ ...prev, communities: "error" }));
      }
      await delay(500);
    } else {
      setPublishStatus((prev) => ({ ...prev, communities: "skipped" }));
    }

    // Search Relays
    if (selected.searchRelays && cloneData.searchRelays) {
      setPublishStatus((prev) => ({ ...prev, searchRelays: "publishing" }));
      try {
        await publishClonedSearchRelays(cloneData.searchRelays, relays, destinationSigner);
        setPublishStatus((prev) => ({ ...prev, searchRelays: "success" }));
      } catch (error) {
        errors.searchRelays = error instanceof Error ? error.message : "Failed";
        setPublishStatus((prev) => ({ ...prev, searchRelays: "error" }));
      }
      await delay(500);
    } else {
      setPublishStatus((prev) => ({ ...prev, searchRelays: "skipped" }));
    }

    // Interests
    if (selected.interests && cloneData.interests) {
      setPublishStatus((prev) => ({ ...prev, interests: "publishing" }));
      try {
        await publishClonedInterests(cloneData.interests, relays, destinationSigner);
        setPublishStatus((prev) => ({ ...prev, interests: "success" }));
      } catch (error) {
        errors.interests = error instanceof Error ? error.message : "Failed";
        setPublishStatus((prev) => ({ ...prev, interests: "error" }));
      }
      await delay(500);
    } else {
      setPublishStatus((prev) => ({ ...prev, interests: "skipped" }));
    }

    // Emoji Lists
    if (selected.emojiLists && cloneData.emojiLists) {
      setPublishStatus((prev) => ({ ...prev, emojiLists: "publishing" }));
      try {
        await publishClonedEmojiLists(cloneData.emojiLists, relays, destinationSigner);
        setPublishStatus((prev) => ({ ...prev, emojiLists: "success" }));
      } catch (error) {
        errors.emojiLists = error instanceof Error ? error.message : "Failed";
        setPublishStatus((prev) => ({ ...prev, emojiLists: "error" }));
      }
      await delay(500);
    } else {
      setPublishStatus((prev) => ({ ...prev, emojiLists: "skipped" }));
    }

    // DM Relays
    if (selected.dmRelays && cloneData.dmRelays) {
      setPublishStatus((prev) => ({ ...prev, dmRelays: "publishing" }));
      try {
        await publishClonedDmRelays(cloneData.dmRelays, relays, destinationSigner);
        setPublishStatus((prev) => ({ ...prev, dmRelays: "success" }));
      } catch (error) {
        errors.dmRelays = error instanceof Error ? error.message : "Failed";
        setPublishStatus((prev) => ({ ...prev, dmRelays: "error" }));
      }
    } else {
      setPublishStatus((prev) => ({ ...prev, dmRelays: "skipped" }));
    }

    setPublishErrors(errors);

    // Destroy signers
    if (nsecSignerRef.current) {
      nsecSignerRef.current.destroy();
      nsecSignerRef.current = null;
    }
    if (destSignerRef.current) {
      destSignerRef.current.destroy();
      destSignerRef.current = null;
    }

    setStep("done");
  };

  const totalMuteCount = cloneData?.muteList
    ? cloneData.muteList.pubkeys.length +
      cloneData.muteList.words.length +
      cloneData.muteList.tags.length +
      cloneData.muteList.threads.length
    : 0;

  const privateMuteCount = cloneData?.muteList
    ? cloneData.muteList.pubkeys.filter((m) => m.private).length +
      cloneData.muteList.words.filter((m) => m.private).length +
      cloneData.muteList.tags.filter((m) => m.private).length +
      cloneData.muteList.threads.filter((m) => m.private).length
    : 0;

  const totalRelayCount = cloneData?.relayList
    ? cloneData.relayList.read.length +
      cloneData.relayList.write.length +
      cloneData.relayList.both.length
    : 0;

  const hasAnythingToClone =
    cloneData &&
    (cloneData.profile ||
      (cloneData.followList && cloneData.followList.length > 0) ||
      (cloneData.muteList && totalMuteCount > 0) ||
      (cloneData.relayList && totalRelayCount > 0) ||
      cloneData.pinnedNotes ||
      cloneData.bookmarks ||
      cloneData.communities ||
      cloneData.searchRelays ||
      cloneData.interests ||
      cloneData.emojiLists ||
      cloneData.dmRelays);

  const hasAnythingSelected =
    (selected.profile && cloneData?.profile) ||
    (selected.follows && cloneData?.followList && cloneData.followList.length > 0) ||
    (selected.mutes && cloneData?.muteList && totalMuteCount > 0) ||
    (selected.relays && cloneData?.relayList && totalRelayCount > 0) ||
    (selected.pinnedNotes && cloneData?.pinnedNotes) ||
    (selected.bookmarks && cloneData?.bookmarks) ||
    (selected.communities && cloneData?.communities) ||
    (selected.searchRelays && cloneData?.searchRelays) ||
    (selected.interests && cloneData?.interests) ||
    (selected.emojiLists && cloneData?.emojiLists) ||
    (selected.dmRelays && cloneData?.dmRelays);

  // When no session and no destination nsec confirmed, show dest nsec input
  if (!session && !destPubkey) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <ClonableIcon className="w-8 h-8 text-red-600 dark:text-red-400" />
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Clonable
            </h1>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Migrate your profile, follows, mutes, and relays from another account
            to your current keyset. Useful when recovering from a compromised key.
          </p>
        </div>

        <div className="space-y-6">
          <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <div className="flex items-start gap-3">
              <AlertTriangle
                size={20}
                className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0"
              />
              <div className="text-sm text-amber-800 dark:text-amber-300">
                <p className="font-semibold mb-1">Security Notice</p>
                <p>
                  Your destination nsec will be held in memory only during this
                  operation and cleared immediately after. It is never stored or
                  transmitted. Only enter your nsec if you trust this application.
                </p>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Enter destination account nsec
            </label>
            <input
              type="password"
              value={destKeyInput}
              onChange={(e) => {
                setDestKeyInput(e.target.value);
                setDestInputError(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && handleDestNsec()}
              placeholder="nsec1..."
              className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-red-500 focus:border-transparent font-mono text-sm"
              autoComplete="off"
              spellCheck={false}
            />
            {destInputError && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                {destInputError}
              </p>
            )}
          </div>

          <button
            onClick={handleDestNsec}
            disabled={!destKeyInput.trim()}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 text-white font-semibold transition-colors"
          >
            Confirm Destination
            <ArrowRight size={20} />
          </button>

          <p className="text-center text-sm text-gray-500 dark:text-gray-400">
            You can also sign in with a browser extension or remote signer for a smoother experience.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <ClonableIcon className="w-8 h-8 text-red-600 dark:text-red-400" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Clonable
          </h1>
        </div>
        <p className="text-gray-600 dark:text-gray-400">
          Migrate your profile, follows, mutes, and relays from another account
          to your current keyset. Useful when recovering from a compromised key.
        </p>
      </div>

      {/* Destination account indicator (when using nsec instead of session) */}
      {destPubkey && !session && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 mb-6">
          <Key size={16} className="text-red-600 dark:text-red-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-gray-500 dark:text-gray-400">Destination account</p>
            <p className="text-sm font-mono text-gray-700 dark:text-gray-300 truncate">
              {hexToNpub(destPubkey)}
            </p>
          </div>
        </div>
      )}

      {/* Step: Mode Selection */}
      {step === "mode" && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            How would you like to clone?
          </h2>

          <button
            onClick={() => handleModeSelect("nsec")}
            className="w-full p-6 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-red-400 dark:hover:border-red-500 transition-colors text-left group"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">
                <Key size={24} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white group-hover:text-red-600 dark:group-hover:text-red-400">
                  I have the nsec (full clone)
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Enter the compromised nsec to clone everything, including
                  encrypted private mutes. The nsec is held in memory only and
                  cleared immediately after.
                </p>
              </div>
            </div>
          </button>

          <button
            onClick={() => handleModeSelect("npub")}
            className="w-full p-6 rounded-xl border-2 border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 transition-colors text-left group"
          >
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
                <Eye size={24} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400">
                  I only have the npub (public data only)
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Enter an npub to clone publicly visible data: profile, follows,
                  public mutes, and relays. Private mutes cannot be included.
                </p>
              </div>
            </div>
          </button>
        </div>
      )}

      {/* Step: Key Input */}
      {step === "input" && (
        <div className="space-y-6">
          <button
            onClick={() => {
              setStep("mode");
              setKeyInput("");
              setInputError(null);
              setFetchError(null);
            }}
            className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          >
            <ArrowLeft size={16} />
            Back
          </button>

          {/* Security warning for nsec mode */}
          {mode === "nsec" && (
            <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <div className="flex items-start gap-3">
                <AlertTriangle
                  size={20}
                  className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0"
                />
                <div className="text-sm text-amber-800 dark:text-amber-300">
                  <p className="font-semibold mb-1">Security Notice</p>
                  <p>
                    Your nsec will be held in memory only during this operation
                    and cleared immediately after. It is never stored or
                    transmitted. Only enter your nsec if you trust this
                    application.
                  </p>
                </div>
              </div>
            </div>
          )}

          {mode === "npub" && (
            <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
              <div className="flex items-start gap-3">
                <Eye
                  size={20}
                  className="text-blue-600 dark:text-blue-400 mt-0.5 shrink-0"
                />
                <div className="text-sm text-blue-800 dark:text-blue-300">
                  <p>
                    Without the nsec, only publicly visible data can be cloned.
                    Private/encrypted mutes will not be included.
                  </p>
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Enter the source account&apos;s{" "}
              {mode === "nsec" ? "nsec" : "npub"}
            </label>
            <input
              type={mode === "nsec" ? "password" : "text"}
              value={keyInput}
              onChange={(e) => {
                setKeyInput(e.target.value);
                setInputError(null);
                setFetchError(null);
              }}
              placeholder={
                mode === "nsec" ? "nsec1..." : "npub1... or nprofile1..."
              }
              className="w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-red-500 focus:border-transparent font-mono text-sm"
              autoComplete="off"
              spellCheck={false}
            />
            {inputError && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                {inputError}
              </p>
            )}
          </div>

          {fetchError && (
            <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
              <div className="flex items-start gap-3">
                <X
                  size={20}
                  className="text-red-600 dark:text-red-400 mt-0.5 shrink-0"
                />
                <p className="text-sm text-red-800 dark:text-red-300">
                  {fetchError}
                </p>
              </div>
            </div>
          )}

          <button
            onClick={handleFetchData}
            disabled={!keyInput.trim() || fetching}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 text-white font-semibold transition-colors"
          >
            {fetching ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                Fetching data...
              </>
            ) : (
              <>
                Fetch Data
                <ArrowRight size={20} />
              </>
            )}
          </button>
        </div>
      )}

      {/* Step: Preview + Selection */}
      {step === "preview" && cloneData && (
        <div className="space-y-6">
          <button
            onClick={() => {
              setStep("input");
              setCloneData(null);
            }}
            className="flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          >
            <ArrowLeft size={16} />
            Back
          </button>

          {/* Source account info */}
          {sourceProfile && sourcePubkey && (
            <div className="flex items-center gap-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-700/50">
              {sourceProfile.picture && (
                <img
                  src={sourceProfile.picture}
                  alt=""
                  className="w-12 h-12 rounded-full object-cover"
                />
              )}
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 dark:text-white truncate">
                  {sourceProfile.display_name ||
                    sourceProfile.name ||
                    "Unknown"}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate">
                  {hexToNpub(sourcePubkey)}
                </p>
              </div>
            </div>
          )}

          {/* Warning */}
          <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
            <div className="flex items-start gap-3">
              <AlertTriangle
                size={20}
                className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0"
              />
              <div className="text-sm text-amber-800 dark:text-amber-300">
                <p className="font-semibold mb-1">This will replace your current data</p>
                <p>
                  Cloning will overwrite your existing profile, follows, mutes,
                  and/or relay list on the currently logged-in account. Consider
                  creating a backup first.
                </p>
              </div>
            </div>
          </div>

          {!hasAnythingToClone && (
            <div className="p-6 text-center rounded-lg bg-gray-50 dark:bg-gray-700/50">
              <p className="text-gray-500 dark:text-gray-400">
                No data found for this account. The account may be empty or the
                relays may be unreachable.
              </p>
            </div>
          )}

          {hasAnythingToClone && (
            <>
              {/* Data selection */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                  Select data to clone
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

                {/* Profile */}
                <label
                  className={`sm:col-span-2 flex items-center gap-4 p-4 rounded-lg border transition-colors cursor-pointer ${
                    cloneData.profile
                      ? "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                      : "border-gray-100 dark:border-gray-800 opacity-50 cursor-not-allowed"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.profile}
                    disabled={!cloneData.profile}
                    onChange={(e) =>
                      setSelected((prev) => ({
                        ...prev,
                        profile: e.target.checked,
                      }))
                    }
                    className="w-5 h-5 rounded text-red-600 focus:ring-red-500"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 dark:text-white">
                      Profile
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {cloneData.profile
                        ? `${cloneData.profile.parsed.display_name || cloneData.profile.parsed.name || "Unnamed"} - name, picture, about, etc.`
                        : "No profile found"}
                    </p>
                  </div>
                </label>

                {/* Follows */}
                <label
                  className={`flex items-center gap-4 p-4 rounded-lg border transition-colors cursor-pointer ${
                    cloneData.followList && cloneData.followList.length > 0
                      ? "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                      : "border-gray-100 dark:border-gray-800 opacity-50 cursor-not-allowed"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.follows}
                    disabled={
                      !cloneData.followList || cloneData.followList.length === 0
                    }
                    onChange={(e) =>
                      setSelected((prev) => ({
                        ...prev,
                        follows: e.target.checked,
                      }))
                    }
                    className="w-5 h-5 rounded text-red-600 focus:ring-red-500"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 dark:text-white">
                      Follow List
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {cloneData.followList && cloneData.followList.length > 0
                        ? `${cloneData.followList.length.toLocaleString()} contacts`
                        : "No follow list found"}
                    </p>
                  </div>
                </label>

                {/* Mutes */}
                <label
                  className={`flex items-center gap-4 p-4 rounded-lg border transition-colors cursor-pointer ${
                    totalMuteCount > 0
                      ? "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                      : "border-gray-100 dark:border-gray-800 opacity-50 cursor-not-allowed"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.mutes}
                    disabled={totalMuteCount === 0}
                    onChange={(e) =>
                      setSelected((prev) => ({
                        ...prev,
                        mutes: e.target.checked,
                      }))
                    }
                    className="w-5 h-5 rounded text-red-600 focus:ring-red-500"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 dark:text-white">
                      Mute List
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {totalMuteCount > 0 ? (
                        <>
                          {totalMuteCount} items
                          {privateMuteCount > 0 && (
                            <span className="text-amber-600 dark:text-amber-400">
                              {" "}
                              ({privateMuteCount} private)
                            </span>
                          )}
                          {cloneData.muteListHasPrivate &&
                            privateMuteCount === 0 &&
                            mode === "npub" && (
                              <span className="text-amber-600 dark:text-amber-400">
                                {" "}
                                (private mutes not included - nsec required)
                              </span>
                            )}
                        </>
                      ) : (
                        "No mute list found"
                      )}
                    </p>
                  </div>
                </label>

                {/* Relays */}
                <label
                  className={`flex items-center gap-4 p-4 rounded-lg border transition-colors cursor-pointer ${
                    totalRelayCount > 0
                      ? "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                      : "border-gray-100 dark:border-gray-800 opacity-50 cursor-not-allowed"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.relays}
                    disabled={totalRelayCount === 0}
                    onChange={(e) =>
                      setSelected((prev) => ({
                        ...prev,
                        relays: e.target.checked,
                      }))
                    }
                    className="w-5 h-5 rounded text-red-600 focus:ring-red-500"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 dark:text-white">
                      Relay List
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {totalRelayCount > 0
                        ? `${totalRelayCount} relays`
                        : "No relay list found"}
                    </p>
                  </div>
                </label>

                {/* Pinned Notes */}
                <label
                  className={`flex items-center gap-4 p-4 rounded-lg border transition-colors cursor-pointer ${
                    cloneData.pinnedNotes
                      ? "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                      : "border-gray-100 dark:border-gray-800 opacity-50 cursor-not-allowed"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.pinnedNotes}
                    disabled={!cloneData.pinnedNotes}
                    onChange={(e) =>
                      setSelected((prev) => ({
                        ...prev,
                        pinnedNotes: e.target.checked,
                      }))
                    }
                    className="w-5 h-5 rounded text-red-600 focus:ring-red-500"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 dark:text-white">
                      Pinned Notes
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {cloneData.pinnedNotes
                        ? `${cloneData.pinnedNotes.tags.length} items`
                        : "No pinned notes found"}
                    </p>
                  </div>
                </label>

                {/* Bookmarks */}
                <label
                  className={`flex items-center gap-4 p-4 rounded-lg border transition-colors cursor-pointer ${
                    cloneData.bookmarks
                      ? "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                      : "border-gray-100 dark:border-gray-800 opacity-50 cursor-not-allowed"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.bookmarks}
                    disabled={!cloneData.bookmarks}
                    onChange={(e) =>
                      setSelected((prev) => ({
                        ...prev,
                        bookmarks: e.target.checked,
                      }))
                    }
                    className="w-5 h-5 rounded text-red-600 focus:ring-red-500"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 dark:text-white">
                      Bookmarks
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {cloneData.bookmarks
                        ? `${cloneData.bookmarks.tags.length} items`
                        : "No bookmarks found"}
                    </p>
                  </div>
                </label>

                {/* Communities */}
                <label
                  className={`flex items-center gap-4 p-4 rounded-lg border transition-colors cursor-pointer ${
                    cloneData.communities
                      ? "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                      : "border-gray-100 dark:border-gray-800 opacity-50 cursor-not-allowed"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.communities}
                    disabled={!cloneData.communities}
                    onChange={(e) =>
                      setSelected((prev) => ({
                        ...prev,
                        communities: e.target.checked,
                      }))
                    }
                    className="w-5 h-5 rounded text-red-600 focus:ring-red-500"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 dark:text-white">
                      Communities
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {cloneData.communities
                        ? `${cloneData.communities.tags.length} items`
                        : "No communities found"}
                    </p>
                  </div>
                </label>

                {/* Search Relays */}
                <label
                  className={`flex items-center gap-4 p-4 rounded-lg border transition-colors cursor-pointer ${
                    cloneData.searchRelays
                      ? "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                      : "border-gray-100 dark:border-gray-800 opacity-50 cursor-not-allowed"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.searchRelays}
                    disabled={!cloneData.searchRelays}
                    onChange={(e) =>
                      setSelected((prev) => ({
                        ...prev,
                        searchRelays: e.target.checked,
                      }))
                    }
                    className="w-5 h-5 rounded text-red-600 focus:ring-red-500"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 dark:text-white">
                      Search Relays
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {cloneData.searchRelays
                        ? `${cloneData.searchRelays.tags.length} relays`
                        : "No search relays found"}
                    </p>
                  </div>
                </label>

                {/* Interests */}
                <label
                  className={`flex items-center gap-4 p-4 rounded-lg border transition-colors cursor-pointer ${
                    cloneData.interests
                      ? "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                      : "border-gray-100 dark:border-gray-800 opacity-50 cursor-not-allowed"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.interests}
                    disabled={!cloneData.interests}
                    onChange={(e) =>
                      setSelected((prev) => ({
                        ...prev,
                        interests: e.target.checked,
                      }))
                    }
                    className="w-5 h-5 rounded text-red-600 focus:ring-red-500"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 dark:text-white">
                      Interests
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {cloneData.interests
                        ? `${cloneData.interests.tags.length} items`
                        : "No interests found"}
                    </p>
                  </div>
                </label>

                {/* Emoji Lists */}
                <label
                  className={`flex items-center gap-4 p-4 rounded-lg border transition-colors cursor-pointer ${
                    cloneData.emojiLists
                      ? "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                      : "border-gray-100 dark:border-gray-800 opacity-50 cursor-not-allowed"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.emojiLists}
                    disabled={!cloneData.emojiLists}
                    onChange={(e) =>
                      setSelected((prev) => ({
                        ...prev,
                        emojiLists: e.target.checked,
                      }))
                    }
                    className="w-5 h-5 rounded text-red-600 focus:ring-red-500"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 dark:text-white">
                      Emoji Lists
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {cloneData.emojiLists
                        ? `${cloneData.emojiLists.tags.length} items`
                        : "No emoji lists found"}
                    </p>
                  </div>
                </label>

                {/* DM Relays */}
                <label
                  className={`flex items-center gap-4 p-4 rounded-lg border transition-colors cursor-pointer ${
                    cloneData.dmRelays
                      ? "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                      : "border-gray-100 dark:border-gray-800 opacity-50 cursor-not-allowed"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.dmRelays}
                    disabled={!cloneData.dmRelays}
                    onChange={(e) =>
                      setSelected((prev) => ({
                        ...prev,
                        dmRelays: e.target.checked,
                      }))
                    }
                    className="w-5 h-5 rounded text-red-600 focus:ring-red-500"
                  />
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 dark:text-white">
                      DM Relays
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {cloneData.dmRelays
                        ? `${cloneData.dmRelays.tags.length} relays`
                        : "No DM relays found"}
                    </p>
                  </div>
                </label>
                </div>
              </div>

              {/* Clone button */}
              <button
                onClick={handlePublish}
                disabled={!hasAnythingSelected}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-red-600 hover:bg-red-700 disabled:bg-gray-400 dark:disabled:bg-gray-600 text-white font-semibold transition-colors"
              >
                <CopyIcon size={20} />
                Clone Selected Data
              </button>
            </>
          )}
        </div>
      )}

      {/* Step: Publishing */}
      {(step === "publishing" || step === "done") && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <PublishRow
                label="Profile"
                status={publishStatus.profile}
                error={publishErrors.profile}
              />
            </div>
            <PublishRow
              label="Follow List"
              status={publishStatus.follows}
              error={publishErrors.follows}
            />
            <PublishRow
              label="Mute List"
              status={publishStatus.mutes}
              error={publishErrors.mutes}
            />
            <PublishRow
              label="Relay List"
              status={publishStatus.relays}
              error={publishErrors.relays}
            />
            <PublishRow
              label="Pinned Notes"
              status={publishStatus.pinnedNotes}
              error={publishErrors.pinnedNotes}
            />
            <PublishRow
              label="Bookmarks"
              status={publishStatus.bookmarks}
              error={publishErrors.bookmarks}
            />
            <PublishRow
              label="Communities"
              status={publishStatus.communities}
              error={publishErrors.communities}
            />
            <PublishRow
              label="Search Relays"
              status={publishStatus.searchRelays}
              error={publishErrors.searchRelays}
            />
            <PublishRow
              label="Interests"
              status={publishStatus.interests}
              error={publishErrors.interests}
            />
            <PublishRow
              label="Emoji Lists"
              status={publishStatus.emojiLists}
              error={publishErrors.emojiLists}
            />
            <PublishRow
              label="DM Relays"
              status={publishStatus.dmRelays}
              error={publishErrors.dmRelays}
            />
          </div>

          {step === "done" && (
            <div className="space-y-4">
              {Object.keys(publishErrors).length === 0 ? (
                <div className="p-4 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                  <div className="flex items-center gap-3">
                    <Check
                      size={20}
                      className="text-green-600 dark:text-green-400"
                    />
                    <p className="text-sm font-medium text-green-800 dark:text-green-300">
                      Clone complete! Your data has been migrated successfully.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                  <div className="flex items-center gap-3">
                    <AlertTriangle
                      size={20}
                      className="text-amber-600 dark:text-amber-400"
                    />
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      Clone completed with some errors. Check the details above.
                    </p>
                  </div>
                </div>
              )}

              {(mode === "nsec" || destPubkey) && (
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                  <div className="flex items-center gap-2">
                    <Shield
                      size={16}
                      className="text-green-600 dark:text-green-400"
                    />
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {mode === "nsec" && destPubkey
                        ? "Both nsecs have been cleared from memory."
                        : mode === "nsec"
                          ? "The source nsec has been cleared from memory."
                          : "The destination nsec has been cleared from memory."}
                    </p>
                  </div>
                </div>
              )}

              <button
                onClick={reset}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 font-semibold transition-colors"
              >
                <RefreshCw size={18} />
                Start Over
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PublishRow({
  label,
  status,
  error,
}: {
  label: string;
  status: "pending" | "publishing" | "success" | "error" | "skipped";
  error?: string;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
      <div className="w-6 h-6 flex items-center justify-center">
        {status === "pending" && (
          <div className="w-3 h-3 rounded-full bg-gray-300 dark:bg-gray-600" />
        )}
        {status === "publishing" && (
          <Loader2
            size={20}
            className="text-red-600 dark:text-red-400 animate-spin"
          />
        )}
        {status === "success" && (
          <Check size={20} className="text-green-600 dark:text-green-400" />
        )}
        {status === "error" && (
          <X size={20} className="text-red-600 dark:text-red-400" />
        )}
        {status === "skipped" && (
          <div className="w-3 h-3 rounded-full bg-gray-200 dark:bg-gray-700" />
        )}
      </div>
      <div className="flex-1">
        <p
          className={`text-sm font-medium ${
            status === "skipped"
              ? "text-gray-400 dark:text-gray-500"
              : "text-gray-900 dark:text-white"
          }`}
        >
          {label}
          {status === "skipped" && (
            <span className="font-normal text-gray-400 dark:text-gray-500">
              {" "}
              - skipped
            </span>
          )}
        </p>
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function ClonableIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Left face */}
      <circle cx="5.5" cy="7" r="2.5" />
      <path d="M0.5 18c0-2.8 2.2-5 5-5" />
      {/* Right face */}
      <circle cx="18.5" cy="7" r="2.5" />
      <path d="M23.5 18c0-2.8-2.2-5-5-5" />
      {/* Arrow between them */}
      <path d="M9.5 12h5" />
      <path d="M13 10l1.5 2-1.5 2" />
    </svg>
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
