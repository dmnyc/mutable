"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowRightLeft,
  Check,
  Copy,
  RefreshCw,
  X,
} from "lucide-react";
import type { Signer } from "@/lib/signers";
import { copyToClipboard } from "@/lib/utils/clipboard";
import {
  blobUrl,
  listBlobs,
  mirrorBlob,
  serverHost,
  signBlossomAuth,
} from "@/lib/blossom/client";
import { shortServerHost, type MissingBlob } from "@/lib/blossom/inventory";
import Button from "@/components/system/Button";

type Phase = "pick" | "signing" | "mirroring" | "verifying" | "done";

interface RehomeResult {
  listed: boolean;
  newUrl: string;
}

export default function RehomeDialog({
  blob,
  targets,
  pubkey,
  signer,
  onClose,
  onSaved,
}: {
  blob: MissingBlob;
  /** Servers that listed the key during the scan — sane mirror targets. */
  targets: string[];
  pubkey: string;
  signer: Signer;
  onClose: () => void;
  onSaved: (hash: string, server: string, listed: boolean) => void;
}) {
  const [server, setServer] = useState(targets[0] ?? "");
  const [phase, setPhase] = useState<Phase>("pick");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RehomeResult | null>(null);
  const [copied, setCopied] = useState(false);

  const busy = phase === "signing" || phase === "mirroring" || phase === "verifying";

  const go = async () => {
    if (!blob.url || !server) return;
    setError(null);
    let auth: string;
    try {
      setPhase("signing");
      auth = await signBlossomAuth(signer, "upload", { hashes: [blob.hash] });
    } catch (err) {
      setPhase("pick");
      setError(
        err instanceof Error && err.message
          ? `Signing failed: ${err.message}`
          : "Signing was declined.",
      );
      return;
    }

    setPhase("mirroring");
    const mirrored = await mirrorBlob(server, blob.url, blob.hash, auth);
    if (mirrored.status !== "ok") {
      setPhase("pick");
      setError(
        mirrored.status === "unauthorized"
          ? `${shortServerHost(server)} refused the mirror (HTTP ${mirrored.code}).`
          : `The mirror failed: ${mirrored.message}`,
      );
      return;
    }

    // Mirroring is only a rescue if the server lists the blob under this
    // key; the spec leaves that to each server, so check /list and say so.
    setPhase("verifying");
    const listAuth = await signBlossomAuth(signer, "list", {});
    const listing = await listBlobs(server, pubkey, listAuth);
    const listed =
      listing.status === "ok" &&
      listing.blobs.some((entry) => entry.sha256 === blob.hash);
    const newUrl = blobUrl(server, blob.hash);
    setResult({ listed, newUrl });
    setPhase("done");
    onSaved(blob.hash, server, listed);
  };

  const copyNewUrl = async () => {
    if (!result) return;
    if (await copyToClipboard(result.newUrl)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rehome-dialog-title"
    >
      <div className="panel relative rounded-2xl border border-line shadow-panel w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400 flex items-center justify-center flex-none">
              <ArrowRightLeft size={20} />
            </div>
            <div>
              <h2
                id="rehome-dialog-title"
                className="font-display font-bold text-2xl tracking-tight text-hi"
              >
                {phase === "done" ? "Re-homed" : "Re-home this file"}
              </h2>
              <p className="text-sm text-mut font-mono" title={blob.hash}>
                {blob.hash.slice(0, 12)}… from {blob.url ? serverHost(blob.url) : "an unknown host"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-mut hover:text-hi disabled:opacity-40"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {phase !== "done" ? (
            <>
              <p className="text-sm text-mid">
                The link in your posts still works, but no server in your list
                holds this file. Ask a server that does to fetch a copy now —
                the bytes travel server-to-server, not through your device.
              </p>
              <div>
                <div className="text-xs font-semibold text-mut uppercase tracking-wide mb-1.5">
                  Copy to
                </div>
                <div className="space-y-1">
                  {targets.map((candidate) => (
                    <label
                      key={candidate}
                      className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm cursor-pointer transition-colors ${
                        server === candidate
                          ? "border-sky-500/50 bg-sky-500/10 text-hi"
                          : "border-line-2 bg-inset text-mid hover:text-hi"
                      }`}
                    >
                      <input
                        type="radio"
                        name="mirror-target"
                        checked={server === candidate}
                        onChange={() => setServer(candidate)}
                        className="accent-sky-600"
                      />
                      <span className="font-mono">{serverHost(candidate)}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-mid space-y-1.5">
                <p className="font-semibold text-hi flex items-center gap-2">
                  <AlertTriangle size={15} className="text-amber-600 dark:text-amber-400" />
                  Know what this fixes
                </p>
                <ul className="list-disc pl-5 space-y-1 text-[13px]">
                  <li>
                    Your posts keep pointing at the old URL. Afterwards, copy
                    the new link and use it when you repost or repair.
                  </li>
                  <li>
                    Servers may store mirrored bytes without listing them under
                    your key. We check the listing and tell you which happened.
                  </li>
                  <li>Nothing is removed from the old host.</li>
                </ul>
              </div>
            </>
          ) : null}

          {phase === "done" && result ? (
            <div
              className={`rounded-xl border p-4 text-sm space-y-2 ${
                result.listed
                  ? "border-emerald-500/30 bg-emerald-500/10"
                  : "border-amber-500/30 bg-amber-500/10"
              }`}
            >
              <p
                className={`font-semibold flex items-center gap-2 ${
                  result.listed
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-hi"
                }`}
              >
                <Check size={15} />
                {result.listed
                  ? `Saved and listed on ${shortServerHost(server)}`
                  : `Copied, but ${shortServerHost(server)} doesn't list mirrored files under your key`}
              </p>
              {result.listed ? (
                <p className="text-mid">
                  It will show up in your gallery on the next scan.
                </p>
              ) : (
                <p className="text-mid">
                  The bytes are safe there, but scans won't find them. If the
                  old host goes down, a re-upload would claim the copy.
                </p>
              )}
              <div className="flex items-center gap-2 pt-1">
                <code className="flex-1 truncate text-xs text-mut bg-inset border border-line-2 rounded-lg px-2.5 py-2">
                  {result.newUrl}
                </code>
                <Button variant="secondary" onClick={copyNewUrl}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied" : "Copy URL"}
                </Button>
              </div>
            </div>
          ) : null}

          {error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2.5">
            {phase === "done" ? (
              <Button onClick={onClose}>Done</Button>
            ) : (
              <>
                <Button variant="secondary" onClick={onClose} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  onClick={go}
                  disabled={busy || !blob.url}
                  className="min-w-[170px]"
                >
                  {busy ? (
                    <RefreshCw size={15} className="animate-spin" />
                  ) : (
                    <ArrowRightLeft size={15} />
                  )}
                  {phase === "signing"
                    ? "Waiting for signature…"
                    : phase === "mirroring"
                      ? "Mirroring…"
                      : phase === "verifying"
                        ? "Checking the listing…"
                        : `Mirror to ${server ? shortServerHost(server) : "…"}`}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
