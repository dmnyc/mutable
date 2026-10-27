"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { hexToNevent } from "@/lib/nostr";
import { copyToClipboard } from "@/lib/utils/clipboard";

/**
 * For a post we can see a reference from: copy its ID (nevent) and open it
 * in Jumble. Rendered next to the Note Nuke link on "Linked but gone" rows.
 */
export default function PostLinks({
  eventId,
  kind,
}: {
  eventId: string;
  kind?: number;
}) {
  const [copied, setCopied] = useState(false);
  const nevent = hexToNevent(eventId, kind);

  const copy = async () => {
    if (await copyToClipboard(nevent)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <span className="inline-flex items-center gap-2 text-xs">
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1 text-mut hover:text-hi transition-colors"
        title={`Copy the post ID (${nevent.slice(0, 18)}…)`}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? "copied" : "id"}
      </button>
      <a
        href={`https://jumble.social/${nevent}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-mut hover:text-hi transition-colors"
        title="Open the post in Jumble"
      >
        <ExternalLink size={12} />
        jumble
      </a>
    </span>
  );
}
