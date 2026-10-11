"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Eye,
  EyeOff,
  FileSearch,
  Flag,
  Loader2,
  Radiation,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Copy,
  Check,
  User,
  Bitcoin,
  MessageSquare,
  Send,
  X,
  ArrowUpRight,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import {
  fetchProfile,
  fetchNoteCount,
  getExpandedRelayList,
  searchMutealsNetworkWide,
  searchProfiles,
  searchReportsNetworkWide,
  hexToNpub,
  npubToHex,
  publishTextNote,
  DEFAULT_RELAYS,
} from "@/lib/nostr";
import {
  getMuteScore,
  getMuteRatioSignal,
  formatPerThousand,
} from "@/lib/utils/muteScore";
import {
  countDeletionsBy,
  fetchDmActivity,
  verifyNip05,
  Nip05Status,
  DmActivity,
} from "@/lib/dossier";
import { getExposure, ExposureReport } from "@/lib/keyExposureService";
import { useAuth } from "@/hooks/useAuth";
import { getDisplayName } from "@/lib/utils/format";
import { copyToClipboard } from "@/lib/utils/clipboard";
import { getPostedNoteLink, getPostedNevent } from "@/lib/utils/links";
import AppShell from "@/components/system/AppShell";
import PageHeader from "@/components/system/PageHeader";
import type { Profile } from "@/types";

type Status = "idle" | "running" | "done" | "error";

const PENDING = "Scanning the network…";

export default function Dossier() {
  const searchParams = useSearchParams();
  const { session } = useAuth();
  const [input, setInput] = useState("");
  const [subject, setSubject] = useState<Profile | null>(null);
  const [subjectNpub, setSubjectNpub] = useState<string | null>(null);
  const [hexPubkey, setHexPubkey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showAllReports, setShowAllReports] = useState(false);
  const [expandedReport, setExpandedReport] = useState<number | null>(null);
  const [npubCopied, setNpubCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareText, setShareText] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [shareResult, setShareResult] = useState<string | null>(null);
  const [postedLink, setPostedLink] = useState<string | null>(null);
  const [postedTagged, setPostedTagged] = useState(false);
  const [postedNoteId, setPostedNoteId] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [postedRelays, setPostedRelays] = useState<{
    accepted: number;
    total: number;
  } | null>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const [suggestions, setSuggestions] = useState<Profile[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Per-section state; each scan lands independently.
  const [muteStatus, setMuteStatus] = useState<Status>("idle");
  const [muters, setMuters] = useState<number | null>(null);
  const [muteProgress, setMuteProgress] = useState("");
  const [noteCount, setNoteCount] = useState<number | null>(null);
  const [reportStatus, setReportStatus] = useState<Status>("idle");
  const [reports, setReports] = useState<
    { by: string; type?: string; content?: string; at: number }[] | null
  >(null);
  const [reportProgress, setReportProgress] = useState("");
  const [deletionStatus, setDeletionStatus] = useState<Status>("idle");
  const [deletions, setDeletions] = useState<{
    deletions: number;
    targets: number;
  } | null>(null);
  const [btcStatus, setBtcStatus] = useState<Status>("idle");
  const [btc, setBtc] = useState<ExposureReport | null>(null);
  const [dmStatus, setDmStatus] = useState<Status>("idle");
  const [dms, setDms] = useState<DmActivity | null>(null);
  const [footprintStatus, setFootprintStatus] = useState<Status>("idle");
  const [footprint, setFootprint] = useState<{
    nip05: Nip05Status;
    nip05Claim?: string;
    lightning: boolean;
    picture: boolean;
    bio: boolean;
  } | null>(null);

  const openDossier = async (override?: string) => {
    const query = (override ?? input).trim();
    if (!query) {
      setError("Enter a name, NIP-05 or npub first.");
      return;
    }
    setError(null);
    setSubject(null);
    setSubjectNpub(null);
    resetSections("running");

    let pubkey: string;
    try {
      if (query.startsWith("npub") || query.startsWith("nprofile")) {
        pubkey = npubToHex(query);
      } else if (query.match(/^[0-9a-f]{64}$/i)) {
        pubkey = query;
      } else {
        const profiles = await Promise.race([
          searchProfiles(query, DEFAULT_RELAYS, 10),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("search timeout")), 20000),
          ),
        ]).catch(() => null);
        if (!profiles) {
          setError(
            "Couldn’t reach the relays to look that name up. Try again, or paste an npub.",
          );
          resetSections("idle");
          return;
        }
        if (profiles.length === 0) {
          setError(
            `No user found for "${query}". Try a name, NIP-05, or npub.`,
          );
          resetSections("idle");
          return;
        }
        pubkey = profiles[0].pubkey;
      }
    } catch {
      setError("Invalid npub format. Please check and try again.");
      resetSections("idle");
      return;
    }

    setHexPubkey(pubkey);
    setSubjectNpub(hexToNpub(pubkey));
    // No kind:0 found (or the lookup failed) must not blank the page: the
    // scans below are still meaningful for a bare pubkey.
    fetchProfile(pubkey, DEFAULT_RELAYS)
      .then((profile) => setSubject(profile ?? { pubkey }))
      .catch(() => setSubject({ pubkey }));

    // Same relay basis as Mute-o-Scope and Reportable: the viewer's own
    // relays when logged in, so the counts agree across screens.
    const relays = getExpandedRelayList(session?.relays ?? DEFAULT_RELAYS);

    // The four sections run in parallel and land independently.
    searchMutealsNetworkWide(pubkey, relays, (count) =>
      setMuteProgress(`${count} mute lists collected`),
    )
      .then(async (results) => {
        setMuters(results.length);
        setMuteProgress("");
        setMuteStatus("done");
        try {
          const notes = await fetchNoteCount(pubkey, DEFAULT_RELAYS);
          setNoteCount(notes?.count ?? null);
        } catch {
          setNoteCount(null);
        }
      })
      .catch(() => {
        setMuteProgress("");
        setMuteStatus("error");
      });

    searchReportsNetworkWide(pubkey, relays, (count) =>
      setReportProgress(`${count} report events collected`),
    )
      .then((results) => {
        setReports(
          results
            .map((r) => ({
              by: r.reportedBy,
              type: r.reportType,
              content: r.content,
              at: r.reportedAt,
            }))
            .sort((a, b) => b.at - a.at),
        );
        setReportProgress("");
        setReportStatus("done");
      })
      .catch(() => {
        setReportProgress("");
        setReportStatus("error");
      });

    countDeletionsBy(pubkey, relays)
      .then((result) => {
        setDeletions(result);
        setDeletionStatus("done");
      })
      .catch(() => setDeletionStatus("error"));

    getExposure(hexToNpub(pubkey))
      .then((report) => {
        setBtc(report);
        setBtcStatus("done");
      })
      .catch(() => setBtcStatus("error"));

    fetchDmActivity(pubkey, relays)
      .then((result) => {
        setDms(result);
        setDmStatus("done");
      })
      .catch(() => setDmStatus("error"));

    fetchProfile(pubkey, DEFAULT_RELAYS)
      .then(async (profile) => {
        const nip05Claim = profile?.nip05 || undefined;
        const nip05: Nip05Status = nip05Claim
          ? await verifyNip05(nip05Claim, pubkey)
          : "unverified";
        setFootprint({
          nip05,
          nip05Claim,
          lightning: Boolean(profile?.lud16),
          picture: Boolean(profile?.picture),
          bio: Boolean(profile?.about),
        });
        setFootprintStatus("done");
      })
      .catch(() => setFootprintStatus("error"));
  };

  const resetSections = (status: Status) => {
    setMuteStatus(status);
    setMuters(null);
    setMuteProgress("");
    setNoteCount(null);
    setReportStatus(status);
    setReports(null);
    setReportProgress("");
    setDeletionStatus(status);
    setDeletions(null);
    setFootprintStatus(status);
    setFootprint(null);
    setBtcStatus(status);
    setBtc(null);
    setDmStatus(status);
    setDms(null);
    setCopied(false);
    setShowAllReports(false);
    setExpandedReport(null);
  };

  // Live name suggestions while typing; npubs, hex and NIP-05 skip this.
  useEffect(() => {
    const q = input.trim();
    if (
      q.length < 3 ||
      /^(npub|nprofile)/i.test(q) ||
      /^[0-9a-f]{64}$/i.test(q)
    ) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSuggesting(true);
      try {
        const profiles = await searchProfiles(q, DEFAULT_RELAYS, 8);
        if (cancelled) return;
        setSuggestions(profiles);
        setSelectedIndex(0);
        setShowSuggestions(profiles.length > 0);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setSuggesting(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [input]);

  const pickSuggestion = (profile: Profile) => {
    const npub = hexToNpub(profile.pubkey);
    setShowSuggestions(false);
    setSuggestions([]);
    setInput(npub);
    openDossier(npub);
  };

  // Open directly from ?npub= links (home lookup, shares).
  useEffect(() => {
    const npub = searchParams.get("npub");
    if (npub) {
      setInput(npub);
      openDossier(npub);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const running =
    muteStatus === "running" ||
    reportStatus === "running" ||
    deletionStatus === "running" ||
    btcStatus === "running" ||
    dmStatus === "running" ||
    footprintStatus === "running";

  const npubAction = (path: string, label: string) =>
    subjectNpub ? { href: `${path}?npub=${subjectNpub}`, label } : undefined;

  const buildReport = () => {
    const network: string[] = [];
    if (muters !== null) {
      const score = getMuteScore(muters);
      network.push(
        `🔇 Muted by ${muters} public lists (${score.emoji} ${score.label}${
          noteCount
            ? `, ${formatPerThousand(getMuteRatioSignal(muters, noteCount).perThousand)}/1k notes`
            : ""
        })`,
      );
    }
    if (reports) {
      network.push(
        `🚩 ${reports.length} public report${reports.length === 1 ? "" : "s"} filed`,
      );
    }
    if (deletions) {
      network.push(
        `🗑️ ${deletions.deletions} deletion request${deletions.deletions === 1 ? "" : "s"} published (${deletions.targets} targets)`,
      );
    }
    const identity: string[] = [];
    if (btc) {
      const used = btc.addresses.some((a) => a.txCount > 0);
      identity.push(
        `⛓️ On-chain: ${btc.totalSats.toLocaleString("en-US")} sats at the key-derived address${used ? " (address has history)" : " (never used)"}`,
      );
    }
    if (dms) {
      identity.push(
        `💬 Legacy DMs: ${dms.sent} sent to ${dms.recipients} people, ${dms.received} received from ${dms.senders}`,
      );
    }
    if (footprint) {
      identity.push(
        `🪪 NIP-05: ${footprint.nip05 === "verified" ? "verified" : footprint.nip05 === "mismatch" ? "claimed but mismatched" : "not verified"} · ⚡ Lightning: ${footprint.lightning ? "yes" : "none"}`,
      );
    }
    return [
      session && hexPubkey === session.pubkey
        ? "I just received my dossier from #Mutable 🫆"
        : `I just received the dossier on nostr:${subjectNpub} from #Mutable 🫆`,
      network.join("\n"),
      identity.join("\n"),
      "Run your own: https://mutable.top/dossier",
    ]
      .filter(Boolean)
      .join("\n\n");
  };

  const openShare = () => {
    if (!subjectNpub) return;
    setShareText(buildReport());
    setShareResult(null);
    setPostedLink(null);
    setPostedNoteId(null);
    setLinkCopied(false);
    setShareOpen(true);
  };

  const handlePublish = async () => {
    if (!session || !hexPubkey) return;
    setPublishing(true);
    setShareResult(null);
    try {
      const tags: string[][] = [
        ["t", "Dossier"],
        ["t", "Mutable"],
        ["client", "Mutable"],
      ];
      const tagged = hexPubkey !== session.pubkey;
      if (tagged) tags.unshift(["p", hexPubkey]);
      const result = await publishTextNote(shareText, tags, session.relays);
      if (result.success && result.event) {
        setPostedTagged(tagged);
        setPostedRelays(
          result.report
            ? {
                accepted: result.report.accepted.length,
                total: result.report.total,
              }
            : null,
        );
        // The relays that actually took the note. An account with no relay
        // list publishes to the defaults, and an id with no hints sends the
        // viewer looking on relays that don't have it.
        const hints = {
          relays: result.report?.accepted.length
            ? result.report.accepted
            : session.relays,
          author: result.event.pubkey,
        };
        setPostedLink(getPostedNoteLink(result.event.id, hints));
        setPostedNoteId(getPostedNevent(result.event.id, hints));
      } else if (result.success) {
        setShareOpen(false);
      } else {
        setShareResult(`Couldn’t publish: ${result.error ?? "unknown error"}`);
      }
    } catch {
      setShareResult("Couldn’t publish the note. Try again.");
    } finally {
      setPublishing(false);
    }
  };

  const handleCopy = async () => {
    const ok = await copyToClipboard(buildReport());
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <AppShell navActive="dossier" width="regular">
      <PageHeader
        icon={<FileSearch size={25} />}
        iconBg="from-amber-500 to-amber-700"
        title="The Dossier"
        subtitle="Mute Score, reports, deletions, on-chain Bitcoin, DMs and public footprint — one report, no login."
      />

      {/* Search */}
      <section className="panel relative z-20 rounded-xl border border-line shadow-panel mt-6 animate-rise stagger-1">
        <div className="p-5">
          <div ref={inputRef}>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onBlur={() =>
                    setTimeout(() => setShowSuggestions(false), 150)
                  }
                  onFocus={() =>
                    suggestions.length > 0 && setShowSuggestions(true)
                  }
                  onKeyDown={(e) => {
                    const open = showSuggestions && suggestions.length > 0;
                    if (e.key === "Escape") {
                      setShowSuggestions(false);
                    } else if (open && e.key === "ArrowDown") {
                      e.preventDefault();
                      setSelectedIndex((i) => (i + 1) % suggestions.length);
                    } else if (open && e.key === "ArrowUp") {
                      e.preventDefault();
                      setSelectedIndex(
                        (i) =>
                          (i - 1 + suggestions.length) % suggestions.length,
                      );
                    } else if (e.key === "Enter") {
                      if (open) pickSuggestion(suggestions[selectedIndex]);
                      else openDossier();
                    }
                  }}
                  placeholder="npub, NIP-05, name or hex pubkey"
                  className="w-full px-4 py-2.5 bg-inset border border-line-strong rounded-[10px] text-hi text-sm outline-none focus:border-primary focus:shadow-[0_0_0_3px_rgb(220_38_38/0.18)] transition-all"
                  spellCheck={false}
                />
                {suggesting && (
                  <Loader2
                    size={14}
                    className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-mid"
                  />
                )}
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute z-30 left-0 right-0 mt-1 bg-inset rounded-[10px] border border-line-strong shadow-panel max-h-72 overflow-y-auto">
                    {suggestions.map((p, i) => (
                      <button
                        key={p.pubkey}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => pickSuggestion(p)}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5 ${
                          i === selectedIndex
                            ? "bg-black/5 dark:bg-white/5"
                            : ""
                        }`}
                      >
                        {p.picture ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.picture}
                            alt=""
                            className="w-8 h-8 rounded-full object-cover flex-none"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.visibility =
                                "hidden";
                            }}
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-black/10 dark:bg-white/10 flex-none" />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-hi">
                            {getDisplayName(p)}
                          </span>
                          <span className="block truncate text-xs text-mid">
                            {p.nip05 ||
                              `${p.pubkey.slice(0, 8)}…${p.pubkey.slice(-8)}`}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => openDossier()}
                disabled={running}
                className="px-5 py-2.5 bg-gradient-to-b from-primary to-primary-deep text-white rounded-[10px] font-semibold text-sm shadow-[0_4px_16px_-6px_rgb(220_38_38/0.55),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-105 transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
              >
                {running ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <FileSearch size={15} />
                )}
                Open the Dossier
              </button>
            </div>
            {session && (
              <button
                type="button"
                onClick={() => {
                  const npub = hexToNpub(session.pubkey);
                  setInput(npub);
                  openDossier(npub);
                }}
                disabled={running}
                className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-mid hover:text-hi transition-colors disabled:opacity-50 disabled:pointer-events-none"
              >
                <User size={14} />
                Open my Dossier
              </button>
            )}
            {error && (
              <p className="mt-2.5 text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Subject */}
      {!subject && running && (
        <p className="mt-6 text-sm text-mut flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Resolving subject…
        </p>
      )}
      {subject && (
        <section className="panel relative rounded-xl border border-line shadow-panel mt-5 animate-rise">
          <div className="p-5 flex items-center gap-4 flex-wrap">
            {subject.picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={subject.picture}
                alt=""
                className="w-14 h-14 rounded-full object-cover flex-none border border-line-2"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-black/10 dark:bg-white/10 flex items-center justify-center flex-none">
                <User size={22} className="text-mut" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h2 className="font-display font-bold text-xl tracking-tight text-hi truncate">
                {getDisplayName(subject, "Unknown")}
              </h2>
              {!subject.name && !subject.display_name && (
                <p className="text-xs text-mut mt-0.5">
                  No profile found on the relays we checked
                </p>
              )}
              <button
                type="button"
                onClick={async () => {
                  if (subjectNpub && (await copyToClipboard(subjectNpub))) {
                    setNpubCopied(true);
                    setTimeout(() => setNpubCopied(false), 2000);
                  }
                }}
                title="Copy npub"
                className="mt-0.5 flex items-center gap-1.5 font-mono text-xs text-mut hover:text-hi transition-colors max-w-full"
              >
                <span className="truncate">
                  {subjectNpub
                    ? `${subjectNpub.slice(0, 12)}…${subjectNpub.slice(-8)}`
                    : ""}
                </span>
                {npubCopied ? (
                  <Check size={12} className="flex-none" />
                ) : (
                  <Copy size={12} className="flex-none" />
                )}
              </button>
            </div>
            {session && (
              <button
                onClick={openShare}
                disabled={muteStatus !== "done"}
                className="px-3.5 py-2 bg-inset border border-line-2 text-mid hover:text-hi hover:border-line-strong rounded-[10px] text-[13px] font-semibold transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                title={
                  muteStatus === "done"
                    ? "Publish the report as a note"
                    : "Report still running"
                }
              >
                <Send size={14} />
                Share as note
              </button>
            )}
            <button
              onClick={handleCopy}
              disabled={muteStatus !== "done"}
              className="px-3.5 py-2 bg-inset border border-line-2 text-mid hover:text-hi hover:border-line-strong rounded-[10px] text-[13px] font-semibold transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              title={
                muteStatus === "done"
                  ? "Copy the report"
                  : "Report still running"
              }
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy report"}
            </button>
          </div>
        </section>
      )}

      {/* Findings */}
      {subject && (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Section
            icon={<EyeOff size={16} />}
            tone="purple"
            title="Mute Score"
            action={npubAction("/mute-o-scope", "Open in Mute-o-Scope")}
            status={muteStatus}
            progress={muteProgress}
          >
            {muters !== null ? (
              <>
                <p className="text-3xl font-display font-bold text-hi leading-none">
                  {muters}
                </p>
                <p className="text-sm text-mut mt-1">
                  public mute lists include this account
                </p>
                {(() => {
                  const score = getMuteScore(muters);
                  const ratio =
                    noteCount !== null
                      ? getMuteRatioSignal(muters, noteCount)
                      : null;
                  return (
                    <dl className="mt-4 pt-3 border-t border-line space-y-2 text-sm">
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-mut">Score</dt>
                        <dd className="font-semibold text-hi">
                          {score.emoji} {score.label}
                        </dd>
                      </div>
                      {ratio && (
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-mut">Per 1k notes</dt>
                          <dd className="font-semibold text-hi">
                            {formatPerThousand(ratio.perThousand)}
                            <span className="ml-2 font-normal text-mut">
                              {ratio.label}
                            </span>
                          </dd>
                        </div>
                      )}
                    </dl>
                  );
                })()}
              </>
            ) : null}
          </Section>

          <Section
            icon={<Flag size={16} />}
            tone="orange"
            title="Reports filed"
            action={npubAction("/reportable", "Open in Reportable")}
            status={reportStatus}
            progress={reportProgress}
          >
            {reports ? (
              <>
                <p className="text-3xl font-display font-bold text-hi leading-none">
                  {reports.length}
                </p>
                <p className="text-sm text-mut mt-1">
                  public kind:1984 reports target this account
                </p>
                {reports.length > 0 && (
                  <>
                    <ul className="mt-3 space-y-1.5 max-h-64 overflow-y-auto pr-1">
                      {(showAllReports ? reports : reports.slice(0, 8)).map(
                        (r, i) => (
                          <li key={i}>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedReport(
                                  expandedReport === i ? null : i,
                                )
                              }
                              aria-expanded={expandedReport === i}
                              className={`w-full text-left text-xs text-mid bg-inset border border-line rounded-lg px-2.5 py-1.5 hover:border-line-strong transition-colors break-words ${
                                expandedReport === i ? "" : "line-clamp-2"
                              }`}
                            >
                              {r.type ? (
                                <span className="text-mut">{r.type}: </span>
                              ) : null}
                              {r.content || "(no context given)"}
                            </button>
                          </li>
                        ),
                      )}
                    </ul>
                    {reports.length > 8 && (
                      <button
                        type="button"
                        onClick={() => setShowAllReports((v) => !v)}
                        className="mt-3 block text-xs font-semibold text-mid hover:text-hi transition-colors"
                      >
                        {showAllReports
                          ? "Show fewer"
                          : `Show all ${reports.length}`}
                      </button>
                    )}
                  </>
                )}
              </>
            ) : null}
          </Section>

          <Section
            icon={<Radiation size={16} />}
            tone="red"
            title="Deletions published"
            action={npubAction("/redactable", "Open in Redactable")}
            status={deletionStatus}
          >
            {deletions ? (
              <>
                <p className="text-3xl font-display font-bold text-hi leading-none">
                  {deletions.deletions}
                </p>
                <p className="text-sm text-mut mt-1">
                  deletion requests covering {deletions.targets} distinct{" "}
                  {deletions.targets === 1 ? "event" : "events"}
                </p>
              </>
            ) : null}
          </Section>

          <Section
            icon={<Bitcoin size={16} />}
            tone="amber"
            title="On-chain Bitcoin"
            action={npubAction("/muggable", "Open in Muggable")}
            status={btcStatus}
          >
            {btc ? (
              <>
                <p className="text-3xl font-display font-bold text-hi leading-none">
                  {btc.totalSats.toLocaleString("en-US")}
                  <span className="text-sm font-medium text-mut"> sats</span>
                </p>
                <p className="text-sm text-mut mt-1">
                  at addresses derived from this public key
                </p>
                <ul className="mt-3 space-y-1.5">
                  {btc.addresses
                    .filter(
                      (a) => a.type === "P2TR" || a.txCount > 0 || a.error,
                    )
                    .map((a) => (
                      <li
                        key={a.address}
                        className="text-xs text-mid bg-inset border border-line rounded-lg px-2.5 py-1.5 flex items-center gap-2"
                      >
                        <span className="text-mut flex-none">{a.type}</span>
                        <a
                          href={a.addressUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="truncate hover:text-hi"
                        >
                          {a.address}
                        </a>
                        <span className="ml-auto flex-none text-mut">
                          {a.error
                            ? "lookup failed"
                            : a.txCount === 0
                              ? "unused"
                              : `${a.txCount} tx`}
                        </span>
                      </li>
                    ))}
                </ul>
                {(() => {
                  const hidden = btc.addresses.filter(
                    (a) => !(a.type === "P2TR" || a.txCount > 0 || a.error),
                  ).length;
                  return hidden > 0 ? (
                    <p className="text-xs text-mut mt-2">
                      {hidden} other derived addresses checked, all unused.
                    </p>
                  ) : null;
                })()}
              </>
            ) : null}
          </Section>

          <Section
            icon={<MessageSquare size={16} />}
            tone="blue"
            title="DM history"
            action={npubAction("/snoopable", "Open in Snoopable")}
            status={dmStatus}
          >
            {dms ? (
              <>
                <p className="text-3xl font-display font-bold text-hi leading-none">
                  {dms.sent + dms.received}
                </p>
                <p className="text-sm text-mut mt-1">
                  legacy DMs: {dms.sent} sent to {dms.recipients}{" "}
                  {dms.recipients === 1 ? "person" : "people"}, {dms.received}{" "}
                  received from {dms.senders}
                </p>
                {dms.first !== null && dms.last !== null && (
                  <p className="text-sm text-mid mt-2">
                    {new Date(dms.first * 1000).toLocaleDateString("en-US", {
                      month: "short",
                      year: "numeric",
                    })}{" "}
                    –{" "}
                    {new Date(dms.last * 1000).toLocaleDateString("en-US", {
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                )}
                <p className="text-xs text-mut mt-3">
                  Contents stay encrypted. Only who and when is public, and
                  NIP-17 DMs hide even that.
                </p>
              </>
            ) : null}
          </Section>

          <Section
            icon={<ShieldCheck size={16} />}
            tone="green"
            title="Public footprint"
            status={footprintStatus}
          >
            {footprint ? (
              <ul className="space-y-2 text-sm">
                <FootprintRow
                  ok={footprint.nip05 === "verified"}
                  warn={footprint.nip05 === "mismatch"}
                  label={
                    footprint.nip05 === "verified"
                      ? `NIP-05 verified — ${footprint.nip05Claim}`
                      : footprint.nip05 === "mismatch"
                        ? `NIP-05 mismatch — ${footprint.nip05Claim} points elsewhere`
                        : "NIP-05 not claimed or unverifiable"
                  }
                  warnIcon={
                    footprint.nip05 === "mismatch" ? (
                      <ShieldAlert size={14} />
                    ) : (
                      <ShieldQuestion size={14} />
                    )
                  }
                />
                <FootprintRow
                  ok={footprint.lightning}
                  label={
                    footprint.lightning
                      ? "Lightning address on profile"
                      : "No lightning address"
                  }
                />
                <FootprintRow
                  ok={footprint.picture}
                  label={footprint.picture ? "Avatar set" : "No avatar"}
                />
                <FootprintRow
                  ok={footprint.bio}
                  label={footprint.bio ? "Bio written" : "No bio"}
                />
              </ul>
            ) : null}
          </Section>
        </div>
      )}

      {/* Idle explainer */}
      {muteStatus === "idle" && reportStatus === "idle" && !subject && (
        <p className="mt-6 text-sm text-mut flex items-center gap-2 animate-rise stagger-2">
          <Eye size={15} className="flex-none" />
          Everything here comes from public relays and public block explorers.
          The subject is never told unless you share it.
        </p>
      )}
      {shareOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => !publishing && setShareOpen(false)}
        >
          <div
            className="panel relative rounded-xl border border-line shadow-panel w-full max-w-lg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            {postedLink ? (
              <div className="text-center py-4">
                <div className="mx-auto w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center">
                  <CheckCircle2
                    size={36}
                    className="text-green-600 dark:text-green-400"
                  />
                </div>
                <h3 className="font-display font-bold text-xl tracking-tight text-hi mt-4">
                  Note published
                </h3>
                <p className="text-sm text-mid mt-1.5">
                  Your Dossier is live on Nostr
                  {postedTagged ? ", and the subject was tagged" : ""}.
                </p>
                {postedRelays && (
                  <p className="text-xs text-mut mt-1">
                    Accepted by {postedRelays.accepted} of {postedRelays.total}{" "}
                    {postedRelays.total === 1 ? "relay" : "relays"}. It can take
                    a moment to show up in clients.
                  </p>
                )}
                <div className="mt-6 grid gap-2.5">
                  <a
                    href={postedLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2.5 bg-gradient-to-b from-primary to-primary-deep text-white rounded-[10px] text-sm font-semibold flex items-center justify-center gap-2"
                  >
                    <ExternalLink size={15} />
                    View note on Jumble
                  </a>
                  <button
                    onClick={async () => {
                      if (
                        postedNoteId &&
                        (await copyToClipboard(postedNoteId))
                      ) {
                        setLinkCopied(true);
                        setTimeout(() => setLinkCopied(false), 2000);
                      }
                    }}
                    className="px-4 py-2.5 bg-inset border border-line-2 text-mid hover:text-hi rounded-[10px] text-sm font-semibold flex items-center justify-center gap-2"
                  >
                    {linkCopied ? <Check size={15} /> : <Copy size={15} />}
                    {linkCopied ? "nevent copied" : "Copy nevent"}
                  </button>
                  <button
                    onClick={() => setShareOpen(false)}
                    className="px-4 py-2 text-sm font-semibold text-mut hover:text-hi transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center mb-3">
                  <h3 className="font-display font-semibold text-base tracking-tight text-hi">
                    Share as note
                  </h3>
                  <button
                    onClick={() => setShareOpen(false)}
                    disabled={publishing}
                    className="ml-auto text-mut hover:text-hi"
                    aria-label="Close"
                  >
                    <X size={16} />
                  </button>
                </div>
                <textarea
                  value={shareText}
                  onChange={(e) => setShareText(e.target.value)}
                  rows={10}
                  className="w-full px-3 py-2.5 bg-inset border border-line-strong rounded-[10px] text-hi text-sm font-mono outline-none focus:border-primary"
                />
                <p className="text-xs text-mut mt-2">
                  Publishes a public note from your account
                  {hexPubkey && hexPubkey !== session?.pubkey
                    ? " and tags the subject."
                    : "."}{" "}
                  Edit it first if you like.
                </p>
                {shareResult && (
                  <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                    {shareResult}
                  </p>
                )}
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={() => setShareOpen(false)}
                    disabled={publishing}
                    className="flex-1 px-4 py-2 bg-inset border border-line-2 text-mid hover:text-hi rounded-[10px] text-sm font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handlePublish}
                    disabled={publishing || !shareText.trim()}
                    className="flex-1 px-4 py-2 bg-gradient-to-b from-primary to-primary-deep text-white rounded-[10px] text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {publishing ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : (
                      <Send size={15} />
                    )}
                    {publishing ? "Publishing…" : "Publish note"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Section({
  icon,
  tone,
  title,
  status,
  progress,
  action,
  children,
}: {
  icon: React.ReactNode;
  tone: "purple" | "orange" | "red" | "green" | "amber" | "blue";
  title: string;
  status: Status;
  progress?: string;
  action?: { href: string; label: string };
  children?: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    purple: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
    orange: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    red: "bg-red-500/15 text-red-700 dark:text-red-400",
    green: "bg-green-500/15 text-green-700 dark:text-green-400",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    blue: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  };
  return (
    <section className="panel relative rounded-xl border border-line shadow-panel p-5 flex flex-col">
      <div className="flex items-center gap-2.5 mb-3">
        <span
          className={`w-7 h-7 rounded-lg flex items-center justify-center flex-none ${tones[tone]}`}
        >
          {icon}
        </span>
        <h3 className="font-display font-semibold text-sm tracking-tight text-hi">
          {title}
        </h3>
        {status === "running" && (
          <span className="ml-auto text-xs text-mut flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" />
            {progress || PENDING}
          </span>
        )}
        {status === "error" && (
          <span className="ml-auto text-xs text-red-600 dark:text-red-400">
            scan failed — try again
          </span>
        )}
      </div>
      {status === "running" && !progress ? (
        <div className="space-y-2 mt-3">
          <div className="h-7 rounded-lg bg-black/10 dark:bg-white/10 animate-pulse" />
          <div className="h-3.5 w-2/3 rounded bg-black/10 dark:bg-white/10 animate-pulse" />
        </div>
      ) : (
        <>
          {children}
          {action && status !== "running" && (
            <Link
              href={action.href}
              className="mt-auto pt-4 inline-flex items-center gap-1 text-xs font-semibold text-mid hover:text-hi transition-colors self-start"
            >
              {action.label}
              <ArrowUpRight size={13} />
            </Link>
          )}
        </>
      )}
    </section>
  );
}

function FootprintRow({
  ok,
  warn,
  label,
  warnIcon,
}: {
  ok: boolean;
  warn?: boolean;
  label: string;
  warnIcon?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-2">
      {warn ? (
        <span className="text-amber-600 dark:text-amber-400 flex-none">
          {warnIcon ?? <ShieldAlert size={14} />}
        </span>
      ) : ok ? (
        <ShieldCheck
          size={14}
          className="text-green-600 dark:text-green-400 flex-none"
        />
      ) : (
        <X size={14} className="text-red-600 dark:text-red-400 flex-none" />
      )}
      <span className={ok || warn ? "text-mid" : "text-mut"}>{label}</span>
    </li>
  );
}
