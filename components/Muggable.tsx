"use client";

import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store";
import {
  AlertTriangle,
  Search,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Wrench,
  Zap,
  Shield,
  User,
} from "lucide-react";
import {
  getExposure,
  fetchAddressHistory,
  DEFAULT_ESPLORA_ENDPOINT,
  ExposureReport,
  AddressReport,
  LedgerEntry,
} from "@/lib/keyExposureService";
import { hexToNpub, searchProfiles, fetchProfile } from "@/lib/nostr";
import { getDisplayName, truncateNpub } from "@/lib/utils/format";
import { Profile } from "@/types";

function satsToBtc(sats: number): string {
  return (sats / 1e8).toFixed(8);
}

function formatSats(sats: number): string {
  return sats.toLocaleString() + " sats";
}

function formatDate(ts: number | null): string {
  if (!ts) return "pending";
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function truncateAddr(addr: string): string {
  if (addr.length <= 20) return addr;
  return addr.slice(0, 10) + "…" + addr.slice(-8);
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={copy}
      className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
      title="Copy"
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

function AddressRow({
  report,
  endpoint,
  isPrimary,
}: {
  report: AddressReport;
  endpoint: string;
  isPrimary: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<LedgerEntry[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const hasFunds =
    !report.error && report.confirmedSats + report.unconfirmedSats > 0;
  const hasActivity = !report.error && report.txCount > 0;

  const toggleHistory = async () => {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (history !== null) return;
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const entries = await fetchAddressHistory(report.address, endpoint);
      setHistory(entries);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoadingHistory(false);
    }
  };

  return (
    <div
      className={`border rounded-lg overflow-hidden ${
        hasFunds
          ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/10"
          : isPrimary
            ? "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800"
            : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Type badge */}
        <span
          className={`text-xs font-mono font-semibold px-2 py-0.5 rounded flex-shrink-0 ${
            isPrimary
              ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
              : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
          }`}
        >
          {report.type}
          {isPrimary && " ★"}
        </span>

        {/* Address */}
        <a
          href={report.addressUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 min-w-0"
          title={report.address}
        >
          <span className="truncate">{truncateAddr(report.address)}</span>
          <ExternalLink size={11} className="flex-shrink-0" />
        </a>
        <CopyButton text={report.address} />

        <div className="ml-auto flex items-center gap-4 flex-shrink-0">
          {report.error ? (
            <span className="text-xs text-gray-400">unavailable</span>
          ) : (
            <>
              <span
                className={`text-sm font-semibold ${
                  hasFunds
                    ? "text-green-700 dark:text-green-400"
                    : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {formatSats(report.confirmedSats)}
                {report.unconfirmedSats > 0 && (
                  <span className="text-xs font-normal ml-1 text-yellow-600 dark:text-yellow-400">
                    +{formatSats(report.unconfirmedSats)} pending
                  </span>
                )}
              </span>
              <span className="text-xs text-gray-400">
                {report.txCount} tx
              </span>
              {hasActivity && (
                <button
                  onClick={toggleHistory}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                >
                  {expanded ? (
                    <ChevronUp size={14} />
                  ) : (
                    <ChevronDown size={14} />
                  )}
                  history
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Transaction history */}
      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3">
          {loadingHistory && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <RefreshCw size={13} className="animate-spin" />
              Loading history…
            </div>
          )}
          {historyError && (
            <p className="text-sm text-red-500">{historyError}</p>
          )}
          {history && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-gray-400 text-left">
                    <th className="pb-1 pr-4">Date</th>
                    <th className="pb-1 pr-4 text-right">Delta</th>
                    <th className="pb-1 pr-4 text-right">Balance</th>
                    <th className="pb-1">Txid</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry) => (
                    <tr key={entry.txid} className="border-t border-gray-100 dark:border-gray-700">
                      <td className="py-1 pr-4 text-gray-500">
                        {formatDate(entry.time)}
                      </td>
                      <td
                        className={`py-1 pr-4 text-right ${
                          entry.deltaSats >= 0
                            ? "text-green-600 dark:text-green-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {entry.deltaSats >= 0 ? "+" : ""}
                        {entry.deltaSats.toLocaleString()}
                      </td>
                      <td className="py-1 pr-4 text-right text-gray-700 dark:text-gray-300">
                        {entry.runningSats.toLocaleString()}
                      </td>
                      <td className="py-1">
                        <a
                          href={entry.txUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                        >
                          {entry.txid.slice(0, 12)}…
                          <ExternalLink size={10} />
                        </a>
                        {!entry.confirmed && (
                          <span className="text-yellow-500 ml-1">(pending)</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SweepGuide() {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-yellow-200 dark:border-yellow-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-yellow-50 dark:bg-yellow-900/20 text-left"
      >
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-yellow-500 dark:text-yellow-400 flex-shrink-0" />
          <span className="font-semibold text-sm text-yellow-900 dark:text-yellow-200">
            How to sweep these funds to safety
          </span>
        </div>
        {open ? (
          <ChevronUp size={15} className="text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
        ) : (
          <ChevronDown size={15} className="text-yellow-600 dark:text-yellow-400 flex-shrink-0" />
        )}
      </button>

      {open && (
        <div className="px-5 py-4 space-y-4 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-300">
          <p>
            Your <strong>nsec is the Bitcoin private key</strong>. Decoded from
            bech32, it is a 32-byte secp256k1 scalar — the same private key
            that controls the on-chain funds shown above. To move those funds
            to safety, convert the nsec to WIF and either sweep it directly or
            import it as a single-key wallet.
          </p>

          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 space-y-1">
            <p className="font-semibold text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Step 1 — convert nsec to WIF (offline)
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
              Decode the nsec from bech32 to get the 32-byte private key, prepend
              <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">0x80</code>,
              append <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">0x01</code> (compressed),
              then base58check-encode. Never paste your nsec into a website.
              An offline script lives in this repo at <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">tools/nsec-to-wif.mjs</code>:
              run <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">node tools/nsec-to-wif.mjs</code> and paste your nsec at the hidden prompt.
            </p>
          </div>

          <div className="flex items-start gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
            <AlertTriangle size={14} className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed">
              Your nsec is your most sensitive secret. Only enter it into
              software you trust, on a device you own, while offline if
              possible. After importing, always verify the wallet shows the same
              address listed above before broadcasting anything. Mutable never
              asks for your nsec.
            </p>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <p className="font-semibold text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
              Step 2 — pick a wallet to import the WIF
            </p>

            <div className="space-y-4">
              <div className="space-y-2">
                <p className="font-semibold text-gray-900 dark:text-white">
                  Option A — BlueWallet (mobile, easiest)
                </p>
                <ol className="space-y-2 list-none">
                  {[
                    <>Install <a href="https://bluewallet.io" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">BlueWallet</a> on iOS or Android. For maximum safety, do this on a clean device.</>,
                    <>Tap <strong>Add Wallet → Import wallet</strong>.</>,
                    <>Paste the WIF and tap <strong>Import</strong>. BlueWallet scans the address types derivable from that key and creates a single-key wallet for whichever holds funds.</>,
                    <>Verify the displayed address matches one shown above, then <strong>Send</strong> the full balance to a fresh address in a wallet whose key was never used as an nsec.</>,
                  ].map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 text-xs font-bold flex items-center justify-center">
                        {i + 1}
                      </span>
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="space-y-2">
                <p className="font-semibold text-gray-900 dark:text-white">
                  Option B — Sparrow (desktop, sweep without a wallet file)
                </p>
                <ol className="space-y-2 list-none">
                  {[
                    <>Open <a href="https://sparrowwallet.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">Sparrow Wallet</a> and create or open any normal wallet you control (the <em>destination</em>, not the funded key).</>,
                    <>From the top menu: <strong>Tools → Sweep Privkey…</strong> Paste the WIF.</>,
                    <>Sparrow scans the addresses derivable from that key (P2PKH, P2WPKH, P2TR, …), shows any balance, and lets you choose a destination, fee, and broadcast — no wallet file is created from the funded key.</>,
                  ].map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 text-xs font-bold flex items-center justify-center">
                        {i + 1}
                      </span>
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="space-y-2">
                <p className="font-semibold text-gray-900 dark:text-white">
                  Option C — Electrum (desktop, single-key wallet)
                </p>
                <ol className="space-y-2 list-none">
                  {[
                    <>Install <a href="https://electrum.org" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">Electrum</a> (4.5+ recommended for Taproot support).</>,
                    <>File → <strong>New/Restore</strong>, give it a temporary name → <strong>Standard wallet</strong> → <strong>Use public or private keys</strong>.</>,
                    <>Paste your WIF prefixed with the script type that matches where your funds live — <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">p2wpkh:</code> for native SegWit, <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">p2wpkh-p2sh:</code> for wrapped SegWit, <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">p2pkh:</code> for legacy. Taproot single-key import in Electrum is version-dependent; if it does not work, fall back to Sparrow Sweep.</>,
                    <>Verify the displayed address matches one above, then send the full balance to a fresh wallet.</>,
                  ].map((step, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 text-xs font-bold flex items-center justify-center">
                        {i + 1}
                      </span>
                      <span className="leading-relaxed">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>

          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed border-t border-gray-200 dark:border-gray-700 pt-3">
            Realistically, you probably will not rotate your nsec — your
            social graph, history, and verifications live on it. The practical
            mitigation is simpler: never accept Bitcoin on-chain to this
            address again, and tell zappers to use Lightning. The exposure
            itself is permanent — anyone who ever saw your nsec can re-derive
            the same key and sweep anything sent to it — but new funds only
            land there if you let them.
          </p>
        </div>
      )}
    </div>
  );
}

function ResultsCard({
  report,
  endpoint,
  profile,
}: {
  report: ExposureReport;
  endpoint: string;
  profile: Profile | null;
}) {
  const [showSecondary, setShowSecondary] = useState(false);
  const isFunded = report.totalSats > 0;

  const primaryAddr = report.addresses.find((a) => a.type === "P2TR");
  const secondaryAddrs = report.addresses.filter((a) => a.type !== "P2TR");

  const fetchedAt = new Date(report.fetchedAt).toUTCString();

  return (
    <div className="space-y-4">
      {/* Total summary */}
      {isFunded ? (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            {profile?.picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.picture}
                alt=""
                className="w-11 h-11 rounded-full object-cover flex-shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center flex-shrink-0">
                <User size={20} className="text-white" />
              </div>
            )}
            <div className="min-w-0">
              <p className="font-semibold text-green-900 dark:text-green-100 truncate">
                {profile ? getDisplayName(profile) : truncateNpub(report.npub)}
              </p>
              {profile?.nip05 && (
                <p className="text-xs text-green-700 dark:text-green-300 truncate">
                  ✓ {profile.nip05}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-start gap-2 border-t border-green-200 dark:border-green-700 pt-3">
            <AlertTriangle size={16} className="text-green-700 dark:text-green-300 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-green-900 dark:text-green-100 text-sm">
                Muggable — this key controls Bitcoin
              </p>
              <p className="text-sm text-green-800 dark:text-green-200 mt-0.5">
                {satsToBtc(report.totalSats)} BTC ({formatSats(report.totalSats)})
                — an exposed nsec can be swept.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-3">
            {profile?.picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.picture}
                alt=""
                className="w-11 h-11 rounded-full object-cover flex-shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="w-11 h-11 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center flex-shrink-0">
                <User size={20} className="text-white" />
              </div>
            )}
            <div className="min-w-0">
              <p className="font-semibold text-blue-900 dark:text-blue-100 truncate">
                {profile ? getDisplayName(profile) : truncateNpub(report.npub)}
              </p>
              {profile?.nip05 && (
                <p className="text-xs text-blue-700 dark:text-blue-300 truncate">
                  ✓ {profile.nip05}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 border-t border-blue-200 dark:border-blue-700 pt-3">
            <Shield size={16} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
            <p className="text-sm text-blue-800 dark:text-blue-200">
              No funds found across all derived addresses.
            </p>
          </div>
        </div>
      )}

      {/* Identity info */}
      <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg px-4 py-3 text-xs font-mono text-gray-500 dark:text-gray-400 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-gray-400">npub</span>
          <span className="text-gray-700 dark:text-gray-300 break-all">
            {report.npub}
          </span>
          <CopyButton text={report.npub} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-400">hex</span>
          <span className="text-gray-700 dark:text-gray-300 break-all">
            {report.pubkeyHex}
          </span>
          <CopyButton text={report.pubkeyHex} />
        </div>
      </div>

      {/* Primary address (P2TR canonical) */}
      {primaryAddr && (
        <div>
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
            Canonical Taproot address (BIP341 key-path)
          </p>
          <AddressRow
            report={primaryAddr}
            endpoint={endpoint}
            isPrimary={true}
          />
        </div>
      )}

      {/* Secondary addresses */}
      <div>
        <button
          onClick={() => setShowSecondary(!showSecondary)}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors mb-2"
        >
          {showSecondary ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          {showSecondary ? "Hide" : "Show"} {secondaryAddrs.length} legacy /
          secondary addresses
          {secondaryAddrs.some(
            (a) => !a.error && a.confirmedSats + a.unconfirmedSats > 0
          ) && (
            <span className="ml-1 text-red-500">⚠ some funded</span>
          )}
        </button>

        {showSecondary && (
          <div className="space-y-2">
            {secondaryAddrs.map((addr) => (
              <AddressRow
                key={addr.type}
                report={addr}
                endpoint={endpoint}
                isPrimary={false}
              />
            ))}
          </div>
        )}
      </div>

      {/* Sweep guide — only when funded */}
      {isFunded && <SweepGuide />}

      {/* Source + timestamp */}
      <p className="text-xs text-gray-400 dark:text-gray-500">
        Source:{" "}
        <a
          href={report.source}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          {report.source}
        </a>{" "}
        · Fetched at {fetchedAt}
      </p>
    </div>
  );
}

export default function Muggable({ initialQuery }: { initialQuery?: string }) {
  const { session } = useAuth();
  const { userProfile } = useStore();
  const searchParams = useSearchParams();

  const [input, setInput] = useState(initialQuery ?? "");
  const [endpoint, setEndpoint] = useState(DEFAULT_ESPLORA_ENDPOINT);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<{
    phase: string;
    current: number;
    total: number;
  } | null>(null);
  const [report, setReport] = useState<ExposureReport | null>(null);
  const [checkedProfile, setCheckedProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<boolean>(false);

  // Profile search
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Profile search with debounce
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    if (
      !input.trim() ||
      input.startsWith("npub") ||
      input.startsWith("nprofile") ||
      /^[0-9a-f]{64}$/i.test(input) ||
      input.includes(".")
    ) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchProfiles(input, session?.relays, 10);
        setSearchResults(results);
        setShowDropdown(results.length > 0);
      } catch {
        // silently ignore search errors
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [input, session?.relays]);

  const hasAutoRun = useRef(false);

  // Auto-run from path segment (e.g. /muggable/npub1…) or ?npub= query param
  useEffect(() => {
    if (hasAutoRun.current) return;
    const query = initialQuery ?? searchParams.get("npub");
    if (query) {
      hasAutoRun.current = true;
      setInput(query);
      handleCheckWith(query);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectProfile = (profile: Profile) => {
    const npub = hexToNpub(profile.pubkey);
    setInput(npub);
    setShowDropdown(false);
    setSearchResults([]);
    handleCheckWith(npub);
  };

  const handleCheckWith = async (query: string) => {
    if (!query.trim()) return;

    setChecking(true);
    setError(null);
    setReport(null);
    setCheckedProfile(null);
    setProgress(null);
    setShowDropdown(false);
    abortRef.current = false;

    try {
      const result = await getExposure(query, endpoint, (phase, current, total) => {
        if (!abortRef.current) {
          setProgress({ phase, current, total });
        }
      });
      if (!abortRef.current) {
        setReport(result);
        // Fetch profile in the background — non-blocking
        fetchProfile(result.pubkeyHex, session?.relays).then((p) => {
          if (!abortRef.current) setCheckedProfile(p);
        }).catch(() => {});
      }
    } catch (e) {
      if (!abortRef.current) {
        setError(e instanceof Error ? e.message : "Unknown error");
      }
    } finally {
      setChecking(false);
      setProgress(null);
    }
  };

  const handleCheck = async () => {
    let query = input.trim();
    if (!query) return;

    // If the input looks like a name (not npub/hex/nip05), resolve it first
    if (
      !query.startsWith("npub") &&
      !query.startsWith("nprofile") &&
      !/^[0-9a-f]{64}$/i.test(query) &&
      !query.includes(".")
    ) {
      const profiles = await searchProfiles(query, session?.relays, 1);
      if (!profiles.length) {
        setError("Could not find a user matching that name.");
        return;
      }
      query = hexToNpub(profiles[0].pubkey);
      setInput(query);
    }

    handleCheckWith(query);
  };

  const handleStop = () => {
    abortRef.current = true;
    setChecking(false);
    setProgress(null);
  };


  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-lg">
            <Wrench size={22} className="text-red-600 dark:text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Muggable
          </h1>
        </div>
        <p className="text-gray-600 dark:text-gray-400 text-sm">
          Check whether a Nostr identity controls Bitcoin on-chain. A Nostr
          public key is a secp256k1 key — the same curve Bitcoin uses. Anyone
          who knows your npub can derive your Bitcoin addresses.
        </p>
      </div>

      {/* Input */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-4">
        <div className="relative">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              />
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !checking && handleCheck()}
                onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                placeholder="npub1… / username / NIP-05 / hex"
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500 font-mono"
                disabled={checking}
              />
              {isSearching && (
                <RefreshCw
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin pointer-events-none"
                />
              )}
            </div>
            {checking ? (
              <button
                onClick={handleStop}
                className="px-4 py-2 text-sm bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors flex items-center gap-2"
              >
                Stop
              </button>
            ) : (
              <>
                <button
                  onClick={handleCheck}
                  disabled={!input.trim()}
                  className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
                >
                  <Search size={15} />
                  Check
                </button>
                {session && (
                  <button
                    onClick={() => {
                      try {
                        const npub = hexToNpub(session.pubkey);
                        setInput(npub);
                        handleCheckWith(npub);
                      } catch {
                        // ignore
                      }
                    }}
                    className="px-4 py-2 text-sm border border-red-400 dark:border-red-600 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center gap-2 whitespace-nowrap"
                  >
                    <User size={15} />
                    Check me
                  </button>
                )}
              </>
            )}
          </div>

          {/* Search dropdown */}
          {showDropdown && searchResults.length > 0 && (
            <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-64 overflow-y-auto">
              {searchResults.map((profile) => (
                <button
                  key={profile.pubkey}
                  onClick={() => handleSelectProfile(profile)}
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
                >
                  {profile.picture ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={profile.picture}
                      alt=""
                      className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = `https://api.dicebear.com/7.x/bottts/svg?seed=${profile.pubkey}`;
                      }}
                    />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-red-400 to-red-500 flex items-center justify-center flex-shrink-0">
                      <User size={16} className="text-white" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-gray-900 dark:text-white truncate">
                      {getDisplayName(profile)}
                    </div>
                    {profile.nip05 && (
                      <div className="text-xs text-green-600 dark:text-green-400 truncate">
                        ✓ {profile.nip05}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Advanced: custom endpoint */}
        <details className="text-xs">
          <summary className="cursor-pointer text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            Advanced options
          </summary>
          <div className="mt-2 flex items-center gap-2">
            <label className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
              Esplora endpoint
            </label>
            <input
              type="text"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              className="flex-1 px-2 py-1 border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-mono"
            />
          </div>
          <p className="mt-1 text-gray-400">
            Point to your own Esplora instance for privacy. Queries leak the
            looked-up addresses to the configured endpoint.
          </p>
        </details>
      </div>

      {/* Loading */}
      {checking && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3">
            <RefreshCw
              size={16}
              className="animate-spin text-red-500"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              {progress
                ? `Checking ${progress.phase}… (${progress.current}/${progress.total})`
                : "Resolving identity…"}
            </span>
          </div>
          {progress && (
            <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-red-500 transition-all duration-300"
                style={{
                  width: `${(progress.current / progress.total) * 100}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Results */}
      {report && (
        <ResultsCard report={report} endpoint={endpoint} profile={checkedProfile} />
      )}

      {/* Warning: on-chain zaps */}
      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-3">
          <AlertTriangle
            size={18}
            className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5"
          />
          <div>
            <p className="font-semibold text-red-900 dark:text-red-200 text-sm">
              On-chain Bitcoin zaps are a privacy trap
            </p>
            <p className="text-sm text-red-800 dark:text-red-300 mt-1 leading-relaxed">
              When anyone sends you Bitcoin on-chain using your Nostr key, it
              creates a <strong>permanent, public, immutable</strong> record on
              the Bitcoin blockchain. Because your address is deterministically
              derived from your public key, senders do not need your permission
              — they can fund your address without you asking for it. Every
              transaction is forever visible to everyone, linking your Nostr
              identity to your full financial history.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 border-t border-yellow-200 dark:border-yellow-800 pt-3">
          <Zap
            size={16}
            className="text-yellow-500 dark:text-yellow-400 flex-shrink-0 mt-0.5"
          />
          <p className="text-sm text-yellow-900 dark:text-yellow-200">
            <strong>Use Lightning zaps instead.</strong> Lightning payments
            route through channels and do not create a permanent on-chain record
            tied to your Nostr identity. They are faster, cheaper, and private.
          </p>
        </div>
      </div>
    </div>
  );
}
