"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Eye, EyeOff, Info, ArrowLeftRight } from "lucide-react";

export type MuteCategoryTab = "profiles" | "words" | "tags" | "threads";

export default function PrivacyControls({
  onSelectCategory,
}: {
  onSelectCategory?: (tab: MuteCategoryTab) => void;
}) {
  const {
    muteList,
    bulkSetPrivacy,
    defaultMutePrivacy,
    setDefaultMutePrivacy,
    setActiveTab,
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

  // What makes up each side's number: a fixed 2x2 grid so both tiles line up.
  const breakdown = (value: boolean) => [
    {
      label: "profiles",
      tab: "profiles" as const,
      n: count(muteList.pubkeys, value),
    },
    { label: "words", tab: "words" as const, n: count(muteList.words, value) },
    { label: "hashtags", tab: "tags" as const, n: count(muteList.tags, value) },
    {
      label: "threads",
      tab: "threads" as const,
      n: count(muteList.threads, value),
    },
  ];
  const publicBreakdown = breakdown(false);
  const privateBreakdown = breakdown(true);

  const renderBreakdown = (
    rows: { label: string; tab: MuteCategoryTab; n: number }[],
  ) => (
    <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 pt-4 border-t border-line">
      {rows.map((row) => (
        <button
          key={row.label}
          type="button"
          onClick={() => onSelectCategory?.(row.tab)}
          disabled={!onSelectCategory}
          title={`Open ${row.label}`}
          className={`text-left rounded-lg -m-1.5 p-1.5 transition-colors enabled:hover:bg-black/5 dark:enabled:hover:bg-white/5 ${
            row.n === 0 ? "opacity-40" : ""
          }`}
        >
          <span
            className="block font-display font-bold text-hi leading-none tabular-nums"
            style={{ fontSize: "clamp(22px, 4vw, 32px)" }}
          >
            {row.n}
          </span>
          <span className="block text-sm text-mut mt-1">
            {row.n === 1 ? row.label.replace(/s$/, "") : row.label}
          </span>
        </button>
      ))}
    </div>
  );

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
        {/* Infographic: two big tiles, one per mode. A zero side dims. */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <div
            className={`rounded-xl border p-4 sm:p-6 transition-opacity ${
              publicCount === 0 ? "opacity-45" : ""
            } border-amber-500/30 bg-amber-500/10`}
          >
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <Eye size={20} />
              <span className="text-sm font-semibold uppercase tracking-wider">
                Public
              </span>
            </div>
            <p
              className="font-display font-extrabold text-amber-700 dark:text-amber-400 leading-none tracking-tight mt-3 tabular-nums"
              style={{ fontSize: "clamp(56px, 12vw, 112px)" }}
            >
              {publicCount}
            </p>
            {renderBreakdown(publicBreakdown)}
          </div>
          <div
            className={`rounded-xl border p-4 sm:p-6 transition-opacity ${
              privateCount === 0 ? "opacity-45" : ""
            } border-purple-500/30 bg-purple-500/10`}
          >
            <div className="flex items-center gap-2 text-purple-700 dark:text-purple-400">
              <EyeOff size={20} />
              <span className="text-sm font-semibold uppercase tracking-wider">
                Private
              </span>
            </div>
            <p
              className="font-display font-extrabold text-purple-700 dark:text-purple-400 leading-none tracking-tight mt-3 tabular-nums"
              style={{ fontSize: "clamp(56px, 12vw, 112px)" }}
            >
              {privateCount}
            </p>
            {renderBreakdown(privateBreakdown)}
          </div>
        </div>

        {/* Bulk moves */}
        <div className="mt-4 flex items-center gap-2 flex-wrap">
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
              Stored as plain tags — anyone can read them. Some clients default
              to public; others ignore public mute lists.
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
              Older NIP-04 private mutes are read too.
            </p>
            <p className="text-mut">
              Client support varies: Damus doesn’t apply private mutes, and
              muting or unmuting there can erase them. Always{" "}
              <button
                type="button"
                onClick={() => setActiveTab("backups")}
                className="underline underline-offset-2 hover:text-hi transition-colors"
              >
                save a backup here
              </button>{" "}
              before switching clients.
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
