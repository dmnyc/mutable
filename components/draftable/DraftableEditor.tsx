"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  ImageIcon,
  Loader2,
  Medal,
  Trash2,
  Undo2,
  Upload,
  UserMinus,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store";
import { Profile } from "@/types";
import { uploadImageToBlossom } from "@/lib/imageUpload";
import { getDisplayName, getErrorMessage, truncateNpub } from "@/lib/utils/format";
import {
  FollowPack,
  PACK_ID_MAX,
  PACK_ID_MIN,
  PackMember,
  conscriptCount,
  generatePackId,
  packIdError,
  packPath,
} from "@/lib/draftable/pack";
import {
  deletePack,
  draftableRelays,
  fetchPack,
  publishPack,
} from "@/lib/draftable/service";
import ProfileAvatar from "../ProfileAvatar";
import UserSearchInput from "../UserSearchInput";
import { useRequestSignIn } from "./DraftableShell";
import BackToPacks from "./BackToPacks";
import { EditorNotice } from "./NoExit";
import { useProfiles } from "./useProfiles";

const inputClass =
  "w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-[#556b2f] focus:border-transparent";

export default function DraftableEditor() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const { session } = useAuth();
  const { signer } = useStore();
  const requestSignIn = useRequestSignIn();

  const [existing, setExisting] = useState<FollowPack | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(!!editId);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [description, setDescription] = useState("");
  const [packId, setPackId] = useState("");
  const [members, setMembers] = useState<PackMember[]>([]);
  const [searchKey, setSearchKey] = useState(0); // remounts the search box
  const [searchNotice, setSearchNotice] = useState<string | null>(null);

  const [submitted, setSubmitted] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const relays = useMemo(
    () => draftableRelays(session?.relays),
    [session?.relays],
  );

  useEffect(() => {
    if (!editId || !session) return;
    let cancelled = false;
    setLoadingExisting(true);
    setLoadError(null);
    fetchPack(editId, session.pubkey, relays)
      .then((pack) => {
        if (cancelled) return;
        if (!pack) {
          setLoadError(
            "Couldn't find that pack among the packs you've made. You can only edit your own packs.",
          );
          return;
        }
        setExisting(pack);
        setName(pack.name);
        setImage(pack.image);
        setDescription(pack.description);
        setMembers(pack.members);
      })
      .finally(() => {
        if (!cancelled) setLoadingExisting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editId, session, relays]);

  // Released people still need names, for the "releasing" chips.
  const profiles = useProfiles(
    useMemo(
      () =>
        Array.from(
          new Set([
            ...members.map((m) => m.pubkey),
            ...(existing?.members.map((m) => m.pubkey) ?? []),
          ]),
        ),
      [members, existing],
    ),
    relays,
  );

  // What's changed since the pack was last published. For a new pack,
  // everyone is still to be drafted.
  const published = useMemo(
    () => new Set(existing?.members.map((m) => m.pubkey) ?? []),
    [existing],
  );
  const pendingAdds = members.filter((m) => !published.has(m.pubkey));
  const pendingReleases = (existing?.members ?? []).filter(
    (m) => !members.some((kept) => kept.pubkey === m.pubkey),
  );

  if (!session) {
    return (
      <div className="max-w-2xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Sign in to draft people
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Follow packs are signed by their author, so you need to connect with
          Nostr to make one.
        </p>
        <button
          onClick={requestSignIn}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
        >
          Connect with Nostr
        </button>
      </div>
    );
  }

  if (loadingExisting) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={32} className="animate-spin text-[#4b5320]" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
        <p className="text-gray-700 dark:text-gray-300 mb-6">{loadError}</p>
        <Link
          href="/draftable?view=mine"
          className="camo camo-button inline-flex items-center gap-2 px-4 py-2 rounded-lg font-semibold"
        >
          <ArrowLeft size={16} />
          Your packs
        </Link>
      </div>
    );
  }

  const editing = !!existing;
  const nameInvalid = submitted && !name.trim();
  const membersInvalid = submitted && members.length === 0;
  // A custom ID only applies to new packs; blank means a random one.
  const packIdProblem = !editing && packId ? packIdError(packId) : null;
  const showPackIdProblem =
    !!packIdProblem && (submitted || packId.length >= PACK_ID_MIN);

  const draftPerson = (profile: Profile) => {
    if (members.some((m) => m.pubkey === profile.pubkey)) {
      setSearchNotice(
        `${getDisplayName(profile, "That person")} is already drafted.`,
      );
    } else {
      setMembers((prev) => [...prev, { pubkey: profile.pubkey }]);
      setSearchNotice(null);
    }
    setSearchKey((k) => k + 1);
  };

  const release = (pubkey: string) =>
    setMembers((prev) => prev.filter((m) => m.pubkey !== pubkey));

  // Put a released person back where they were in the published pack.
  const undoRelease = (pubkey: string) => {
    const order = existing?.members.map((m) => m.pubkey) ?? [];
    const member = existing?.members.find((m) => m.pubkey === pubkey);
    if (!member) return;
    setMembers((prev) =>
      [...prev, member].sort((a, b) => {
        const ia = order.indexOf(a.pubkey);
        const ib = order.indexOf(b.pubkey);
        return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
      }),
    );
  };

  const releaseAll = () => {
    if (confirm(`Release all ${members.length} people from this pack?`)) {
      setMembers([]);
    }
  };

  const handleUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Images must be under 10MB.");
      return;
    }
    setUploading(true);
    setUploadPercent(0);
    setError(null);
    try {
      const result = await uploadImageToBlossom({
        blob: file,
        filename: file.name,
        signer: signer || undefined,
        onProgress: (progress) => setUploadPercent(progress.percent),
      });
      setImage(result.url);
    } catch (err) {
      setError(`Upload failed: ${getErrorMessage(err, "unknown error")}`);
    } finally {
      setUploading(false);
    }
  };

  const handlePublish = async () => {
    setSubmitted(true);
    if (!name.trim() || members.length === 0) {
      setError("Give the pack a name and draft at least one person.");
      return;
    }
    if (packIdProblem) return; // shown under the field
    const customId = !existing && packId ? packId : null;
    setPublishing(true);
    setError(null);
    try {
      // Same author + same ID is the same pack, so publishing would replace it.
      if (
        customId &&
        session &&
        (await fetchPack(customId, session.pubkey, relays))
      ) {
        setError(
          `You already have a pack with the ID "${customId}". Publishing would replace it, so pick another ID or edit that pack instead.`,
        );
        setPublishing(false);
        return;
      }
      const pack = await publishPack(
        {
          dTag: existing?.dTag ?? customId ?? generatePackId(),
          name,
          description,
          image,
          members,
        },
        relays,
      );
      // A new pack lands on its page with a prompt to share it.
      router.push(editing ? packPath(pack) : `${packPath(pack)}&published=1`);
    } catch (err) {
      setError(getErrorMessage(err, "Failed to publish the pack"));
      setPublishing(false);
    }
  };

  const handleDelete = async () => {
    if (!existing) return;
    setDeleting(true);
    try {
      await deletePack(existing, relays);
      router.push("/draftable?view=mine");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to delete the pack"));
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-28">
      <BackToPacks />
      <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
        {editing ? "Edit follow pack" : "Draft a follow pack"}
      </h1>

      <EditorNotice />

      {error && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm">
          <AlertCircle size={16} className="flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Details */}
      <section className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Pack details
        </h2>
        <div>
          <label
            htmlFor="pack-name"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Name <span className="text-red-500">*</span>
          </label>
          <input
            id="pack-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Nostr developers worth following"
            className={`${inputClass} ${nameInvalid ? "border-red-500" : "border-gray-300 dark:border-gray-600"}`}
          />
          {nameInvalid && (
            <p className="mt-1 text-sm text-red-600">A name is required.</p>
          )}
        </div>

        <div>
          <label
            htmlFor="pack-image"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Cover image
          </label>
          <div className="flex gap-2">
            <input
              id="pack-image"
              type="url"
              value={image}
              onChange={(e) => setImage(e.target.value)}
              placeholder="https://example.com/cover.jpg"
              className={`${inputClass} border-gray-300 dark:border-gray-600 flex-1 min-w-0`}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {uploading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Upload size={14} />
              )}
              {uploading ? `${uploadPercent}%` : "Upload"}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
                e.target.value = "";
              }}
            />
          </div>
          {image.trim() ? (
            <div className="mt-3 h-36 rounded-lg overflow-hidden camo">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.trim()}
                alt="Cover preview"
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
              <ImageIcon size={12} />
              Optional. Shown on the pack card and page.
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="pack-description"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Description
          </label>
          <textarea
            id="pack-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Who's in here and why"
            className={`${inputClass} border-gray-300 dark:border-gray-600`}
          />
        </div>

        <div>
          <label
            htmlFor="pack-id"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Pack ID
          </label>
          {existing ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              <span className="font-mono text-gray-900 dark:text-white">
                {existing.dTag}
              </span>
              . A pack&apos;s ID can&apos;t change; a new ID would make a new
              pack.
            </p>
          ) : (
            <>
              <input
                id="pack-id"
                type="text"
                value={packId}
                onChange={(e) =>
                  setPackId(e.target.value.toLowerCase().replace(/\s+/g, "-"))
                }
                maxLength={PACK_ID_MAX}
                placeholder="Leave blank for a random ID"
                spellCheck={false}
                autoCapitalize="none"
                autoComplete="off"
                className={`${inputClass} font-mono ${showPackIdProblem ? "border-red-500" : "border-gray-300 dark:border-gray-600"}`}
              />
              {showPackIdProblem ? (
                <p className="mt-1 text-sm text-red-600">{packIdProblem}</p>
              ) : (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Optional. Sets the end of the pack&apos;s link,{" "}
                  <span className="font-mono">
                    /draftable/d/{packId || "…"}
                  </span>
                  . Lowercase letters, numbers, and hyphens. It can&apos;t be
                  changed later.
                </p>
              )}
            </>
          )}
        </div>
      </section>

      {/* Conscripts */}
      <section className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Draft people
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Search by name or NIP-05, or paste an npub. They won&apos;t be
            asked.
          </p>
        </div>
        <UserSearchInput
          key={searchKey}
          onSelect={draftPerson}
          placeholder="Name, NIP-05, npub, or nprofile"
          showFollowerCount
        />
        {searchNotice && (
          <p className="text-sm text-[#6b6237] dark:text-[#cfc58e]">
            {searchNotice}
          </p>
        )}

        {/* Changes since the last publish, right under the search box so
            new additions show even when the list runs off screen. */}
        {(pendingAdds.length > 0 || pendingReleases.length > 0) && (
          <div className="p-3 rounded-lg border border-dashed border-[#b3a869] dark:border-[#6b6237] bg-[#f4f2e0] dark:bg-[#6b6237]/20 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#6b6237] dark:text-[#cfc58e]">
              Not published yet
            </p>
            {pendingAdds.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm text-[#4f4826] dark:text-[#e2dab0] mr-1">
                  Drafting {pendingAdds.length}:
                </span>
                {pendingAdds.slice(-12).map((member) => {
                  const profile = profiles.get(member.pubkey);
                  const name = getDisplayName(
                    profile,
                    truncateNpub(member.pubkey, 8, 4),
                  );
                  return (
                    <span
                      key={member.pubkey}
                      className="inline-flex items-center gap-1.5 pl-1 pr-1.5 py-0.5 rounded-full bg-white dark:bg-gray-800 border border-[#b3a869] dark:border-[#6b6237] text-sm text-gray-900 dark:text-white"
                    >
                      <ProfileAvatar
                        src={profile?.picture}
                        name={name}
                        size="sm"
                        className="!w-5 !h-5"
                      />
                      <span className="max-w-[10rem] truncate">{name}</span>
                      <button
                        type="button"
                        onClick={() => release(member.pubkey)}
                        className="text-gray-400 hover:text-red-600"
                        title={`Don't draft ${name}`}
                        aria-label={`Don't draft ${name}`}
                      >
                        <X size={14} />
                      </button>
                    </span>
                  );
                })}
                {pendingAdds.length > 12 && (
                  <span className="text-sm text-[#4f4826] dark:text-[#e2dab0]">
                    and {pendingAdds.length - 12} more
                  </span>
                )}
              </div>
            )}
            {pendingReleases.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm text-[#4f4826] dark:text-[#e2dab0] mr-1">
                  Releasing {pendingReleases.length}:
                </span>
                {pendingReleases.map((member) => {
                  const profile = profiles.get(member.pubkey);
                  const name = getDisplayName(
                    profile,
                    truncateNpub(member.pubkey, 8, 4),
                  );
                  return (
                    <span
                      key={member.pubkey}
                      className="inline-flex items-center gap-1.5 pl-1 pr-1.5 py-0.5 rounded-full bg-white dark:bg-gray-800 border border-red-200 dark:border-red-900 text-sm text-gray-500 dark:text-gray-400"
                    >
                      <ProfileAvatar
                        src={profile?.picture}
                        name={name}
                        size="sm"
                        className="!w-5 !h-5 opacity-60"
                      />
                      <span className="max-w-[10rem] truncate line-through">
                        {name}
                      </span>
                      <button
                        type="button"
                        onClick={() => undoRelease(member.pubkey)}
                        className="text-gray-400 hover:text-[#4b5320] dark:hover:text-[#b9cc7f]"
                        title={`Keep ${name}`}
                        aria-label={`Keep ${name}`}
                      >
                        <Undo2 size={14} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <h3 className="font-medium text-gray-900 dark:text-white">
            {conscriptCount(members.length)}
          </h3>
          {members.length > 0 && (
            <button
              type="button"
              onClick={releaseAll}
              className="text-sm text-red-600 dark:text-red-400 hover:underline"
            >
              Release all
            </button>
          )}
        </div>
        {membersInvalid && (
          <p className="text-sm text-red-600">
            Draft at least one person into the pack.
          </p>
        )}

        {members.length === 0 ? (
          <div className="p-4 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-center text-sm text-gray-500 dark:text-gray-400">
            Nobody drafted yet. Search above to add people.
          </div>
        ) : (
          <ul className="border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-200 dark:divide-gray-700">
            {members.map((member) => {
              const profile = profiles.get(member.pubkey);
              const isNew = !!existing && !published.has(member.pubkey);
              return (
                <li
                  key={member.pubkey}
                  className={`p-3 flex items-center gap-3 ${isNew ? "bg-[#f4f2e0] dark:bg-[#6b6237]/20" : ""}`}
                >
                  <ProfileAvatar
                    src={profile?.picture}
                    name={getDisplayName(profile)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="flex items-center gap-2 font-medium text-gray-900 dark:text-white min-w-0">
                      <span className="truncate">
                        {getDisplayName(
                          profile,
                          truncateNpub(member.pubkey, 12, 4),
                        )}
                      </span>
                      {isNew && (
                        <span className="flex-shrink-0 px-1.5 py-0.5 rounded bg-[#4b5320] text-white text-[10px] font-bold uppercase tracking-wide">
                          New
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {profile?.nip05 || truncateNpub(member.pubkey, 12, 6)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => release(member.pubkey)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                    title="Remove from the pack"
                  >
                    <UserMinus size={14} />
                    Release
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Deleting lives apart from Save/Cancel so it's never hit by habit. */}
      {existing && (
        <section className="rounded-lg border border-red-200 dark:border-red-900/60 bg-white dark:bg-gray-800 p-6 space-y-3">
          <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">
            Delete this pack
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Sends a deletion request to your relays. Relays that honor it drop
            the pack and release everyone in it; copies elsewhere may survive.
          </p>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm text-red-600 dark:text-red-400 border-2 border-red-300 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors font-medium"
          >
            <Trash2 size={16} />
            Delete pack
          </button>
        </section>
      )}

      {/* A strip across the bottom, like the mute list's unsaved-changes
          banner, so a long pack never needs scrolling to publish. */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-[#f4f2e0] dark:bg-[#23280f] border-t-2 border-[#4b5320] dark:border-[#8a9a4a] shadow-lg">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Medal
              size={20}
              className="flex-shrink-0 text-[#4b5320] dark:text-[#c8d18e]"
            />
            <div className="text-sm min-w-0">
              <p className="font-bold text-gray-900 dark:text-white truncate">
                {!editing
                  ? "New pack"
                  : pendingAdds.length > 0 || pendingReleases.length > 0
                    ? [
                        pendingAdds.length > 0 &&
                          `${pendingAdds.length} to draft`,
                        pendingReleases.length > 0 &&
                          `${pendingReleases.length} to release`,
                      ]
                        .filter(Boolean)
                        .join(" · ") + ", not published yet"
                    : `Editing “${name.trim() || existing?.name}”`}
              </p>
              {members.length > 0 && (
                <p className="hidden sm:block text-gray-600 dark:text-gray-400 truncate">
                  Drafts {members.length}{" "}
                  {members.length === 1 ? "person" : "people"} into a public
                  pack they can&apos;t leave.
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              href={existing ? packPath(existing) : "/draftable"}
              className="inline-flex items-center justify-center h-10 px-4 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </Link>
            <button
              type="button"
              onClick={handlePublish}
              disabled={publishing || uploading}
              className="camo camo-button [--camo-x:-60px] [--camo-y:-150px] inline-flex items-center justify-center gap-2 h-10 px-5 text-sm rounded-lg font-bold disabled:opacity-60"
            >
              {publishing && <Loader2 size={16} className="animate-spin" />}
              {publishing
                ? editing
                  ? "Updating..."
                  : "Publishing..."
                : editing
                  ? "Update pack"
                  : "Publish pack"}
            </button>
          </div>
        </div>
      </div>

      {confirmDelete && existing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full shadow-xl">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-3">
              Delete &ldquo;{existing.name}&rdquo;?
            </h3>
            <p className="text-gray-700 dark:text-gray-300 mb-6 text-sm">
              This sends a deletion request to your relays. Relays that honor
              it will drop the pack and release everyone in it. Some relays,
              and anyone who saved a copy, may keep it anyway.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-60"
              >
                {deleting && <Loader2 size={16} className="animate-spin" />}
                {deleting ? "Deleting..." : "Delete pack"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
