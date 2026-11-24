"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { Check, Copy, Download, Eye, Link2, Loader2, Search, User, X } from "lucide-react";
import html2canvas from "html2canvas";
import AppShell from "@/components/system/AppShell";
import PageHeader from "@/components/system/PageHeader";
import NoteReview from "@/components/system/NoteReview";
import ZombieHand from "@/components/ZombieHand";
import { useAuth } from "@/hooks/useAuth";
import { useStore } from "@/lib/store";
import {
  checkZombie,
  formatGone,
  ZombieCheckResult,
} from "@/lib/zombieCheck";
import { buildZombieShareNote } from "@/lib/zombieShare";
import {
  canvasToBlob,
  loadImageAsBase64,
  uploadImageToBlossom,
} from "@/lib/imageUpload";
import {
  fetchEventById,
  hexToNpub,
  publishTextNote,
  searchProfiles,
  DEFAULT_RELAYS,
} from "@/lib/nostr";
import {
  isDirectLookup,
  noUserFoundMessage,
  resolveLookupInput,
} from "@/lib/lookupInput";
import { getPostedNoteLink } from "@/lib/utils/links";
import { copyToClipboard } from "@/lib/utils/clipboard";
import { getDisplayName } from "@/lib/utils/format";
import { Profile } from "@/types";

const PVZ_URL = "https://plebsvszombies.cc";

// Verdict artwork and colors, ported from Plebs vs. Zombies' Zombie Check.
// The "Alive" heart is the same Noto anatomical-heart SVG PVZ ships as its
// U+1FAC0 fallback (public/heart_anatomical.svg) — rendered unconditionally
// so every platform sees identical artwork instead of betting on the emoji
// font (Windows 10 never got Emoji 13.0 and shows a blank box for 🫀).
const VERDICTS: Record<
  ZombieCheckResult["category"],
  { emoji: string; icon?: string; label: string; text: string; border: string; beat?: boolean }
> = {
  active: {
    emoji: "💚",
    icon: "/heart_anatomical.svg",
    label: "Alive!",
    text: "text-green-600 dark:text-green-400",
    border: "border-green-600/50 dark:border-green-500/40 bg-green-500/10",
    beat: true,
  },
  infected: {
    emoji: "💛",
    label: "Possible Infection",
    text: "text-yellow-600 dark:text-yellow-300",
    border: "border-yellow-500/50 bg-yellow-500/10",
  },
  fresh: {
    emoji: "⚰️",
    label: "Fresh Zombie",
    text: "text-yellow-600 dark:text-yellow-400",
    border: "border-yellow-600/50 bg-yellow-500/10",
  },
  rotting: {
    emoji: "🪦",
    label: "Rotting Zombie",
    text: "text-orange-600 dark:text-orange-400",
    border: "border-orange-600/50 bg-orange-500/10",
  },
  ancient: {
    emoji: "💀",
    label: "Ancient Zombie",
    text: "text-red-600 dark:text-red-400",
    border: "border-red-700/50 bg-red-500/10",
  },
  burned: {
    emoji: "🔥",
    label: "Burned",
    text: "text-gray-600 dark:text-gray-300",
    border: "border-gray-500/50 bg-gray-500/10",
  },
};

const DELETION_LINES: Record<
  ZombieCheckResult["deletion"]["state"],
  { icon: string; text: string }
> = {
  current: { icon: "⚠️", text: "This profile is currently flagged as deleted." },
  past: {
    icon: "🩹",
    text: "A past deletion request was found in this profile's history, but it looks like it has since been restored.",
  },
  none: { icon: "✅", text: "No deletion request found." },
};

function shortNpub(npub: string) {
  return npub ? `${npub.slice(0, 12)}…${npub.slice(-6)}` : "";
}

/** The one-line explanation under the verdict. */
function verdictDetail(result: ZombieCheckResult): string {
  const gone = formatGone(result.daysSinceActivity);

  switch (result.category) {
    case "burned":
      return "This account has been marked as deleted.";
    case "infected":
      return `Quiet for ${gone}. Has anyone done a wellness visit lately?`;
    case "active":
      return gone
        ? `Active — last seen ${gone} ago.`
        : "Active recently.";
    case "ancient":
    case "rotting":
    case "fresh":
      return gone == null
        ? "No activity found on any relay we checked."
        : `Gone for ${gone}.`;
  }
}

/** Relative "marked deleted N ago" for the deletion status line. */
function goneText(sinceTs: number): string {
  return formatGone(Math.floor((Date.now() / 1000 - sinceTs) / 86400)) ?? "";
}

/** The deletion-status line for a result, icon included. */
function deletionLineText(result: ZombieCheckResult): string {
  const text =
    result.deletion.state === "current" && result.deletion.markedAt
      ? `This profile is currently flagged as deleted (marked deleted ${goneText(result.deletion.markedAt)}).`
      : DELETION_LINES[result.deletion.state].text;
  return `${DELETION_LINES[result.deletion.state].icon} ${text}`;
}

// 268-byte fallback avatar, inlined — the face shown when a profile has no
// picture, and the swap-in when a cross-origin avatar can't be proxied for
// the shared-image capture.
const DEFAULT_AVATAR_DATA_URL =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iIzM3NDE1MSIvPgogIDxjaXJjbGUgY3g9IjE2IiBjeT0iMTIiIHI9IjUiIGZpbGw9IiM5Q0EzQUYiLz4KICA8cGF0aCBkPSJNNiAyNmMwLTUuNSA0LjUtMTAgMTAtMTBzMTAgNC41IDEwIDEwIiBmaWxsPSIjOUNBM0FGIi8+Cjwvc3ZnPg==";

// html2canvas re-fetches every image itself and silently drops any that
// fail — a flaky same-origin re-fetch of a logo cost captured PNGs their
// header art and left the byline logos staggered. Every SVG in the capture
// is fetched once as a data URL and kept, so the capture never depends on
// a second network round-trip.
const svgDataUrlCache = new Map<string, string>();
async function sameOriginSvgDataUrl(path: string): Promise<string | null> {
  const cached = svgDataUrlCache.get(path);
  if (cached) return cached;
  try {
    const svg = await (await fetch(path)).text();
    const dataUrl =
      "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
    svgDataUrlCache.set(path, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

export default function ZombieCheck({ initialQuery }: { initialQuery?: string }) {
  const { session } = useAuth();
  const searchParams = useSearchParams();

  const [input, setInput] = useState(initialQuery ?? "");
  const [checking, setChecking] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ZombieCheckResult | null>(null);

  // Profile search dropdown
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Bumping this invalidates any in-flight check, the way Muggable's stop
  // flag does, so a stale run can never overwrite a newer one.
  const runIdRef = useRef(0);

  // Share flow (ported from Plebs vs. Zombies' Zombie Check): capture the
  // result card as a PNG, upload it to Blossom, and hand the user a finished
  // note / download / link. Share as Note is signed-in territory; everyone
  // else gets the copy-and-post-yourself path.
  const { signer } = useStore();
  const resultCardRef = useRef<HTMLDivElement>(null);
  const captureFrameRef = useRef<HTMLDivElement>(null);
  const captureVerdictRef = useRef<HTMLDivElement>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const [shareStatusKind, setShareStatusKind] = useState<
    "success" | "error" | null
  >(null);
  const [shareIncludeImage, setShareIncludeImage] = useState(true);
  const [copiedNoteText, setCopiedNoteText] = useState(false);
  const [copiedImageLink, setCopiedImageLink] = useState(false);
  const [copiedDirectLink, setCopiedDirectLink] = useState(false);
  // Caches the Blossom URL for the current result so repeated share actions
  // don't re-upload.
  const uploadedImageUrlRef = useRef<string | null>(null);
  // The rendered card, kept so the preview, the upload, and the post all
  // use the same image instead of re-capturing it.
  const shareBlobRef = useRef<Blob | null>(null);
  // Preview step before "Share as Note" signs anything.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null);
  const [publishedNoteUrl, setPublishedNoteUrl] = useState<string | null>(
    null,
  );
  const canPublishNotes = Boolean(session?.pubkey && signer);
  // Mirror of `result` for the async share closures.
  const resultRef = useRef<ZombieCheckResult | null>(null);
  const captureWordmarkRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    resultRef.current = result;
    if (!result) {
      uploadedImageUrlRef.current = null;
      shareBlobRef.current = null;
    }
  }, [result]);

  // Debounced profile search for plain names
  useEffect(() => {
    if (!input.trim() || isDirectLookup(input) || input.includes(".")) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    const timeout = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchProfiles(input, session?.relays, 10);
        setSearchResults(results);
        setShowDropdown(results.length > 0);
      } catch {
        // search failures just leave the dropdown closed
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [input, session?.relays]);

  const runCheck = async (query: string) => {
    const runId = ++runIdRef.current;
    setChecking(true);
    setError(null);
    setResult(null);
    setShowDropdown(false);
    clearShareState();
    setStage("Resolving profile…");

    try {
      // Identifiers (npub, nprofile, nevent, hex…) resolve directly; plain
      // names resolve through the top profile-search match.
      const resolution = await resolveLookupInput(query, (id, relays) =>
        fetchEventById(id, relays.length ? relays : DEFAULT_RELAYS),
      );
      if (resolution.ok === false) throw new Error(resolution.message);
      let target: string;
      if (resolution.ok === true) {
        target = resolution.pubkey;
      } else {
        // A name or NIP-05 address: take the top profile-search match.
        const profiles = await searchProfiles(
          resolution.query,
          session?.relays,
          1,
        );
        if (!profiles.length) {
          throw new Error(noUserFoundMessage(resolution.query));
        }
        target = profiles[0].pubkey;
      }

      const res = await checkZombie(target, (s) => {
        if (runId === runIdRef.current) setStage(s);
      });
      if (runId !== runIdRef.current) return;
      setResult(res);
    } catch (e) {
      if (runId === runIdRef.current) {
        setError(
          e instanceof Error ? e.message : "Failed to check this user. Try again.",
        );
      }
    } finally {
      if (runId === runIdRef.current) {
        setChecking(false);
        setStage(null);
      }
    }
  };

  // Deep link: /zombie-check?npub=… pre-fills and auto-runs the check, so a
  // shared link replays the check live.
  const hasAutoRun = useRef(false);
  useEffect(() => {
    if (hasAutoRun.current) return;
    const query = initialQuery ?? searchParams.get("npub");
    if (query) {
      hasAutoRun.current = true;
      setInput(query);
      runCheck(query);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = () => {
    runIdRef.current++;
    setInput("");
    setResult(null);
    setError(null);
    setStage(null);
    setShowDropdown(false);
    clearShareState();
  };

  const clearShareState = () => {
    setShareBusy(false);
    setShareStatus("");
    setShareStatusKind(null);
    setCopiedNoteText(false);
    setCopiedImageLink(false);
    setCopiedDirectLink(false);
    uploadedImageUrlRef.current = null;
    shareBlobRef.current = null;
    closeSharePreview();
    setPublishedNoteUrl(null);
  };

  const closeSharePreview = () => {
    setPreviewOpen(false);
    setPreviewImageSrc((src) => {
      if (src) URL.revokeObjectURL(src);
      return null;
    });
  };

  const copyDirectLink = async () => {
    const result = resultRef.current;
    if (!result) return;
    const ok = await copyToClipboard(
      `https://mutable.top/zombie-check?npub=${result.npub}`,
    );
    if (ok) {
      setCopiedDirectLink(true);
      setTimeout(() => setCopiedDirectLink(false), 2000);
    }
  };

  // ---- Share pipeline (Plebs vs. Zombies port) ----

  const shareModel = (result: ZombieCheckResult) => {
    const verdict = VERDICTS[result.category];
    return {
      pubkey: result.pubkey,
      npub: result.npub,
      name: result.name,
      displayName: result.displayName,
      verdictLine: `${verdict.emoji} ${verdict.label}`,
      detail: verdictDetail(result),
      deletionLine: deletionLineText(result),
    };
  };

  // The shared PNG is captured from an off-screen frame with its own opaque
  // background (html2canvas can't capture display:none elements, so it
  // parks at -10000px). The visible card is cloned into the verdict slot —
  // capture-hostile styling is fixed up on the clone: `truncate`
  // (overflow:hidden) clips text bottoms in html2canvas output.
  const prepareCardClone = () => {
    const source = resultCardRef.current;
    if (!source) throw new Error("Result card is not rendered.");
    const clone = source.cloneNode(true) as HTMLElement;
    clone.removeAttribute("id");
    clone
      .querySelectorAll<HTMLElement>(".truncate")
      .forEach((n) => {
        n.classList.remove("truncate");
        n.style.overflow = "visible";
        n.style.whiteSpace = "normal";
        n.style.overflowWrap = "anywhere";
      });
    // html2canvas draws inline text below its true baseline — its font
    // probe derives the baseline from a throwaway container, not the real
    // line box — while images land at their exact rects. The byline logos
    // therefore read as floating high in the shared PNG. Same artifact PVZ
    // corrected on their capture-only header (-17px on a 30px font,
    // measured from the captured PNG); nudge the logos down onto the drawn
    // text.
    const byline = clone.querySelector(".border-t");
    byline?.querySelectorAll("img").forEach((img) => {
      img.style.position = "relative";
      img.style.top = "0.5em";
    });
    return clone;
  };

  const captureResultCard = async (): Promise<Blob> => {
    const frame = captureFrameRef.current;
    const verdictSlot = captureVerdictRef.current;
    if (!frame || !verdictSlot) {
      throw new Error("Share frame is not rendered.");
    }
    // Inline every SVG as a data URL (see sameOriginSvgDataUrl) — the
    // wordmark in the frame header and the two byline logos in the card.
    // Best-effort: if a fetch fails, keep the original src.
    if (captureWordmarkRef.current) {
      const wordmark = await sameOriginSvgDataUrl("/zombie_check_wordmark.svg");
      if (wordmark) captureWordmarkRef.current.src = wordmark;
    }
    const mutableLogo = await sameOriginSvgDataUrl("/mutable_logo.svg");
    const pvzLogo = await sameOriginSvgDataUrl("/plebs_vs_zombies_logo.svg");
    const result = resultRef.current;
    verdictSlot.innerHTML = "";
    const clone = prepareCardClone();
    // Proxied data-URL avatar: html2canvas cannot read pixels back from a
    // cross-origin image, and a tainted canvas would fail later at toBlob
    // with no useful error. Falls back to the inlined default avatar.
    const proxied = result?.picture
      ? await loadImageAsBase64(result.picture)
      : null;
    clone.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") || "";
      if (src.includes("mutable_logo") && mutableLogo) {
        img.src = mutableLogo;
      } else if (src.includes("plebs_vs_zombies") && pvzLogo) {
        img.src = pvzLogo;
      } else if (!src.startsWith("data:")) {
        // The remaining img is the avatar.
        img.src = proxied || DEFAULT_AVATAR_DATA_URL;
      }
    });
    verdictSlot.appendChild(clone);
    // Let the avatar decode and layout settle before rasterizing.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const canvas = await html2canvas(frame, {
      scale: 2,
      useCORS: true,
      backgroundColor: null,
      logging: false,
    });
    return await canvasToBlob(canvas);
  };

  const getShareBlob = async (): Promise<Blob> => {
    if (!shareBlobRef.current) {
      shareBlobRef.current = await captureResultCard();
    }
    return shareBlobRef.current;
  };

  // Step one of Share as Note: render the card locally and show exactly what
  // will be posted. Nothing is uploaded or signed until the user confirms.
  const openSharePreview = async () => {
    const result = resultRef.current;
    if (!result || shareBusy || !canPublishNotes) return;
    setShareBusy(true);
    setShareStatusKind(null);
    setPublishedNoteUrl(null);
    setShareStatus(shareIncludeImage ? "Rendering preview…" : "");
    try {
      if (shareIncludeImage) {
        const blob = await getShareBlob();
        setPreviewImageSrc(URL.createObjectURL(blob));
      }
      setShareStatus("");
      setPreviewOpen(true);
    } catch (e) {
      console.error("Share preview failed:", e);
      setShareStatusKind("error");
      setShareStatus(
        e instanceof Error ? e.message : "Could not render the preview. Try again.",
      );
    } finally {
      setShareBusy(false);
    }
  };

  const ensureShareImage = async (): Promise<string> => {
    if (uploadedImageUrlRef.current) return uploadedImageUrlRef.current;
    const blob = await getShareBlob();
    const result = resultRef.current;
    const filename = `zombie-check-${(result?.npub || "result").slice(0, 20)}.png`;
    // Sign the BUD-01 upload auth with the user's identity when one is
    // ready; otherwise upload anonymously with a throwaway key — either
    // way the visitor is prompted at most once.
    const res = await uploadImageToBlossom({
      blob,
      filename,
      signer: canPublishNotes ? signer! : undefined,
    });
    uploadedImageUrlRef.current = res.url;
    return res.url;
  };

  const shareAsNote = async () => {
    const result = resultRef.current;
    if (!result || shareBusy || !canPublishNotes) return;
    setShareBusy(true);
    setShareStatusKind(null);
    setPublishedNoteUrl(null);
    try {
      const imageUrl = shareIncludeImage ? await ensureShareImage() : null;
      setShareStatus("Publishing note…");
      const { content, tags } = buildZombieShareNote(shareModel(result), {
        imageUrl,
      });
      const res = await publishTextNote(content, tags, session?.relays);
      if (!res.success || !res.event) {
        throw new Error(
          res.error || "Failed to publish to any relays. Try again.",
        );
      }
      // The relays that actually took the note — an id with no hints sends
      // the viewer looking on relays that don't have it.
      const hints = {
        relays: res.report?.accepted.length
          ? res.report.accepted
          : session?.relays,
        author: res.event.pubkey,
      };
      setPublishedNoteUrl(getPostedNoteLink(res.event.id, hints));
      closeSharePreview();
      setShareStatusKind("success");
      const count = res.report?.accepted.length ?? 0;
      setShareStatus(`Note published to ${count} relay${count === 1 ? "" : "s"}!`);
    } catch (e) {
      console.error("Share as note failed:", e);
      setShareStatusKind("error");
      setShareStatus(
        e instanceof Error ? e.message : "Sharing failed. Try again.",
      );
    } finally {
      setShareBusy(false);
    }
  };

  const copyNoteText = async () => {
    const result = resultRef.current;
    if (!result || shareBusy) return;
    setShareBusy(true);
    setShareStatusKind(null);
    setPublishedNoteUrl(null);
    if (shareIncludeImage) setShareStatus("Uploading image…");
    try {
      const imageUrl = shareIncludeImage ? await ensureShareImage() : null;
      const { content } = buildZombieShareNote(shareModel(result), {
        imageUrl,
      });
      const ok = await copyToClipboard(content);
      if (!ok) throw new Error("Could not copy the note text. Try again.");
      setCopiedNoteText(true);
      setShareStatus("");
      setTimeout(() => setCopiedNoteText(false), 2000);
    } catch (e) {
      console.error("Note text copy failed:", e);
      setShareStatusKind("error");
      setShareStatus(
        e instanceof Error ? e.message : "Could not copy the note text. Try again.",
      );
    } finally {
      setShareBusy(false);
    }
  };

  const downloadImage = async () => {
    const result = resultRef.current;
    if (!result || shareBusy) return;
    setShareBusy(true);
    setShareStatus("Rendering image…");
    setShareStatusKind(null);
    try {
      const blob = await captureResultCard();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `zombie-check-${(result.npub || "result").slice(0, 20)}.png`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
      setShareStatus("");
    } catch (e) {
      console.error("Image download failed:", e);
      setShareStatusKind("error");
      setShareStatus(
        e instanceof Error ? e.message : "Could not render the image. Try again.",
      );
    } finally {
      setShareBusy(false);
    }
  };

  const copyImageLink = async () => {
    const result = resultRef.current;
    if (!result || shareBusy) return;
    setShareBusy(true);
    setShareStatus("Uploading image…");
    setShareStatusKind(null);
    try {
      const url = await ensureShareImage();
      const ok = await copyToClipboard(url);
      if (!ok) throw new Error("Upload failed. Try again.");
      setCopiedImageLink(true);
      setShareStatus("");
      setTimeout(() => setCopiedImageLink(false), 2000);
    } catch (e) {
      console.error("Image link copy failed:", e);
      setShareStatusKind("error");
      setShareStatus(
        e instanceof Error ? e.message : "Upload failed. Try again.",
      );
    } finally {
      setShareBusy(false);
    }
  };

  const verdict = result ? VERDICTS[result.category] : null;
  const deletion = result ? DELETION_LINES[result.deletion.state] : null;

  return (
    <AppShell navActive="zombieCheck" width="regular">
      <PageHeader
        icon={<ZombieHand size={26} />}
        iconBg="from-green-600 to-green-800"
        title="Zombie Check"
        subtitle="The identical feature from Plebs vs. Zombies: check whether any Nostr user is a zombie and see how long they've been gone. No login required."
      />

      <section className="panel relative z-20 rounded-xl border border-line shadow-panel mt-6 animate-rise stagger-1">
        <div className="p-5">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !checking) {
                    if (showDropdown && searchResults.length > 0) {
                      pickProfile(searchResults[0]);
                    } else {
                      runCheck(input);
                    }
                  }
                }}
                onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                placeholder="npub, NIP-05, name or hex pubkey"
                spellCheck={false}
                disabled={checking}
                className="w-full px-4 py-2.5 bg-inset border border-line-strong rounded-[10px] text-hi text-sm outline-none focus:border-primary focus:shadow-[0_0_0_3px_rgb(22_163_74/0.18)] transition-all disabled:opacity-60"
              />
              {isSearching && (
                // The wrapper centers, the icon spins: in Tailwind 3 both are
                // transforms, and the spin would cancel the centering.
                <span className="absolute right-3 top-1/2 -translate-y-1/2 flex pointer-events-none">
                  <Loader2 size={14} className="animate-spin text-mid" />
                </span>
              )}
              {showDropdown && searchResults.length > 0 && (
                <div className="absolute z-30 left-0 right-0 mt-1 bg-inset rounded-[10px] border border-line-strong shadow-panel max-h-72 overflow-y-auto">
                  {searchResults.map((p) => (
                    <button
                      key={p.pubkey}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickProfile(p)}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5"
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
              onClick={() => runCheck(input)}
              disabled={checking || !input.trim()}
              className="px-5 py-2.5 bg-gradient-to-b from-green-600 to-green-800 text-white rounded-[10px] font-semibold text-sm shadow-[0_4px_16px_-6px_rgb(22_163_74/0.55),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-105 transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
            >
              {checking ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Search size={15} />
              )}
              Check for Zombie
            </button>
          </div>

          {session && !checking && !result && (
            <button
              type="button"
              onClick={() => {
                try {
                  const npub = hexToNpub(session.pubkey);
                  setInput(npub);
                  runCheck(npub);
                } catch {
                  // ignore
                }
              }}
              className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-mid hover:text-hi transition-colors"
            >
              <User size={14} />
              Check me
            </button>
          )}
        </div>
      </section>

      {/* Progress */}
      {checking && (
        <p className="mt-6 text-sm text-mut flex items-center gap-2">
          <Loader2 size={14} className="animate-spin flex-none" />
          <span className="truncate">{stage}</span>
        </p>
      )}

      {error && !checking && (
        <p
          role="alert"
          className="mt-6 text-sm text-red-600 dark:text-red-400 [overflow-wrap:anywhere] [text-wrap:pretty]"
        >
          {error}
        </p>
      )}

      {/* Result */}
      {result && verdict && deletion && (
        <div className="mt-5 animate-rise space-y-4">
          <div
            ref={resultCardRef}
            className={`rounded-xl border-2 p-6 ${verdict.border}`}
          >
            <div className="flex items-center gap-4">
              {result.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={result.picture}
                  alt=""
                  className="w-12 h-12 rounded-full object-cover flex-none"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.visibility = "hidden";
                  }}
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-black/10 dark:bg-white/10 flex-none" />
              )}
              <div className="min-w-0">
                <p className="font-semibold text-hi truncate">
                  {result.displayName || result.name || "Anonymous"}
                </p>
                <p className="font-mono text-xs text-mut truncate">
                  {shortNpub(result.npub)}
                </p>
              </div>
            </div>

            <div className="text-center py-4">
              <div
                className={`text-5xl leading-none ${verdict.beat ? "animate-heartbeat" : ""}`}
              >
                {verdict.icon ? (
                  <Image
                    src={verdict.icon}
                    alt={verdict.label}
                    width={48}
                    height={48}
                    className="inline-block align-middle"
                  />
                ) : (
                  verdict.emoji
                )}
              </div>
              <p
                className={`font-display font-bold text-2xl mt-2 ${verdict.text}`}
              >
                {verdict.label}
              </p>
              <p className="text-sm font-medium text-hi mt-2">
                {verdictDetail(result)}
              </p>
              {result.lastActivity && (
                <p className="text-xs text-mut mt-1">
                  Last activity:{" "}
                  {new Date(result.lastActivity * 1000).toLocaleDateString(
                    undefined,
                    { year: "numeric", month: "short", day: "numeric" },
                  )}
                </p>
              )}
              <p className="text-xs mt-2 text-mid">{deletionLineText(result)}</p>
            </div>

            {/* Inline flow with vertical-align: middle on the logos — flex
                centering is what html2canvas gets wrong, so the shared
                image's byline stays honest only if the live card uses the
                same inline layout. */}
            <div className="text-center mt-4 pt-4 border-t border-line">
              <span className="text-xs text-mut mr-2">by</span>
              <Image
                src="/mutable_logo.svg"
                alt=""
                width={14}
                height={14}
                className="inline-block align-middle mr-1.5"
              />
              <span className="text-xs font-semibold text-hi mr-2">
                mutable
              </span>
              <span className="text-xs text-mut mr-2">and</span>
              <a
                href={PVZ_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline text-xs font-semibold text-green-600 dark:text-green-400 hover:underline"
              >
                <Image
                  src="/plebs_vs_zombies_logo.svg"
                  alt=""
                  width={14}
                  height={14}
                  className="inline-block align-middle mr-1.5"
                />
                Plebs vs. Zombies
              </a>
            </div>
          </div>

          {/* Share actions: capture the card above as an image, upload it
              to Blossom, and hand the user a finished note / download /
              link. Share as Note is signed-in territory; everyone else
              gets the copy-and-post-yourself path. */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={openSharePreview}
              disabled={shareBusy || !canPublishNotes}
              className="px-4 py-2 bg-gradient-to-b from-green-600 to-green-800 text-white rounded-[10px] text-sm font-semibold shadow-[0_4px_16px_-6px_rgb(22_163_74/0.55),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-105 transition-all disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
            >
              {shareBusy ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Eye size={15} />
              )}
              Preview &amp; Share as Note
            </button>
            <button
              onClick={copyNoteText}
              disabled={shareBusy}
              className="px-4 py-2 bg-inset border border-line-2 text-mid hover:text-hi hover:border-line-strong rounded-[10px] text-sm font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
            >
              {copiedNoteText ? <Check size={15} /> : <Copy size={15} />}
              {copiedNoteText ? "Copied!" : "Copy Note Text"}
            </button>
            <button
              onClick={downloadImage}
              disabled={shareBusy}
              className="px-4 py-2 bg-inset border border-line-2 text-mid hover:text-hi hover:border-line-strong rounded-[10px] text-sm font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
            >
              <Download size={15} />
              Download Image
            </button>
            <button
              onClick={copyImageLink}
              disabled={shareBusy}
              className="px-4 py-2 bg-inset border border-line-2 text-mid hover:text-hi hover:border-line-strong rounded-[10px] text-sm font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
            >
              {copiedImageLink ? <Check size={15} /> : <Link2 size={15} />}
              {copiedImageLink ? "Link Copied!" : "Copy Image Link"}
            </button>
          </div>
          <label className="flex items-center justify-center gap-2 text-xs text-mut cursor-pointer select-none">
            <input
              type="checkbox"
              checked={shareIncludeImage}
              onChange={(e) => setShareIncludeImage(e.target.checked)}
              className="accent-green-600"
            />
            Include image link in note
          </label>
          {!canPublishNotes && (
            <p className="text-xs text-center text-mut">
              Publishing needs a Nostr signer. Copy the note text to post it
              yourself — tick "Include image link" and the card image
              attaches at the end.
            </p>
          )}
          {shareStatus && (
            <p
              className={`text-xs text-center ${
                shareStatusKind === "error"
                  ? "text-red-600 dark:text-red-400"
                  : "text-green-600 dark:text-green-400"
              }`}
            >
              {shareStatus}
            </p>
          )}
          {publishedNoteUrl && (
            <a
              href={publishedNoteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs text-center text-green-600 dark:text-green-400 hover:underline"
            >
              View your note ↗
            </a>
          )}

          {/* Copyable deep link straight back to this exact check (the
              route auto-runs it on load) */}
          <div className="flex items-center gap-2">
            <input
              value={`https://mutable.top/zombie-check?npub=${result.npub}`}
              readOnly
              onFocus={(e) => e.target.select()}
              className="flex-1 min-w-0 px-3 py-2 bg-inset border border-line-strong rounded-[10px] text-mid text-xs font-mono"
            />
            <button
              onClick={copyDirectLink}
              className="px-3 py-2 bg-inset border border-line-2 text-mid hover:text-hi hover:border-line-strong rounded-[10px] text-[13px] font-semibold transition-colors whitespace-nowrap flex items-center gap-1.5"
            >
              {copiedDirectLink ? <Check size={14} /> : <Link2 size={14} />}
              {copiedDirectLink ? "Copied!" : "Copy Link"}
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-mut">
              Checked {result.relaysQueried}{" "}
              {result.relaysQueried === 1 ? "relay" : "relays"}.
            </p>
            <button
              onClick={reset}
              className="px-3.5 py-2 bg-inset border border-line-2 text-mid hover:text-hi hover:border-line-strong rounded-[10px] text-[13px] font-semibold transition-colors"
            >
              Check another user
            </button>
          </div>
        </div>
      )}

      {/* Off-screen share frame: the opaque outer shell that only exists
          for the shared PNG (html2canvas can't capture display:none
          elements, so it parks at -10000px). The visible result card is
          cloned into the verdict slot at capture time. */}
      {result && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: -10000,
            left: -10000,
            width: 560,
          }}
        >
          <div
            ref={captureFrameRef}
            className="rounded-3xl overflow-hidden"
            style={{
              border: "1px solid rgba(255,255,255,0.14)",
              background:
                "radial-gradient(600px 420px at 12% 0%, rgba(34,197,94,0.10), transparent 60%), " +
                "radial-gradient(560px 400px at 100% 10%, rgba(220,38,38,0.08), transparent 60%), " +
                "linear-gradient(180deg, #14161d 0%, #0e0f14 100%)",
            }}
          >
            <div className="flex items-center justify-center px-8 pt-6 pb-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={captureWordmarkRef}
                src="/zombie_check_wordmark.svg"
                alt="Zombie Check"
                className="w-[340px] max-w-full"
              />
            </div>
            <div ref={captureVerdictRef} className="px-7 py-3" />
            <div className="px-8 pt-6 pb-8 text-center">
              <span className="text-sm text-gray-500 font-mono">
                mutable.top/zombie-check
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Hunt link — bottom left, the way out to the original tool */}
      <div className="mt-6 flex">
        <a
          href={PVZ_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-inset border border-line-2 text-mid hover:text-hi hover:border-line-strong rounded-[10px] text-[13px] font-semibold transition-colors"
        >
          <Image
            src="/plebs_vs_zombies_logo.svg"
            alt=""
            width={16}
            height={16}
          />
          Hunt zombies on Plebs vs. Zombies
        </a>
      </div>
      {previewOpen &&
        result &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
            onClick={() => !shareBusy && closeSharePreview()}
          >
            <div
              className="panel relative rounded-xl border border-line shadow-panel w-full max-w-lg p-5 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center mb-3">
                <h3 className="font-display font-semibold text-base tracking-tight text-hi">
                  Share as note
                </h3>
                <button
                  onClick={closeSharePreview}
                  disabled={shareBusy}
                  className="ml-auto text-mut hover:text-hi"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
              {(() => {
                // Built without the image URL: the preview shows the rendered
                // card where the uploaded link will appear.
                const note = buildZombieShareNote(shareModel(result), {
                  imageUrl: null,
                });
                return (
                  <NoteReview
                    content={note.content}
                    tags={note.tags}
                    mentionNames={{
                      [result.pubkey]:
                        result.displayName || result.name || shortNpub(result.npub),
                    }}
                    images={previewImageSrc ? [previewImageSrc] : []}
                    footnote={
                      previewImageSrc
                        ? "Image uploads to Blossom on post."
                        : undefined
                    }
                    posting={shareBusy}
                    postingLabel={shareStatus || "Publishing…"}
                    error={shareStatusKind === "error" ? shareStatus : null}
                    confirmLabel="Publish note"
                    accent="green"
                    onBack={closeSharePreview}
                    onConfirm={shareAsNote}
                  />
                );
              })()}
            </div>
          </div>,
          document.body,
        )}
    </AppShell>
  );

  function pickProfile(profile: Profile) {
    const npub = hexToNpub(profile.pubkey);
    setInput(npub);
    setShowDropdown(false);
    setSearchResults([]);
    runCheck(npub);
  }
}

