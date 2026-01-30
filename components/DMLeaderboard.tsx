"use client";

import { useState } from "react";
import { User, ExternalLink, Copy, Check, Trophy, Ghost, Flame, Clock, MessageCircle } from "lucide-react";
import { DMContact } from "@/types";
import { hexToNpub } from "@/lib/nostr";

interface DMLeaderboardProps {
  contacts: DMContact[];
  onSelectContact: (contact: DMContact) => void;
}

// Title badge colors and icons
const titleConfig: Record<string, { color: string; bgColor: string; icon?: React.ReactNode }> = {
  "BFF": { color: "text-pink-700 dark:text-pink-300", bgColor: "bg-pink-100 dark:bg-pink-900/30", icon: <Trophy size={12} /> },
  "Inner Circle": { color: "text-purple-700 dark:text-purple-300", bgColor: "bg-purple-100 dark:bg-purple-900/30" },
  "Frequent Flyer": { color: "text-blue-700 dark:text-blue-300", bgColor: "bg-blue-100 dark:bg-blue-900/30" },
  "Hot": { color: "text-orange-700 dark:text-orange-300", bgColor: "bg-orange-100 dark:bg-orange-900/30", icon: <Flame size={12} /> },
  "Ghost": { color: "text-gray-600 dark:text-gray-400", bgColor: "bg-gray-100 dark:bg-gray-800", icon: <Ghost size={12} /> },
  "Left on Read": { color: "text-red-700 dark:text-red-300", bgColor: "bg-red-100 dark:bg-red-900/30" },
  "Popular": { color: "text-green-700 dark:text-green-300", bgColor: "bg-green-100 dark:bg-green-900/30" },
  "One-Timer": { color: "text-gray-600 dark:text-gray-400", bgColor: "bg-gray-100 dark:bg-gray-700" },
  "Acquaintance": { color: "text-gray-600 dark:text-gray-400", bgColor: "bg-gray-100 dark:bg-gray-700" },
  "Regular": { color: "text-gray-600 dark:text-gray-400", bgColor: "bg-gray-100 dark:bg-gray-700" },
};

export default function DMLeaderboard({ contacts, onSelectContact }: DMLeaderboardProps) {
  const [copiedNpub, setCopiedNpub] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const displayedContacts = showAll ? contacts : contacts.slice(0, 20);

  const handleCopyNpub = async (npub: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(npub);
      setCopiedNpub(npub);
      setTimeout(() => setCopiedNpub(null), 2000);
    } catch (error) {
      console.error("Failed to copy npub:", error);
    }
  };

  const formatLastSeen = (timestamp: number) => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
  };

  const getMedalEmoji = (index: number) => {
    if (index === 0) return "🥇";
    if (index === 1) return "🥈";
    if (index === 2) return "🥉";
    return null;
  };

  if (contacts.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        <MessageCircle size={48} className="mx-auto mb-4 opacity-50" />
        <p>No DM activity found</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {displayedContacts.map((contact, index) => {
        const npub = hexToNpub(contact.pubkey);
        const medal = getMedalEmoji(index);
        const title = contact.title || "Regular";
        const config = titleConfig[title] || titleConfig["Regular"];

        return (
          <div
            key={contact.pubkey}
            className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
          >
            <div className="flex items-start gap-3">
              {/* Rank */}
              <div className="w-8 text-center flex-shrink-0">
                {medal ? (
                  <span className="text-xl">{medal}</span>
                ) : (
                  <span className="text-sm font-medium text-gray-400 dark:text-gray-500">
                    #{index + 1}
                  </span>
                )}
              </div>

              {/* Avatar */}
              {contact.profile?.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={contact.profile.picture}
                  alt=""
                  className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/bottts/svg?seed=${contact.pubkey}`;
                  }}
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                  <User className="text-white" size={24} />
                </div>
              )}

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <button
                    onClick={() => onSelectContact(contact)}
                    className="font-semibold text-gray-900 dark:text-white hover:text-purple-600 dark:hover:text-purple-400 transition-colors truncate"
                  >
                    {contact.profile?.display_name || contact.profile?.name || npub.slice(0, 16) + "..."}
                  </button>

                  {/* Title Badge */}
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${config.bgColor} ${config.color}`}>
                    {config.icon}
                    {title}
                  </span>
                </div>

                {contact.profile?.nip05 && (
                  <div className="text-sm text-green-600 dark:text-green-400 mb-1 truncate">
                    ✓ {contact.profile.nip05}
                  </div>
                )}

                {/* Stats */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    {contact.totalCount} exchanges
                  </span>
                  <span>
                    ↑ {contact.sentCount} sent
                  </span>
                  <span>
                    ↓ {contact.receivedCount} received
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock size={12} />
                    Last: {formatLastSeen(contact.lastExchange)}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={(e) => handleCopyNpub(npub, e)}
                  className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                  title="Copy npub"
                >
                  {copiedNpub === npub ? (
                    <Check className="text-green-600 dark:text-green-400" size={18} />
                  ) : (
                    <Copy size={18} />
                  )}
                </button>

                <a
                  href={`https://njump.me/${npub}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                  title="View on njump"
                >
                  <ExternalLink size={18} />
                </a>
              </div>
            </div>
          </div>
        );
      })}

      {/* Show More Button */}
      {contacts.length > 20 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full py-3 text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 font-medium transition-colors"
        >
          Show all {contacts.length} contacts
        </button>
      )}

      {showAll && contacts.length > 20 && (
        <button
          onClick={() => setShowAll(false)}
          className="w-full py-3 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 font-medium transition-colors"
        >
          Show less
        </button>
      )}
    </div>
  );
}
