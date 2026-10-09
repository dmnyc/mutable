"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ImageIcon,
  Loader2,
  Trash2,
  Upload,
  UserMinus,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store";
import { Profile } from "@/types";
import { uploadImageToBlossom } from "@/lib/imageUpload";
import { getDisplayName, getErrorMessage, truncateNpub } from "@/lib/utils/format";
import {
  FollowPack,
  PackMember,
  conscriptCount,
  generatePackId,
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
import { EditorNotice } from "./NoExit";
import { useProfiles } from "./useProfiles";

const inputClass =
  "w-full px-3 py-2 border rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-green-600 focus:border-transparent";

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

  const profiles = useProfiles(
    useMemo(() => members.map((m) => m.pubkey), [members]),
    relays,
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
        <Loader2 size={32} className="animate-spin text-green-700" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-2xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
        <p className="text-gray-700 dark:text-gray-300 mb-6">{loadError}</p>
        <Link
          href="/draftable?view=mine"
          className="inline-flex items-center gap-2 px-4 py-2 bg-green-700 text-white rounded-lg hover:bg-green-800 transition-colors font-medium"
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

  const move = (index: number, delta: -1 | 1) => {
    setMembers((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const release = (pubkey: string) =>
    setMembers((prev) => prev.filter((m) => m.pubkey !== pubkey));

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
    setPublishing(true);
    setError(null);
    try {
      const pack = await publishPack(
        {
          dTag: existing?.dTag ?? generatePackId(),
          name,
          description,
          image,
          members,
        },
        relays,
      );
      router.push(packPath(pack));
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
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
          {editing ? "Edit follow pack" : "Draft a follow pack"}
        </h1>
        <Link
          href={existing ? packPath(existing) : "/draftable"}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          Cancel
        </Link>
      </div>

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
            <div className="mt-3 h-36 rounded-lg overflow-hidden bg-gradient-to-br from-green-700 to-green-950">
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
        />
        {searchNotice && (
          <p className="text-sm text-amber-700 dark:text-amber-400">
            {searchNotice}
          </p>
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
            {members.map((member, index) => {
              const profile = profiles.get(member.pubkey);
              return (
                <li key={member.pubkey} className="p-3 flex items-center gap-3">
                  <ProfileAvatar
                    src={profile?.picture}
                    name={getDisplayName(profile)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 dark:text-white truncate">
                      {getDisplayName(
                        profile,
                        truncateNpub(member.pubkey, 12, 4),
                      )}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {profile?.nip05 || truncateNpub(member.pubkey, 12, 6)}
                    </p>
                  </div>
                  <div className="flex flex-col">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      className="text-gray-400 hover:text-green-700 disabled:opacity-30 disabled:hover:text-gray-400"
                      title="Move up"
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === members.length - 1}
                      className="text-gray-400 hover:text-green-700 disabled:opacity-30 disabled:hover:text-gray-400"
                      title="Move down"
                    >
                      <ArrowDown size={16} />
                    </button>
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

      <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3">
        {editing ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-red-600 dark:text-red-400 border border-red-300 dark:border-red-800 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors font-medium"
          >
            <Trash2 size={16} />
            Delete pack
          </button>
        ) : (
          <span />
        )}
        <div className="flex flex-col items-stretch sm:items-end gap-1">
          <button
            type="button"
            onClick={handlePublish}
            disabled={publishing || uploading}
            className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-green-700 text-white rounded-lg hover:bg-green-800 transition-colors font-semibold disabled:opacity-60"
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
          {members.length > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 text-center sm:text-right">
              Drafts {members.length}{" "}
              {members.length === 1 ? "person" : "people"} into a public pack
              they can&apos;t leave.
            </p>
          )}
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
