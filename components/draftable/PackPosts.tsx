"use client";

import { useEffect, useState } from "react";
import type { Event } from "nostr-tools";
import { ExternalLink } from "lucide-react";
import { Profile } from "@/types";
import { getDisplayName, truncateNpub } from "@/lib/utils/format";
import { getEventLink } from "@/lib/utils/links";
import { relativeTime, segmentContent } from "@/lib/draftable/pack";
import { fetchPackPosts } from "@/lib/draftable/service";
import ProfileAvatar from "../ProfileAvatar";

/** Note text with links and images as React nodes — never injected HTML. */
function NoteContent({ content }: { content: string }) {
  return (
    <div className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
      {segmentContent(content).map((segment, i) => {
        if (segment.type === "text") return <span key={i}>{segment.value}</span>;
        if (segment.type === "image") {
          return (
            <a
              key={i}
              href={segment.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="block"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={segment.url}
                alt=""
                loading="lazy"
                className="mt-2 rounded-lg max-w-full max-h-96 object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </a>
          );
        }
        return (
          <a
            key={i}
            href={segment.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-blue-600 dark:text-blue-400 hover:underline break-all"
          >
            {segment.url}
          </a>
        );
      })}
    </div>
  );
}

export default function PackPosts({
  pubkeys,
  relays,
  profiles,
  onSelectProfile,
  renderAction,
}: {
  pubkeys: string[];
  relays: string[];
  profiles: Map<string, Profile>;
  onSelectProfile: (pubkey: string) => void;
  renderAction?: (pubkey: string) => React.ReactNode;
}) {
  const [posts, setPosts] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const key = pubkeys.join(",");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchPackPosts(key ? key.split(",") : [], relays)
      .then((events) => {
        if (!cancelled) setPosts(events);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // relays are stable for a given session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (loading) {
    return (
      <div className="divide-y divide-gray-200 dark:divide-gray-700">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="p-4 sm:p-6 animate-pulse">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700" />
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3" />
            </div>
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full mb-2" />
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-4/5" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="p-6 text-center text-red-600 dark:text-red-400">
        Couldn&apos;t load posts. Try again in a moment.
      </p>
    );
  }

  if (posts.length === 0) {
    return (
      <p className="p-6 text-center text-gray-500 dark:text-gray-400">
        No recent posts from anyone in this pack.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-gray-200 dark:divide-gray-700">
      {posts.map((post) => {
        const profile = profiles.get(post.pubkey);
        const hashtags = post.tags
          .filter((tag) => tag[0] === "t" && tag[1])
          .map((tag) => tag[1]);
        return (
          <li key={post.id} className="p-4 sm:p-6">
            <div className="flex items-start gap-3 mb-3">
              <button onClick={() => onSelectProfile(post.pubkey)}>
                <ProfileAvatar
                  src={profile?.picture}
                  name={getDisplayName(profile)}
                />
              </button>
              <div className="flex-1 min-w-0">
                <button
                  onClick={() => onSelectProfile(post.pubkey)}
                  className="font-semibold text-gray-900 dark:text-white hover:underline truncate max-w-full text-left"
                >
                  {getDisplayName(profile, truncateNpub(post.pubkey, 12, 4))}
                </button>
                <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <span>{relativeTime(post.created_at)}</span>
                  <a
                    href={getEventLink(post.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 hover:text-gray-700 dark:hover:text-gray-200"
                    title="Open note"
                  >
                    <ExternalLink size={11} />
                  </a>
                </div>
              </div>
              {renderAction?.(post.pubkey)}
            </div>
            <NoteContent content={post.content} />
            {hashtags.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {hashtags.map((tag, i) => (
                  <span
                    key={`${tag}-${i}`}
                    className="px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
