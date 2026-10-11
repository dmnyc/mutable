"use client";

import { useEffect, useRef, useState } from "react";
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
  DEFAULT_RELAYS,
} from "@/lib/nostr";
import {
  getMuteScore,
  getMuteRatioSignal,
  formatPerThousand,
} from "@/lib/utils/muteScore";
import { countDeletionsBy, verifyNip05, Nip05Status } from "@/lib/dossier";
import { getDisplayName } from "@/lib/utils/format";
import { copyToClipboard } from "@/lib/utils/clipboard";
import AppShell from "@/components/system/AppShell";
import PageHeader from "@/components/system/PageHeader";
import type { Profile } from "@/types";

type Status = "idle" | "running" | "done" | "error";

const PENDING = "Scanning the network…";

export default function Dossier() {
  const searchParams = useSearchParams();
  const [input, setInput] = useState("");
  const [subject, setSubject] = useState<Profile | null>(null);
  const [subjectNpub, setSubjectNpub] = useState<string | null>(null);
  const [hexPubkey, setHexPubkey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLDivElement>(null);

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
  const [deletions, setDeletions] = useState<
    { deletions: number; targets: number } | null
  >(null);
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
    if (!query) return;
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
        const profiles = await searchProfiles(query, DEFAULT_RELAYS, 10);
        if (profiles.length === 0) {
          setError(`No user found for "${query}". Try a name, NIP-05, or npub.`);
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
    fetchProfile(pubkey, DEFAULT_RELAYS)
      .then((profile) => setSubject(profile))
      .catch(() => setSubject(null));

    const relays = getExpandedRelayList(DEFAULT_RELAYS);

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
    setCopied(false);
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
    footprintStatus === "running";

  const buildReport = () => {
    const name = subject ? getDisplayName(subject) : subjectNpub;
    const lines: string[] = [];
    lines.push(`The Dossier — ${name}`);
    lines.push(`${subjectNpub}`);
    if (muters !== null) {
      const score = getMuteScore(muters);
      lines.push(
        `Muted by ${muters} public lists (${score.emoji} ${score.label}${
          noteCount
            ? `, ${formatPerThousand(getMuteRatioSignal(muters, noteCount).perThousand)}/1k notes`
            : ""
        })`,
      );
    }
    if (reports) {
      lines.push(
        `${reports.length} public report${reports.length === 1 ? "" : "s"} filed`,
      );
    }
    if (deletions) {
      lines.push(
        `${deletions.deletions} deletion request${deletions.deletions === 1 ? "" : "s"} published (${deletions.targets} targets)`,
      );
    }
    if (footprint) {
      lines.push(
        `NIP-05: ${footprint.nip05 === "verified" ? "verified" : footprint.nip05 === "mismatch" ? "claimed but mismatched" : "not verified"} · Lightning: ${footprint.lightning ? "yes" : "none"}`,
      );
    }
    lines.push(`Run your own: https://mutable.top/dossier?npub=${subjectNpub}`);
    return lines.join("\n");
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
        subtitle="Mute Score, reports, deletions and public footprint — one report, no login."
      />

      {/* Search */}
      <section className="panel relative rounded-xl border border-line shadow-panel mt-6 animate-rise stagger-1">
        <div className="p-5">
          <div ref={inputRef}>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") openDossier();
                }}
                placeholder="npub, NIP-05, name or hex pubkey"
                className="flex-1 px-4 py-2.5 bg-inset border border-line-strong rounded-[10px] text-hi text-sm outline-none focus:border-primary focus:shadow-[0_0_0_3px_rgb(220_38_38/0.18)] transition-all"
                spellCheck={false}
              />
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
              <p className="font-mono text-xs text-mut mt-0.5 break-all">
                {subjectNpub}
              </p>
            </div>
            <button
              onClick={handleCopy}
              disabled={muteStatus !== "done"}
              className="px-3.5 py-2 bg-inset border border-line-2 text-mid hover:text-hi hover:border-line-strong rounded-[10px] text-[13px] font-semibold transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
              title={muteStatus === "done" ? "Copy the report" : "Report still running"}
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
                    <p className="text-sm text-hi mt-2">
                      {score.emoji} {score.label}
                      {ratio && (
                        <span className="text-mut">
                          {" "}
                          · {formatPerThousand(ratio.perThousand)}/1k notes (
                          {ratio.label})
                        </span>
                      )}
                    </p>
                  );
                })()}
              </>
            ) : null}
          </Section>

          <Section
            icon={<Flag size={16} />}
            tone="orange"
            title="Reports filed"
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
                  <ul className="mt-3 space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {reports.slice(0, 8).map((r, i) => (
                      <li
                        key={i}
                        className="text-xs text-mid bg-inset border border-line rounded-lg px-2.5 py-1.5 truncate"
                      >
                        {r.type ? (
                          <span className="text-mut">{r.type}: </span>
                        ) : null}
                        {r.content || "(no context given)"}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : null}
          </Section>

          <Section
            icon={<Radiation size={16} />}
            tone="red"
            title="Deletions published"
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
          Everything here comes from public relays. The subject is never told.
        </p>
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
  children,
}: {
  icon: React.ReactNode;
  tone: "purple" | "orange" | "red" | "green";
  title: string;
  status: Status;
  progress?: string;
  children?: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    purple: "bg-purple-500/15 text-purple-700 dark:text-purple-400",
    orange: "bg-orange-500/15 text-orange-700 dark:text-orange-400",
    red: "bg-red-500/15 text-red-700 dark:text-red-400",
    green: "bg-green-500/15 text-green-700 dark:text-green-400",
  };
  return (
    <section className="panel relative rounded-xl border border-line shadow-panel p-5">
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
        children
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
        <span className="w-[14px] text-center text-mut flex-none">—</span>
      )}
      <span className={ok || warn ? "text-mid" : "text-mut"}>{label}</span>
    </li>
  );
}
