"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { useAuth } from "@/hooks/useAuth";
import { getFollowListPubkeys, publishMuteList } from "@/lib/nostr";
import { getErrorMessage } from "@/lib/utils/format";
import {
  Save,
  RefreshCw,
  Download,
  Upload,
  Archive,
  FolderOpen,
  VolumeX,
  Users,
} from "lucide-react";
import MuteListCategory from "./MuteListCategory";
import PrivacyControls from "./PrivacyControls";

type MuteTab = "profiles" | "words" | "tags" | "threads";

export default function MyMuteList() {
  const router = useRouter();
  const { session, reloadMuteList } = useAuth();
  const {
    muteList,
    muteListLoading,
    muteListError,
    hasUnsavedChanges,
    setHasUnsavedChanges,
    setActiveTab,
  } = useStore();

  const [subTab, setSubTab] = useState<MuteTab>("profiles");
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [mutedFollowCount, setMutedFollowCount] = useState<number | null>(null);

  // Count follows that are also muted, to surface the Decimator's muted purge
  useEffect(() => {
    let cancelled = false;
    const countMutedFollows = async () => {
      if (!session || muteListLoading || muteList.pubkeys.length === 0) return;
      try {
        const follows = await getFollowListPubkeys(
          session.pubkey,
          session.relays,
        );
        const muted = new Set(muteList.pubkeys.map((p) => p.value));
        const count = follows.filter((pubkey) => muted.has(pubkey)).length;
        if (!cancelled) setMutedFollowCount(count);
      } catch {
        // Stay hidden if the follow list can't be fetched
      }
    };
    countMutedFollows();
    return () => {
      cancelled = true;
    };
  }, [session, muteListLoading, muteList.pubkeys]);

  const handlePublish = async () => {
    if (!session) return;

    try {
      setPublishing(true);
      setPublishError(null);
      setPublishSuccess(false);

      await publishMuteList(muteList, session.relays);

      setHasUnsavedChanges(false);
      setPublishSuccess(true);

      // Clear success message after 3 seconds
      setTimeout(() => setPublishSuccess(false), 3000);
    } catch (error) {
      setPublishError(getErrorMessage(error, "Failed to publish mute list"));
    } finally {
      setPublishing(false);
    }
  };

  const handleDiscard = async () => {
    if (!session) return;

    if (
      confirm(
        "Are you sure you want to discard all unsaved changes? This will reload your mute list from Nostr.",
      )
    ) {
      try {
        await reloadMuteList();
      } catch (error) {
        console.error("Failed to reload mute list:", error);
      }
    }
  };

  const totalMutedItems =
    muteList.pubkeys.length +
    muteList.words.length +
    muteList.tags.length +
    muteList.threads.length;

  return (
    <div className="space-y-6 w-full max-w-full">
      {/* Header with Actions */}
      <div className="panel relative rounded-xl border border-line shadow-panel p-6 w-full max-w-full">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-bold text-2xl tracking-tight text-hi">
              My Mute List
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {muteList.pubkeys.length}{" "}
              {muteList.pubkeys.length === 1 ? "profile" : "profiles"}
              {muteList.words.length > 0 &&
                `, ${muteList.words.length} ${muteList.words.length === 1 ? "word" : "words"}`}
              {muteList.tags.length > 0 &&
                `, ${muteList.tags.length} ${muteList.tags.length === 1 ? "tag" : "tags"}`}
              {muteList.threads.length > 0 &&
                `, ${muteList.threads.length} ${muteList.threads.length === 1 ? "thread" : "threads"}`}
              {hasUnsavedChanges && (
                <span className="ml-2 text-amber-600 dark:text-amber-500">
                  (Unsaved changes)
                </span>
              )}
            </p>
          </div>

          <button
            onClick={() => setActiveTab("backups")}
            className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium w-full sm:w-auto"
          >
            <Archive size={18} />
            <span>Manage Backups</span>
          </button>
        </div>

        {/* Success/Error Messages */}
        {publishSuccess && (
          <div className="mt-4 p-3 bg-green-100 dark:bg-green-900 border border-green-400 dark:border-green-700 rounded text-green-700 dark:text-green-200 text-sm">
            Mute list saved successfully!
          </div>
        )}

        {publishError && (
          <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 rounded text-red-700 dark:text-red-200 text-sm">
            {publishError}
          </div>
        )}

        {muteListError && (
          <div className="mt-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-700 rounded text-red-700 dark:text-red-200 text-sm">
            {muteListError}
          </div>
        )}
      </div>

      {/* Muted follows notice */}
      {!muteListLoading &&
        mutedFollowCount !== null &&
        mutedFollowCount > 0 && (
          <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 flex flex-col sm:flex-row sm:items-center gap-3">
            <VolumeX className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <p className="flex-1 text-sm text-amber-900 dark:text-amber-100">
              You follow {mutedFollowCount}{" "}
              {mutedFollowCount === 1 ? "account that is" : "accounts that are"}{" "}
              on your mute list. Muteuals can review and unfollow them while
              keeping them muted.
            </p>
            <button
              onClick={() => {
                setActiveTab("muteuals");
                router.push("/dashboard?tab=muteuals&method=muted");
              }}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium text-sm w-full sm:w-auto flex-shrink-0"
            >
              <Users size={16} />
              Review in Muteuals
            </button>
          </div>
        )}

      {/* Loading State */}
      {muteListLoading && (
        <div className="panel relative rounded-xl border border-line shadow-panel p-12 text-center">
          <RefreshCw
            className="animate-spin mx-auto mb-3 text-gray-400"
            size={32}
          />
          <p className="text-gray-600 dark:text-gray-400">
            Loading mute list...
          </p>
        </div>
      )}

      {/* Privacy Controls */}
      {!muteListLoading && (
        <PrivacyControls
          onSelectCategory={(tab) => {
            setSubTab(tab);
            requestAnimationFrame(() =>
              document
                .getElementById("mute-subtabs")
                ?.scrollIntoView({ behavior: "smooth", block: "start" }),
            );
          }}
        />
      )}

      {/* Sub-tab Navigation */}
      {!muteListLoading && (
        <div
          id="mute-subtabs"
          className="border-b border-gray-200 dark:border-gray-700 overflow-x-auto scroll-mt-4"
        >
          <nav className="flex space-x-6 sm:space-x-8 whitespace-nowrap">
            {(
              [
                {
                  id: "profiles",
                  label: "Profiles",
                  n: muteList.pubkeys.length,
                },
                { id: "words", label: "Words", n: muteList.words.length },
                { id: "tags", label: "Hashtags", n: muteList.tags.length },
                { id: "threads", label: "Threads", n: muteList.threads.length },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSubTab(tab.id)}
                className={`py-3 px-1 border-b-2 font-semibold text-sm transition-colors ${
                  subTab === tab.id
                    ? "border-red-600 text-red-600 dark:border-red-500 dark:text-red-500"
                    : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
                }`}
              >
                {tab.label}
                <span className="ml-2 text-xs font-normal text-gray-400 dark:text-gray-500">
                  {tab.n}
                </span>
              </button>
            ))}
          </nav>
        </div>
      )}

      {/* Mute List Categories */}
      {!muteListLoading && subTab === "profiles" && (
        <MuteListCategory
          category="pubkeys"
          title="Muted Profiles"
          items={muteList.pubkeys}
          placeholder="Enter pubkey (hex or npub)"
        />
      )}

      {!muteListLoading && subTab === "words" && (
        <MuteListCategory
          category="words"
          title="Muted Words"
          items={muteList.words}
          placeholder="Enter word or phrase"
        />
      )}

      {!muteListLoading && subTab === "tags" && (
        <MuteListCategory
          category="tags"
          title="Muted Tags"
          items={muteList.tags}
          placeholder="Enter hashtag (without #)"
        />
      )}

      {!muteListLoading && subTab === "threads" && (
        <MuteListCategory
          category="threads"
          title="Muted Threads"
          items={muteList.threads}
          placeholder="Enter event ID (hex, note1..., or nevent1...)"
        />
      )}
    </div>
  );
}
