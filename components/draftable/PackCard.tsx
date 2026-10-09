"use client";

import Link from "next/link";
import { LockKeyhole, UsersRound } from "lucide-react";
import { Profile } from "@/types";
import { getDisplayName, truncateNpub } from "@/lib/utils/format";
import {
  FollowPack,
  conscriptCount,
  isDrafted,
  packAddress,
  packPath,
  relativeTime,
} from "@/lib/draftable/pack";
import ProfileAvatar from "../ProfileAvatar";

export const PREVIEW_MEMBERS = 5;

/** Same pack, same patch of camo: pick a tile offset from the address. */
function camoOffset(seed: string): React.CSSProperties {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return {
    "--camo-x": `${-(hash & 0x3ff) % 400}px`,
    "--camo-y": `${-((hash >>> 10) & 0x3ff) % 400}px`,
  } as React.CSSProperties;
}

export default function PackCard({
  pack,
  profiles,
  viewerPubkey,
}: {
  pack: FollowPack;
  profiles: Map<string, Profile>;
  viewerPubkey?: string | null;
}) {
  const author = profiles.get(pack.author);
  const drafted = isDrafted(pack, viewerPubkey);
  const extra = pack.members.length - PREVIEW_MEMBERS;

  return (
    <Link
      href={packPath(pack)}
      className="group block bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all"
    >
      <div className="relative h-32 camo" style={camoOffset(packAddress(pack))}>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="w-14 h-14 rounded-full bg-black/45 ring-1 ring-white/20 flex items-center justify-center text-white/90">
            <UsersRound size={28} />
          </span>
        </div>
        {pack.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={pack.image}
            alt=""
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        )}
        {drafted && (
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-[#d9cfa0] text-[#33391a] text-xs font-semibold shadow">
            <LockKeyhole size={12} />
            You&apos;re in this one
          </span>
        )}
      </div>

      <div className="p-4">
        <h3 className="font-semibold text-gray-900 dark:text-white line-clamp-2 group-hover:text-[#4b5320] dark:group-hover:text-[#b9cc7f] transition-colors">
          {pack.name}
        </h3>

        <div className="flex items-center gap-2 mt-2 min-w-0">
          <ProfileAvatar
            src={author?.picture}
            name={getDisplayName(author)}
            size="sm"
            className="!w-5 !h-5"
          />
          <span className="text-sm text-gray-600 dark:text-gray-400 truncate">
            drafted by{" "}
            {getDisplayName(author, truncateNpub(pack.author, 12, 4))}
          </span>
        </div>

        <div className="flex items-center -space-x-2 mt-3">
          {pack.members.slice(0, PREVIEW_MEMBERS).map((member) => {
            const profile = profiles.get(member.pubkey);
            return (
              <ProfileAvatar
                key={member.pubkey}
                src={profile?.picture}
                name={getDisplayName(profile)}
                size="sm"
                className="ring-2 ring-white dark:ring-gray-800"
              />
            );
          })}
          {extra > 0 && (
            <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 ring-2 ring-white dark:ring-gray-800 flex items-center justify-center text-xs font-medium text-gray-600 dark:text-gray-300">
              +{extra}
            </div>
          )}
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
          {conscriptCount(pack.members.length)} · updated{" "}
          {relativeTime(pack.createdAt)}
        </p>
      </div>
    </Link>
  );
}

export function PackGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden animate-pulse"
        >
          <div className="h-32 bg-gray-200 dark:bg-gray-700" />
          <div className="p-4 space-y-3">
            <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
            <div className="flex -space-x-2">
              {Array.from({ length: 5 }, (_, j) => (
                <div
                  key={j}
                  className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 ring-2 ring-white dark:ring-gray-800"
                />
              ))}
            </div>
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
