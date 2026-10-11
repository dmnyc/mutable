"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Eye, EyeOff, Info, ArrowLeftRight } from "lucide-react";

export default function PrivacyControls() {
  const {
    muteList,
    bulkSetPrivacy,
    defaultMutePrivacy,
    setDefaultMutePrivacy,
  } = useStore();
  const [showInfo, setShowInfo] = useState(false);

  const count = (list: { private?: boolean }[], value: boolean) =>
    list.filter((item) => item.private === value).length;

  const privateCount =
    count(muteList.pubkeys, true) +
    count(muteList.words, true) +
    count(muteList.tags, true) +
    count(muteList.threads, true);
  const publicCount =
    count(muteList.pubkeys, false) +
    count(muteList.words, false) +
    count(muteList.tags, false) +
    count(muteList.threads, false);
  const total = privateCount + publicCount;

  const handleMakeAllPrivate = () => {
    if (
      confirm(
        `This will make all ${publicCount} public mutes private (encrypted). Continue?`,
      )
    ) {
      bulkSetPrivacy(true);
    }
  };

  const handleMakeAllPublic = () => {
    if (
      confirm(
        `This will make all ${privateCount} private mutes public (visible to everyone). Continue?`,
      )
    ) {
      bulkSetPrivacy(false);
    }
  };

  const privatePct = total > 0 ? (privateCount / total) * 100 : 0;

  return (
    <section className="panel relative rounded-xl border border-line shadow-panel">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-line">
        <div className="flex items-center gap-3 min-w-0">
          <h3 className="font-display font-semibold text-base tracking-tight text-hi">
            Privacy
          </h3>
          <span className="text-sm text-mut truncate">
            {total} mutes · {privateCount} encrypted
          </span>
        </div>
        <button
          onClick={() => setShowInfo(!showInfo)}
          className="p-2 text-mut hover:text-hi hover:bg-black/5 dark:hover:bg-white/5 rounded-[10px] transition-colors flex-none"
          title="How privacy works"
          aria-expanded={showInfo}
        >
          <Info size={17} />
        </button>
      </div>

      <div className="p-5">
        {/* Ratio bar — the whole list at a glance */}
        <div
          className="flex h-2.5 rounded-full overflow-hidden bg-black/10 dark:bg-white/10"
          role="img"
          aria-label={`${publicCount} public, ${privateCount} private`}
        >
          <div
            className="bg-amber-500/80 transition-all duration-300"
            style={{ width: `${total > 0 ? 100 - privatePct : 50}%` }}
          />
          <div
            className="bg-purple-500/80 transition-all duration-300"
            style={{ width: `${total > 0 ? privatePct : 50}%` }}
          />
        </div>

        <div className="mt-4 flex flex-col lg:flex-row lg:items-center gap-4">
          {/* Counts */}
          <div className="flex items-center gap-5 flex-wrap flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Eye
                size={16}
                className="text-amber-600 dark:text-amber-400 flex-none"
              />
              <div>
                <p className="text-lg font-display font-bold text-hi leading-tight">
                  {publicCount}
                </p>
                <p className="text-xs text-mut leading-tight">public</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <EyeOff
                size={16}
                className="text-purple-600 dark:text-purple-400 flex-none"
              />
              <div>
                <p className="text-lg font-display font-bold text-hi leading-tight">
                  {privateCount}
                </p>
                <p className="text-xs text-mut leading-tight">private</p>
              </div>
            </div>
          </div>

          {/* Bulk moves */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleMakeAllPrivate}
              disabled={publicCount === 0}
              title="Encrypt every public mute"
              className="px-3 py-2 bg-inset border border-line-2 text-mid hover:text-hi hover:border-line-strong rounded-[10px] transition-colors text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <EyeOff size={14} />
              All private
            </button>
            <button
              onClick={handleMakeAllPublic}
              disabled={privateCount === 0}
              title="Make every private mute publicly visible"
              className="px-3 py-2 bg-inset border border-line-2 text-mid hover:text-hi hover:border-line-strong rounded-[10px] transition-colors text-[13px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <ArrowLeftRight size={14} />
              All public
            </button>
          </div>
        </div>

        {/* Default for new mutes */}
        <div className="mt-5 pt-4 border-t border-line flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-mid">
            New mutes default to{" "}
            <span className="font-semibold text-hi">
              {defaultMutePrivacy ? "private" : "public"}
            </span>
          </p>
          <div className="inline-flex rounded-[10px] bg-inset border border-line-2 p-1 self-start sm:self-auto flex-shrink-0">
            <button
              onClick={() => setDefaultMutePrivacy(true)}
              aria-pressed={defaultMutePrivacy}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                defaultMutePrivacy
                  ? "bg-purple-600 text-white shadow-sm"
                  : "text-mut hover:text-hi"
              }`}
            >
              <EyeOff size={13} />
              Private
            </button>
            <button
              onClick={() => setDefaultMutePrivacy(false)}
              aria-pressed={!defaultMutePrivacy}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                !defaultMutePrivacy
                  ? "bg-amber-500 text-white shadow-sm"
                  : "text-mut hover:text-hi"
              }`}
            >
              <Eye size={13} />
              Public
            </button>
          </div>
        </div>

        {/* Info — collapsed by default, trimmed */}
        {showInfo && (
          <div className="mt-5 pt-4 border-t border-line text-sm text-mid space-y-2.5">
            <p>
              <span className="font-semibold text-hi flex items-center gap-1.5">
                <Eye size={14} className="text-amber-600 dark:text-amber-400" />
                Public
              </span>
              Stored as plain tags — anyone can read them. Works in every
              client.
            </p>
            <p>
              <span className="font-semibold text-hi flex items-center gap-1.5">
                <EyeOff
                  size={14}
                  className="text-purple-600 dark:text-purple-400"
                />
                Private
              </span>
              Encrypted (NIP-44, per the NIP-51 spec) — only you can read them.
              Legacy NIP-04 private mutes are read too.
            </p>
            <p className="text-mut">
              Client support varies: Damus can drop private mutes when it
              republishes your list, and Jumble uses the older NIP-04
              encryption. Save a backup before switching clients.
            </p>
            <p className="text-xs text-mut">
              Toggle any single mute with its lock icon.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
