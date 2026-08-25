'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Copy,
  Check,
  FileJson,
  ExternalLink,
  Fingerprint,
  User,
} from 'lucide-react';
import { Event } from 'nostr-tools';
import { Profile } from '@/types';
import { hexToNpub } from '@/lib/nostr';
import { getDisplayName } from '@/lib/utils/format';
import { getEventLink, getReportEventLink } from '@/lib/utils/links';
import { copyToClipboard } from '@/lib/utils/clipboard';
import ReportTypeBadge from './ReportTypeBadge';

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
    report.rawEvent?.tags.find((tag: string[]) => tag[0] === 'e')?.[1];

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

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-gray-200 dark:border-gray-700 p-6 flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2 flex-wrap">
              Public Report <ReportTypeBadge type={report.reportType} />
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              NIP-56 report · kind:1984
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Body — the report as a document */}
        <div className="p-6 overflow-y-auto space-y-5">
          {report.reportedBy && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                Filed by
              </h3>
              <div className="flex items-center gap-3 min-w-0">
                {renderAvatar(reporterProfile, report.reportedBy)}
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-900 dark:text-white truncate">
                    {reporterProfile
                      ? getDisplayName(reporterProfile)
                      : 'Unknown reporter'}
                  </div>
                  {reporterProfile?.nip05 && (
                    <div className="text-xs text-green-600 dark:text-green-400 truncate">
                      ✓ {reporterProfile.nip05}
                    </div>
                  )}
                </div>
                {(() => {
                  try {
                    const npub = hexToNpub(report.reportedBy!);
                    return (
                      <button
                        onClick={() => handleCopy(npub, 'reporter')}
                        className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors flex-shrink-0"
                        title="Copy reporter npub"
                      >
                        <span className="font-mono">
                          {npub.slice(0, 10)}…{npub.slice(-4)}
                        </span>
                        {copyIcon('reporter')}
                      </button>
                    );
                  } catch {
                    return null;
                  }
                })()}
              </div>
            </section>
          )}

          {targets.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                {targets.length === 1 ? 'Reported account' : `Reported accounts (${targets.length})`}
              </h3>
              <div className="space-y-2">
                {targets.slice(0, 5).map((pubkey, i) => {
                  const profile = report.targetProfiles?.[i];
                  return (
                    <div key={pubkey} className="flex items-center gap-3 min-w-0">
                      {renderAvatar(profile, pubkey)}
                      <span className="font-medium text-gray-900 dark:text-white truncate">
                        {profile ? getDisplayName(profile) : shortId(pubkey)}
                      </span>
                      {profile?.nip05 && (
                        <span className="text-xs text-green-600 dark:text-green-400 truncate">
                          ✓ {profile.nip05}
                        </span>
                      )}
                    </div>
                  );
                })}
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
                {new Date(report.reportedAt * 1000).toLocaleString('en-US', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </p>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1">
                Report ID
              </h3>
              <button
                onClick={() => handleCopy(report.eventId, 'event')}
                className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors font-mono"
                title="Copy report event ID"
              >
                {shortId(report.eventId)} {copyIcon('event')}
              </button>
            </div>
          </section>

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
              Statement
            </h3>
            {report.content?.trim() ? (
              <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 py-1 text-sm text-gray-700 dark:text-gray-300 italic whitespace-pre-wrap break-words">
                {report.content}
              </blockquote>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                No written statement was provided with this report.
              </p>
            )}
          </section>

          {reportedEventId && (
            <section className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300 mb-1">
                Reported note
              </h3>
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-2 break-all">
                This report targets a specific note:
                <span className="font-mono"> {shortId(reportedEventId)}</span>
              </p>
              <a
                href={getEventLink(reportedEventId)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
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
            onClick={() => handleCopy(report.eventId, 'event')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            {copyIcon('event')} Copy ID
          </button>
          {report.rawEvent && (
            <button
              onClick={() =>
                handleCopy(JSON.stringify(report.rawEvent, null, 2), 'json')
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              {copied === 'json' ? (
                <Check size={14} className="text-green-600 dark:text-green-400" />
              ) : (
                <FileJson size={14} />
              )}{' '}
              Copy JSON
            </button>
          )}
          <a
            href={getReportEventLink(report.eventId)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
          >
            <Fingerprint size={14} /> njump
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
