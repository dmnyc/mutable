"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  X,
  Copy,
  Check,
  FileJson,
  ExternalLink,
  User,
  Loader2,
  EyeOff,
} from "lucide-react";
import { Event } from "nostr-tools";
import { Profile } from "@/types";
import {
  fetchEventById,
  fetchProfile,
  DEFAULT_RELAYS,
  hexToNpub,
} from "@/lib/nostr";
import { getDisplayName } from "@/lib/utils/format";
import { getEventLink, getReportEventLink } from "@/lib/utils/links";
import { copyToClipboard } from "@/lib/utils/clipboard";
import ReportTypeBadge from "./ReportTypeBadge";

/**
 * The fields every report view (received, filed, feed) can hand to the
 * detail modal. Each view fills in what it has — received reports name a
 * reporter, filed reports name targets, feed entries name both.
 */
export interface ReportDetailData {
  eventId: string;
  reportType?: string;
  content?: string;
  reportedAt: number;
  /** The note this report targets, when the report names one (NIP-56 e-tag). */
  reportedEventId?: string;
  rawEvent?: Event;
  /** Received and feed views: the account that filed the report. */
  reportedBy?: string;
  reporterProfile?: Profile;
  /** Received view stores the reporter profile under this key instead. */
  profile?: Profile;
  /** Filed and feed views: the accounts named in the report. */
  reportedPubkeys?: string[];
  targetProfiles?: (Profile | undefined)[];
}

interface ReportDetailModalProps {
  report: ReportDetailData;
  onClose: () => void;
}

const AVATAR_FALLBACK =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"%3E%3Ccircle cx="12" cy="12" r="10"/%3E%3Cpath d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4z"/%3E%3Cpath d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/%3E%3C/svg%3E';

function shortId(id: string): string {
  return `${id.slice(0, 8)}…${id.slice(-8)}`;
}

/**
 * Notary-style seal for the report header — perforated outer edge, double
 * ring, and the Mutable mark as the center medallion. Rings inherit theme
 * color; the mark keeps its brand colors.
 */
function OfficialSeal({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width="78"
      height="78"
      aria-hidden="true"
      className={`flex-shrink-0 ${className}`}
    >
      {/* perforated outer edge */}
      <circle
        cx="50"
        cy="50"
        r="47.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeDasharray="0.6 3.4"
        strokeLinecap="round"
      />
      <circle
        cx="50"
        cy="50"
        r="44"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <circle
        cx="50"
        cy="50"
        r="31"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="2 2.5"
      />
      {/* Mutable mark, scaled into the medallion — monochrome, in the
          seal's color; the bubble is cut out with the modal background */}
      <g transform="translate(26 26) scale(0.16)">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M300 149.995C300 232.842 232.842 299.99 150.005 299.99C67.1679 299.99 0 232.842 0 149.995C0 67.1477 67.1578 0 149.995 0C201.079 0 246.205 25.542 273.295 64.548C290.127 88.7952 300 118.242 300 149.995Z"
          fill="currentColor"
        />
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M225.306 75.3212C266.669 116.684 266.669 183.771 225.306 225.023C191.702 258.627 141.235 264.929 101.329 244.071L47.0985 254.136L56.0711 198.216C35.8094 158.421 42.243 108.561 75.483 75.3212C116.846 33.9481 183.933 33.9481 225.306 75.3212Z"
          className="fill-white dark:fill-gray-800"
        />
        <path
          d="M115.925 129.966C126.216 129.966 134.558 121.624 134.558 111.333C134.558 101.042 126.216 92.6999 115.925 92.6999C105.635 92.6999 97.2924 101.042 97.2924 111.333C97.2924 121.624 105.635 129.966 115.925 129.966Z"
          fill="currentColor"
        />
        <path
          d="M184.075 129.966C194.365 129.966 202.708 121.624 202.708 111.333C202.708 101.042 194.365 92.6999 184.075 92.6999C173.784 92.6999 165.442 101.042 165.442 111.333C165.442 121.624 173.784 129.966 184.075 129.966Z"
          fill="currentColor"
        />
        <path
          d="M109.777 161.564L172.657 224.444L189.931 207.17L127.051 144.29L109.777 161.564Z"
          fill="currentColor"
        />
        <path
          d="M127.039 224.445L189.92 161.564L172.645 144.29L109.765 207.171L127.039 224.445Z"
          fill="currentColor"
        />
      </g>
    </svg>
  );
}

/**
 * Split text into plain-text and image-URL parts so statements and reported
 * notes render embedded evidence as images instead of raw URLs. Trailing
 * punctuation is sentence syntax, not part of the URL.
 */
function splitImageUrls(
  text: string,
): { type: "text" | "image"; value: string }[] {
  const parts: { type: "text" | "image"; value: string }[] = [];
  let last = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const url = match[0].replace(/[.,;:!?)\]}'"]+$/, "");
    const path = url.split(/[?#]/)[0];
    if (!/\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(path)) continue;
    const idx = match.index ?? 0;
    if (idx > last) parts.push({ type: "text", value: text.slice(last, idx) });
    parts.push({ type: "image", value: url });
    last = idx + url.length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}

/**
 * Evidence images stay blurred until the reader explicitly opts in — the
 * report is public record, but the material it describes may not be safe
 * to display outright. Revealing is reversible: a corner Hide button
 * restores the blur. Falls back to the raw URL when the host is gone.
 */
function SensitiveImage({ src, alt }: { src: string; alt: string }) {
  const [revealed, setRevealed] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 block text-blue-600 dark:text-blue-400 hover:underline break-all"
      >
        {src}
      </a>
    );
  }

  return (
    <div className="relative mt-2 max-w-sm rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        draggable={false}
        onError={() => setFailed(true)}
        className={`block max-w-full max-h-96 w-auto h-auto transition duration-300 ${
          revealed ? "" : "blur-xl scale-110 select-none"
        }`}
      />
      {!revealed && (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          aria-label="Reveal sensitive image"
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/40 text-white cursor-pointer"
        >
          <EyeOff size={20} />
          <span className="text-sm font-medium">Click to reveal image</span>
        </button>
      )}
      {revealed && (
        <button
          type="button"
          onClick={() => setRevealed(false)}
          aria-label="Hide sensitive image"
          className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/50 text-white text-xs font-medium px-2.5 py-1.5 hover:bg-black/70 transition-colors cursor-pointer"
        >
          <EyeOff size={14} />
          <span>Hide</span>
        </button>
      )}
    </div>
  );
}

/** Render report or note text with any image URLs swapped for inline images. */
function TextWithSensitiveImages({
  text,
  imageAlt,
}: {
  text: string;
  imageAlt: string;
}) {
  const parts = splitImageUrls(text);
  return (
    <>
      {parts.map((part, i) =>
        part.type === "image" ? (
          <SensitiveImage
            key={`${i}-${part.value}`}
            src={part.value}
            alt={imageAlt}
          />
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </>
  );
}

/**
 * Live preview of the note a report targets, fetched from the relays so
 * the reader can judge the report against the reported material without
 * leaving Mutable. Falls back to a Jumble link when no relay still has it.
 */
function ReportedNoteEmbed({ eventId }: { eventId: string }) {
  const [note, setNote] = useState<Event | null>(null);
  const [author, setAuthor] = useState<Profile | null>(null);
  const [status, setStatus] = useState<"loading" | "found" | "missing">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;
    setNote(null);
    setAuthor(null);
    setStatus("loading");

    (async () => {
      const event = await fetchEventById(eventId);
      if (cancelled) return;
      if (!event) {
        setStatus("missing");
        return;
      }
      setNote(event);
      setStatus("found");
      const profile = await fetchProfile(event.pubkey, DEFAULT_RELAYS);
      if (!cancelled) setAuthor(profile);
    })();

    return () => {
      cancelled = true;
    };
  }, [eventId]);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-500 dark:text-gray-400">
        <Loader2 size={16} className="animate-spin" />
        Fetching the reported note…
      </div>
    );
  }

  if (status === "missing") {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400 py-2">
        No relay still has this note — it may have been deleted or pruned. It
        can still be opened directly:
      </div>
    );
  }

  const authorNpub = (() => {
    try {
      return hexToNpub(note!.pubkey);
    } catch {
      return null;
    }
  })();

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/40 overflow-hidden">
      <div className="flex items-center gap-3 p-3 border-b border-gray-100 dark:border-gray-700">
        {author?.picture ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={author.picture}
            alt=""
            className="w-8 h-8 rounded-full object-cover flex-shrink-0"
            onError={(e) => {
              (e.target as HTMLImageElement).src = AVATAR_FALLBACK;
            }}
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
            <User size={16} className="text-gray-500 dark:text-gray-300" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm text-gray-900 dark:text-white truncate">
            {author ? getDisplayName(author) : "Unknown author"}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {authorNpub
              ? `${authorNpub.slice(0, 10)}…${authorNpub.slice(-4)}`
              : shortId(note!.pubkey)}{" "}
            ·{" "}
            {new Date(note!.created_at * 1000).toLocaleDateString("en-US", {
              dateStyle: "medium",
            })}
          </div>
        </div>
        {note!.kind !== 1 && (
          <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
            kind:{note!.kind}
          </span>
        )}
      </div>
      <div className="p-3 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-words">
        {note!.content ? (
          <TextWithSensitiveImages
            text={note!.content}
            imageAlt="Image from the reported note"
          />
        ) : (
          <span className="italic text-gray-400">(empty content)</span>
        )}
      </div>
    </div>
  );
}

export default function ReportDetailModal({
  report,
  onClose,
}: ReportDetailModalProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const reporterProfile = report.reporterProfile ?? report.profile;
  const targets = report.reportedPubkeys ?? [];
  // Feed entries carry the e-tag only on the raw event.
  const reportedEventId =
    report.reportedEventId ??
    report.rawEvent?.tags.find((tag: string[]) => tag[0] === "e")?.[1];

  async function handleCopy(text: string, key: string) {
    const ok = await copyToClipboard(text);
    if (ok) setCopied(key);
  }

  function renderAvatar(profile: Profile | undefined, pubkey: string) {
    if (profile?.picture) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profile.picture}
          alt=""
          className="w-8 h-8 rounded-full object-cover flex-shrink-0"
          onError={(e) => {
            (e.target as HTMLImageElement).src = AVATAR_FALLBACK;
          }}
        />
      );
    }
    return (
      <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
        <User size={16} className="text-gray-500 dark:text-gray-300" />
      </div>
    );
  }

  function copyIcon(key: string) {
    return copied === key ? (
      <Check size={14} className="text-green-600 dark:text-green-400" />
    ) : (
      <Copy size={14} />
    );
  }

  /**
   * One identity line used by both the "Filed by" and "Reported account"
   * sections, so the two always render identically: avatar, display name
   * with NIP-05, and a copyable npub underneath.
   */
  function personRow(
    profile: Profile | undefined,
    pubkey: string,
    copyKey: string,
  ) {
    const npub = (() => {
      try {
        return hexToNpub(pubkey);
      } catch {
        return null;
      }
    })();

    return (
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {renderAvatar(profile, pubkey)}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-gray-900 dark:text-white truncate">
              {profile ? getDisplayName(profile) : shortId(pubkey)}
            </span>
            {profile?.nip05 && (
              <span className="text-xs text-green-600 dark:text-green-400 truncate">
                ✓ {profile.nip05}
              </span>
            )}
          </div>
          {npub && (
            <button
              onClick={() => handleCopy(npub!, copyKey)}
              className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
              title="Copy npub"
            >
              <span className="font-mono truncate">
                {npub.slice(0, 10)}…{npub.slice(-4)}
              </span>
              {copyIcon(copyKey)}
            </button>
          )}
        </div>
      </div>
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-gray-200 dark:border-gray-700 p-4 sm:p-6 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-4 flex-1 min-w-0 basis-full sm:basis-auto">
            <OfficialSeal className="-rotate-12 opacity-80 text-blue-900 dark:text-blue-200" />
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
                Public Report
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                NIP-56 report · kind:1984
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0 ml-auto self-end sm:self-auto">
            {/* Brand lockup — same wordmark pairing as the page header, so
                screenshots of a report carry the source */}
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold text-gray-700 dark:text-gray-200 whitespace-nowrap leading-none">
                Reportable
              </span>
              <span className="text-xs text-gray-400 dark:text-gray-500">
                by
              </span>
              <Image
                src="/mutable_logo.svg"
                alt="Mutable"
                width={18}
                height={18}
              />
              <Image
                src="/mutable_text_dark.svg"
                alt=""
                width={74}
                height={14}
                className="dark:hidden"
              />
              <Image
                src="/mutable_text.svg"
                alt=""
                width={74}
                height={14}
                className="dark:block"
              />
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <X size={24} />
            </button>
          </div>
        </div>

        {/* Body — the report as a document */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5">
          {report.reportedBy && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                Filed by
              </h3>
              <div className="flex items-center gap-3 min-w-0">
                {personRow(reporterProfile, report.reportedBy, "reporter")}
                <ReportTypeBadge type={report.reportType} large />
              </div>
            </section>
          )}

          {targets.length > 0 && (
            <section>
              <div className="flex items-center justify-between gap-3 mb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {targets.length === 1
                    ? "Reported account"
                    : `Reported accounts (${targets.length})`}
                </h3>
                {!report.reportedBy && (
                  <ReportTypeBadge type={report.reportType} large />
                )}
              </div>
              <div className="space-y-2">
                {targets
                  .slice(0, 5)
                  .map((pubkey, i) =>
                    personRow(
                      report.targetProfiles?.[i],
                      pubkey,
                      `target-${i}`,
                    ),
                  )}
                {targets.length > 5 && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    +{targets.length - 5} more
                  </p>
                )}
              </div>
            </section>
          )}

          <section className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                Date filed
              </h3>
              <p className="text-sm text-gray-900 dark:text-white">
                {new Date(report.reportedAt * 1000).toLocaleString("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                Report ID
              </h3>
              <button
                onClick={() => handleCopy(report.eventId, "event")}
                className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors font-mono"
                title="Copy report event ID"
              >
                {shortId(report.eventId)} {copyIcon("event")}
              </button>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
              Statement
            </h3>
            {report.content?.trim() ? (
              <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 py-1 text-sm text-gray-700 dark:text-gray-300 italic whitespace-pre-wrap break-words">
                <TextWithSensitiveImages
                  text={report.content}
                  imageAlt="Image evidence in the report statement"
                />
              </blockquote>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                No written statement was provided with this report.
              </p>
            )}
          </section>

          {reportedEventId && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                Reported note
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 break-all">
                This report targets a specific note:
                <span className="font-mono"> {shortId(reportedEventId)}</span>
              </p>
              <ReportedNoteEmbed eventId={reportedEventId} />
              <a
                href={getEventLink(reportedEventId)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
              >
                Open reported note on Jumble <ExternalLink size={14} />
              </a>
            </section>
          )}

          {report.rawEvent && (
            <details className="text-sm">
              <summary className="cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 select-none">
                Raw event JSON
              </summary>
              <pre className="mt-2 p-3 bg-gray-100 dark:bg-gray-900 rounded-lg text-xs overflow-x-auto text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-all">
                {JSON.stringify(report.rawEvent, null, 2)}
              </pre>
            </details>
          )}
        </div>

        {/* Footer actions */}
        <div className="border-t border-gray-200 dark:border-gray-700 p-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleCopy(report.eventId, "event")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            {copyIcon("event")} Copy ID
          </button>
          {report.rawEvent && (
            <button
              onClick={() =>
                handleCopy(JSON.stringify(report.rawEvent, null, 2), "json")
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              {copied === "json" ? (
                <Check
                  size={14}
                  className="text-green-600 dark:text-green-400"
                />
              ) : (
                <FileJson size={14} />
              )}{" "}
              Copy JSON
            </button>
          )}
          <a
            href={getReportEventLink(report.eventId)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
          >
            <ExternalLink size={14} /> njump
          </a>
          <button
            onClick={onClose}
            className="ml-auto px-4 py-1.5 text-sm font-medium bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
