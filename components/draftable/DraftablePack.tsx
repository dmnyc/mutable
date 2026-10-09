"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  Pencil,
  PartyPopper,
  Share2,
  UserCheck,
  UserPlus,
  UsersRound,
  VolumeX,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store";
import { Profile } from "@/types";
import { copyToClipboard } from "@/lib/utils/clipboard";
import { getDisplayName, getErrorMessage, truncateNpub } from "@/lib/utils/format";
import { getProfileLink } from "@/lib/utils/links";
import { hexToNpub } from "@/lib/nostr";
import {
  FollowPack,
  conscriptCount,
  isDrafted,
  packNaddr,
  packPath,
  relativeTime,
} from "@/lib/draftable/pack";
import {
  MissingFollowListError,
  draftableRelays,
  fetchFollowing,
  fetchPack,
  followPubkeys,
  unfollowPubkeys,
} from "@/lib/draftable/service";
import { PackShareRole, packShareMessage } from "@/lib/draftable/share";
import ProfileAvatar from "../ProfileAvatar";
import UserProfileModal from "../UserProfileModal";
import { useRequestSignIn } from "./DraftableShell";
import { AuthorNotice, BystanderNotice, DraftedNotice } from "./NoExit";
import PackPosts from "./PackPosts";
import ShareModal from "./ShareModal";
import { useProfiles } from "./useProfiles";

type Tab = "conscripts" | "posts";

const MISSING_FOLLOW_LIST_PROMPT =
  "We couldn't find your current follow list on your relays.\n\n" +
  "If you continue, your follow list will be replaced by one containing only " +
  "the people you're following now. Anyone you already follow on other " +
  "relays would be dropped.\n\nContinue anyway?";

export default function DraftablePack({
  dTag,
  author,
  justPublished = false,
}: {
  dTag: string;
  author?: string;
  /** Arrived from the editor right after publishing a new pack. */
  justPublished?: boolean;
}) {
  const { session } = useAuth();
  const { muteList, addMutedItem } = useStore();
  const requestSignIn = useRequestSignIn();

  const [pack, setPack] = useState<FollowPack | null>(null);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // pubkey or "all"
  const [tab, setTab] = useState<Tab>("conscripts");
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
    link?: { href: string; label: string };
  } | null>(null);
  const [copied, setCopied] = useState<"link" | "naddr" | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [showPublished, setShowPublished] = useState(justPublished);

  const relays = useMemo(
    () => draftableRelays(session?.relays),
    [session?.relays],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPack(dTag, author, relays)
      .then((result) => {
        if (!cancelled) setPack(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dTag, author, relays]);

  // Drop ?published=1 so a reload or a copied URL doesn't repeat the prompt.
  useEffect(() => {
    if (!justPublished) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("published");
    window.history.replaceState(window.history.state, "", url);
  }, [justPublished]);

  useEffect(() => {
    if (!session) {
      setFollowing(null);
      return;
    }
    let cancelled = false;
    fetchFollowing(session.pubkey, session.relays).then((result) => {
      if (!cancelled) setFollowing(result ?? new Set());
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const profilePubkeys = useMemo(
    () => (pack ? [pack.author, ...pack.members.map((m) => m.pubkey)] : []),
    [pack],
  );
  const profiles = useProfiles(profilePubkeys, relays);

  const flash = useCallback(
    (
      kind: "success" | "error",
      text: string,
      link?: { href: string; label: string },
    ) => {
      setNotice({ kind, text, link });
      setTimeout(() => setNotice(null), 8000);
    },
    [],
  );

  const runFollowChange = useCallback(
    async (
      pubkeys: string[],
      mode: "follow" | "unfollow",
      key: string,
    ): Promise<string[] | null> => {
      if (!session || !pack) return null;
      setBusy(key);
      const note =
        mode === "follow"
          ? `Auto-backup before following ${pubkeys.length} from Draftable pack "${pack.name}"`
          : `Auto-backup before unfollowing from Draftable pack "${pack.name}"`;
      try {
        const run = (allowNewList: boolean) =>
          mode === "follow"
            ? followPubkeys(session.pubkey, pubkeys, session.relays, {
                allowNewList,
                note,
              })
            : unfollowPubkeys(session.pubkey, pubkeys, session.relays, {
                note,
              });
        let result;
        try {
          result = await run(false);
        } catch (err) {
          if (
            mode === "follow" &&
            err instanceof MissingFollowListError &&
            confirm(MISSING_FOLLOW_LIST_PROMPT)
          ) {
            result = await run(true);
          } else {
            throw err;
          }
        }
        setFollowing(result.following);
        return result.changed;
      } catch (err) {
        flash("error", getErrorMessage(err, `Failed to ${mode}`));
        return null;
      } finally {
        setBusy(null);
      }
    },
    [session, pack, flash],
  );

  if (loading) return <PackSkeleton />;

  if (!pack) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Pack not found
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          This follow pack couldn&apos;t be found on the relays we checked. It
          may live on relays we don&apos;t know about, or its author asked
          relays to delete it.
        </p>
        <Link
          href="/draftable"
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#4b5320] text-white rounded-lg hover:bg-[#3c4419] transition-colors font-medium"
        >
          <ArrowLeft size={16} />
          Browse follow packs
        </Link>
      </div>
    );
  }

  const authorProfile = profiles.get(pack.author);
  const authorName = getDisplayName(
    authorProfile,
    truncateNpub(pack.author, 12, 4),
  );
  const isAuthor = session?.pubkey === pack.author;
  const drafted = isDrafted(pack, session?.pubkey);
  const shareRole: PackShareRole = isAuthor
    ? "author"
    : drafted
      ? "drafted"
      : "bystander";
  const authorMuted = muteList.pubkeys.some((p) => p.value === pack.author);
  const toFollow = pack.members
    .map((m) => m.pubkey)
    .filter((pk) => pk !== session?.pubkey && !following?.has(pk));

  const openProfile = (pubkey: string) =>
    setSelectedProfile(profiles.get(pubkey) ?? { pubkey });

  const handleFollowAll = async () => {
    if (!session) {
      requestSignIn();
      return;
    }
    if (toFollow.length === 0) {
      flash("success", "You already follow everyone in this pack.");
      return;
    }
    const ok = confirm(
      `Follow ${toFollow.length} ${toFollow.length === 1 ? "person" : "people"} from "${pack.name}"?\n\n` +
        "A backup of your current follow list is saved first. You can restore it from Backups.",
    );
    if (!ok) return;
    const changed = await runFollowChange(toFollow, "follow", "all");
    if (changed) {
      flash(
        "success",
        changed.length > 0
          ? `You now follow ${changed.length} more ${changed.length === 1 ? "person" : "people"} from this pack. Your previous follow list was backed up.`
          : "You already follow everyone in this pack.",
        changed.length > 0
          ? { href: "/dashboard?tab=backups", label: "View backups" }
          : undefined,
      );
    }
  };

  const handleFollowOne = async (pubkey: string) => {
    if (!session) {
      requestSignIn();
      return;
    }
    if (following?.has(pubkey)) {
      const name = getDisplayName(profiles.get(pubkey), "this person");
      if (!confirm(`Unfollow ${name}?\n\nA backup of your follow list is saved first.`)) {
        return;
      }
      await runFollowChange([pubkey], "unfollow", pubkey);
    } else {
      await runFollowChange([pubkey], "follow", pubkey);
    }
  };

  const handleMuteAuthor = () => {
    if (authorMuted) return;
    addMutedItem(
      {
        type: "pubkey",
        value: pack.author,
        reason: "Drafted me into a follow pack",
      },
      "pubkeys",
    );
    flash(
      "success",
      `${authorName} is on your mute list. Publish it from My Mutes to make it stick. You're still in the pack.`,
      { href: "/dashboard?tab=myList", label: "Go to My Mutes" },
    );
  };

  const handleCopy = async (what: "link" | "naddr") => {
    const text =
      what === "link"
        ? `${window.location.origin}${packPath(pack)}`
        : `nostr:${packNaddr(pack, relays)}`;
    if (await copyToClipboard(text)) {
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  const followButton = (pubkey: string) => {
    if (!session || pubkey === session.pubkey) return null;
    const isFollowing = following?.has(pubkey) ?? false;
    const isBusy = busy === pubkey;
    return (
      <button
        onClick={() => handleFollowOne(pubkey)}
        disabled={busy !== null || following === null}
        className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
          isFollowing
            ? "border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-red-300 hover:text-red-600 dark:hover:text-red-400"
            : "bg-[#4b5320] text-white hover:bg-[#3c4419]"
        }`}
        title={isFollowing ? "Unfollow" : "Follow"}
      >
        {isBusy ? (
          <Loader2 size={14} className="animate-spin" />
        ) : isFollowing ? (
          <UserCheck size={14} />
        ) : (
          <UserPlus size={14} />
        )}
        {isFollowing ? "Following" : "Follow"}
      </button>
    );
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link
        href="/draftable"
        className="inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
      >
        <ArrowLeft size={14} />
        All follow packs
      </Link>

      {showPublished && isAuthor && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-lg border-2 border-[#4b5320] bg-[#f0f0dc] dark:bg-[#4b5320]/25">
          <PartyPopper
            size={22}
            className="hidden sm:block text-[#4b5320] dark:text-[#c8d18e] flex-shrink-0"
          />
          <p className="flex-1 text-sm text-[#33391a] dark:text-[#e6ead0]">
            <span className="font-bold">Your pack is live.</span> Share it so
            people can follow everyone in it with one click.
          </p>
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => {
                setShowPublished(false);
                setShareOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#4b5320] text-white rounded-lg hover:bg-[#3c4419] transition-colors text-sm font-medium"
            >
              <Share2 size={14} />
              Share your pack
            </button>
            <button
              onClick={() => setShowPublished(false)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-[#33391a] dark:text-[#e6ead0] hover:bg-[#4b5320]/10 dark:hover:bg-[#4b5320]/40 transition-colors"
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        {pack.image && (
          <div className="h-48 sm:h-60 camo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pack.image}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
        )}
        <div className="p-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white break-words">
                {pack.name}
              </h1>
              <button
                onClick={() => openProfile(pack.author)}
                className="flex items-center gap-2 mt-3 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              >
                <ProfileAvatar
                  src={authorProfile?.picture}
                  name={authorName}
                  size="sm"
                />
                <span>
                  Drafted by <span className="font-medium">{authorName}</span>
                </span>
              </button>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                {conscriptCount(pack.members.length)} · updated{" "}
                {relativeTime(pack.createdAt)}
              </p>
            </div>

            <div className="flex flex-wrap sm:flex-col gap-2 sm:items-stretch flex-shrink-0">
              <button
                onClick={handleFollowAll}
                disabled={busy !== null || (!!session && following === null)}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-[#4b5320] text-white rounded-lg hover:bg-[#3c4419] transition-colors font-medium disabled:opacity-50"
              >
                {busy === "all" ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <UsersRound size={16} />
                )}
                {busy === "all"
                  ? "Following..."
                  : session && following && toFollow.length === 0
                    ? "Following all"
                    : `Follow all${session && following ? ` ${toFollow.length}` : ""}`}
              </button>
              {isAuthor && (
                <Link
                  href={`/draftable/create?edit=${encodeURIComponent(pack.dTag)}`}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors font-medium"
                >
                  <Pencil size={16} />
                  Edit pack
                </Link>
              )}
            </div>
          </div>

          {pack.description && (
            <p className="mt-4 text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
              {pack.description}
            </p>
          )}

          <div className="flex flex-wrap gap-2 mt-4">
            <button
              onClick={() => setShareOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-[#4b5320] text-white hover:bg-[#3c4419] transition-colors"
            >
              <Share2 size={12} />
              Share
            </button>
            <button
              onClick={() => handleCopy("link")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              {copied === "link" ? <Check size={12} /> : <Link2 size={12} />}
              {copied === "link" ? "Copied" : "Copy link"}
            </button>
            <button
              onClick={() => handleCopy("naddr")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              title="Copy a nostr:naddr reference to this pack"
            >
              {copied === "naddr" ? <Check size={12} /> : <Copy size={12} />}
              {copied === "naddr" ? "Copied" : "Copy naddr"}
            </button>
          </div>
        </div>
      </div>

      {notice && (
        <div
          className={`p-4 rounded-lg border text-sm ${
            notice.kind === "success"
              ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300"
              : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"
          }`}
        >
          {notice.text}
          {notice.link && (
            <>
              {" "}
              <Link href={notice.link.href} className="font-semibold underline">
                {notice.link.label}
              </Link>
            </>
          )}
        </div>
      )}

      {/* The rule, stated for whoever is looking */}
      {drafted ? (
        <DraftedNotice authorName={authorName}>
          <a
            href={getProfileLink(pack.author)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 border border-[#4b5320]/50 dark:border-[#4b5320] text-[#33391a] dark:text-[#c8d18e] text-sm font-medium hover:bg-[#4b5320]/10 dark:hover:bg-[#4b5320]/40 transition-colors"
          >
            <ExternalLink size={14} />
            Ask {authorName} to release you
          </a>
          <button
            onClick={handleMuteAuthor}
            disabled={authorMuted}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-60"
          >
            <VolumeX size={14} />
            {authorMuted ? `${authorName} is muted` : `Mute ${authorName}`}
          </button>
        </DraftedNotice>
      ) : isAuthor ? (
        <AuthorNotice count={pack.members.length} />
      ) : (
        <BystanderNotice authorName={authorName} />
      )}

      {/* Tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="grid grid-cols-2 border-b border-gray-200 dark:border-gray-700">
          {(["conscripts", "posts"] as Tab[]).map((option) => (
            <button
              key={option}
              onClick={() => setTab(option)}
              className={`py-3 text-center font-medium transition-colors ${
                tab === option
                  ? "text-[#4b5320] dark:text-[#b9cc7f] border-b-2 border-[#4b5320] dark:border-[#b9cc7f]"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              }`}
            >
              {option === "conscripts"
                ? `Conscripts (${pack.members.length})`
                : "Posts"}
            </button>
          ))}
        </div>

        {tab === "conscripts" ? (
          pack.members.length === 0 ? (
            <p className="p-6 text-center text-gray-500 dark:text-gray-400">
              Nobody has been drafted into this pack.
            </p>
          ) : (
            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
              {pack.members.map((member) => {
                const profile = profiles.get(member.pubkey);
                const isViewer = member.pubkey === session?.pubkey;
                const bio = profile?.about?.replace(/\s+/g, " ").trim();
                return (
                  <li
                    key={member.pubkey}
                    className={`p-4 sm:px-6 flex items-start gap-3 ${isViewer ? "bg-[#4b5320]/10 dark:bg-[#4b5320]/20" : ""}`}
                  >
                    <button onClick={() => openProfile(member.pubkey)}>
                      <ProfileAvatar
                        src={profile?.picture}
                        name={getDisplayName(profile)}
                      />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <button
                          onClick={() => openProfile(member.pubkey)}
                          className="font-semibold text-gray-900 dark:text-white hover:underline text-left"
                        >
                          {getDisplayName(
                            profile,
                            truncateNpub(member.pubkey, 12, 4),
                          )}
                        </button>
                        {isViewer && (
                          <span className="px-1.5 py-0.5 rounded bg-[#4b5320] text-white text-[10px] font-bold uppercase tracking-wide">
                            You · no exit
                          </span>
                        )}
                        {profile?.nip05 && (
                          <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {profile.nip05}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => copyToClipboard(hexToNpub(member.pubkey))}
                        className="text-xs font-mono text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                        title="Copy npub"
                      >
                        {truncateNpub(member.pubkey, 12, 6)}
                      </button>
                      {bio && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 break-words">
                          {bio.length > 140 ? `${bio.slice(0, 140)}…` : bio}
                        </p>
                      )}
                    </div>
                    {followButton(member.pubkey)}
                  </li>
                );
              })}
            </ul>
          )
        ) : (
          <PackPosts
            pubkeys={pack.members.map((m) => m.pubkey)}
            relays={relays}
            profiles={profiles}
            onSelectProfile={openProfile}
            renderAction={followButton}
          />
        )}
      </div>

      {selectedProfile && (
        <UserProfileModal
          profile={selectedProfile}
          onClose={() => setSelectedProfile(null)}
        />
      )}

      {shareOpen && (
        <ShareModal
          title={isAuthor ? "Share your pack" : "Share this pack"}
          subtitle={
            shareRole === "drafted"
              ? "Let people know you've been drafted."
              : "Post it to Nostr or copy it anywhere."
          }
          message={packShareMessage(pack, shareRole, authorName)}
          onClose={() => setShareOpen(false)}
        />
      )}
    </div>
  );
}

function PackSkeleton() {
  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-pulse">
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="h-48 bg-gray-200 dark:bg-gray-700" />
        <div className="p-6 space-y-3">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
          <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/4" />
        </div>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 divide-y divide-gray-200 dark:divide-gray-700">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
