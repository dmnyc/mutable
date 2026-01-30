"use client";

import { useRef, useMemo, useState, useEffect } from "react";
import {
  Download,
  User,
  Share2,
  ExternalLink,
  Check,
  Copy,
} from "lucide-react";
import html2canvas from "html2canvas";
import { DMContact, Profile } from "@/types";
import { hexToNpub, publishTextNote, DEFAULT_RELAYS } from "@/lib/nostr";
import { uploadImageToBlossom } from "@/lib/imageUpload";
import { useStore } from "@/lib/store";
import { nip19 } from "nostr-tools";

// Global cache for loaded images (persists across re-renders)
const imageCache = new Map<string, string>();

interface DMCircleProps {
  targetProfile?: Profile;
  targetPubkey: string;
  contacts: DMContact[];
}

export default function DMCircle({
  targetProfile,
  targetPubkey,
  contacts,
}: DMCircleProps) {
  const circleRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState<string>("");
  const [publishedNoteId, setPublishedNoteId] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [hoveredContact, setHoveredContact] = useState<DMContact | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [loadedImages, setLoadedImages] = useState<Map<string, string>>(
    new Map(),
  );
  const [isLoadingImages, setIsLoadingImages] = useState(true);

  const { signer, session } = useStore();
  const isSignedIn = !!session?.pubkey && !!signer;

  // Show up to 36 contacts across 3 rings (8 + 12 + 16)
  const displayContacts = useMemo(() => contacts.slice(0, 36), [contacts]);

  // Load a single image as base64 with retry through multiple proxies
  const loadImageAsBase64 = async (url: string): Promise<string | null> => {
    // Check cache first
    if (imageCache.has(url)) {
      return imageCache.get(url)!;
    }

    const proxies = [
      `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=100&h=100&fit=cover&a=attention`,
      `https://images.weserv.nl/?url=${encodeURIComponent(url)}&w=100&h=100`,
    ];

    for (const proxyUrl of proxies) {
      try {
        const response = await fetch(proxyUrl);
        if (!response.ok) continue;
        const blob = await response.blob();
        if (!blob.type.startsWith("image/")) continue;

        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        // Cache successful loads
        imageCache.set(url, base64);
        return base64;
      } catch {
        continue;
      }
    }
    return null;
  };

  // Load images in batches to avoid overwhelming the proxy
  useEffect(() => {
    const loadAllImages = async () => {
      setIsLoadingImages(true);
      const newLoadedImages = new Map<string, string>();

      // Collect all image URLs
      const urls: string[] = [];
      if (targetProfile?.picture) urls.push(targetProfile.picture);
      displayContacts.forEach((c) => {
        if (c.profile?.picture) urls.push(c.profile.picture);
      });

      // Load in batches of 5 with 100ms delay between batches
      const batchSize = 5;
      for (let i = 0; i < urls.length; i += batchSize) {
        const batch = urls.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map(async (url) => {
            const base64 = await loadImageAsBase64(url);
            return { url, base64 };
          }),
        );

        results.forEach(({ url, base64 }) => {
          if (base64) {
            newLoadedImages.set(url, base64);
          }
        });

        // Update state after each batch so images appear progressively
        setLoadedImages(new Map(newLoadedImages));

        // Small delay between batches to avoid rate limiting
        if (i + batchSize < urls.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      setIsLoadingImages(false);
    };

    loadAllImages();
  }, [targetProfile?.picture, displayContacts]);

  // Get image URL - use cached base64 if available, otherwise original
  const getImageUrl = (url: string | undefined): string | undefined => {
    if (!url) return undefined;
    return loadedImages.get(url) || url;
  };

  // Calculate positions for contacts in concentric rings
  const layout = useMemo(() => {
    const centerX = 250;
    const centerY = 250;
    const centerRadius = 50; // Larger center avatar

    // Ring configuration: [count, radius, avatarSize]
    // Twitter Circle style - large inner avatars, gradual decrease
    const ringConfigs: [number, number, number][] = [
      [8, 105, 44], // Ring 1: 8 BFFs, large avatars
      [12, 160, 36], // Ring 2: 12 close contacts
      [16, 210, 30], // Ring 3: 16 frequent contacts
    ];

    const rings: {
      contacts: DMContact[];
      radius: number;
      avatarSize: number;
    }[] = [];

    let contactIndex = 0;
    for (const [count, radius, avatarSize] of ringConfigs) {
      if (contactIndex >= displayContacts.length) break;

      const ringContacts = displayContacts.slice(
        contactIndex,
        contactIndex + count,
      );
      if (ringContacts.length > 0) {
        rings.push({
          contacts: ringContacts,
          radius,
          avatarSize,
        });
        contactIndex += count;
      }
    }

    // Calculate positions
    const positions: {
      contact: DMContact;
      x: number;
      y: number;
      size: number;
    }[] = [];

    rings.forEach((ring) => {
      const angleStep = (2 * Math.PI) / ring.contacts.length;
      const startAngle = -Math.PI / 2; // Start from top

      ring.contacts.forEach((contact, i) => {
        const angle = startAngle + i * angleStep;
        positions.push({
          contact,
          x: centerX + ring.radius * Math.cos(angle),
          y: centerY + ring.radius * Math.sin(angle),
          size: ring.avatarSize,
        });
      });
    });

    return {
      positions,
      centerX,
      centerY,
      centerRadius,
    };
  }, [displayContacts]);

  // Capture the circle visualization as PNG
  const captureImage = async (): Promise<Blob> => {
    if (!circleRef.current) throw new Error("Circle element not found");

    // Images are already loaded as base64 from the useEffect
    // Just wait a moment for any final renders
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      const canvas = await html2canvas(circleRef.current, {
        useCORS: true,
        allowTaint: true,
        scale: 2,
        backgroundColor: null,
        logging: false,
      });

      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Failed to create blob"));
          }
        }, "image/png");
      });
    } catch (err) {
      console.error("html2canvas error:", err);
      throw new Error("Failed to capture image");
    }
  };

  const handleDownload = async () => {
    setIsGenerating(true);
    setPublishStatus("Loading images...");

    try {
      setPublishStatus("Capturing...");
      const blob = await captureImage();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = `dm-circle-${hexToNpub(targetPubkey).slice(0, 12)}.png`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to generate image:", err);
      alert("Failed to generate image. Please try again.");
    } finally {
      setIsGenerating(false);
      setPublishStatus("");
    }
  };

  // Publish to Nostr
  const handlePublish = async () => {
    if (!isSignedIn) {
      setPublishError("You must be signed in to publish to Nostr");
      return;
    }

    setIsPublishing(true);
    setPublishError(null);
    setPublishedNoteId(null);

    try {
      // Generate the image
      setPublishStatus("Generating image...");
      const blob = await captureImage();

      // Upload to Blossom
      setPublishStatus("Uploading to nostr.build...");
      const uploadResult = await uploadImageToBlossom({
        blob,
        filename: `dm-circle-${hexToNpub(targetPubkey).slice(0, 12)}.png`,
        signer: signer!,
      });

      // Build the note content
      const targetName =
        targetProfile?.display_name ||
        targetProfile?.name ||
        hexToNpub(targetPubkey).slice(0, 16) + "...";

      const noteContent = `My DM Circle for ${targetName}

${uploadResult.url}

Your DMs aren't as private as you think!
https://mutable.nostr.com/snoopable`;

      // Publish the note
      setPublishStatus("Publishing note...");
      const result = await publishTextNote(noteContent, [], DEFAULT_RELAYS);

      if (result.success && result.event) {
        const noteId = nip19.noteEncode(result.event.id);
        setPublishedNoteId(noteId);
        setPublishStatus("");
      } else {
        throw new Error(result.error || "Failed to publish note");
      }
    } catch (err) {
      console.error("Failed to publish:", err);
      setPublishError(err instanceof Error ? err.message : "Failed to publish");
      setPublishStatus("");
    } finally {
      setIsPublishing(false);
    }
  };

  const copyNoteLink = () => {
    if (publishedNoteId) {
      navigator.clipboard.writeText(`https://njump.me/${publishedNoteId}`);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  if (contacts.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
        <p>No contacts to display</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Loading State */}
      {isLoadingImages && (
        <div
          className="relative mx-auto bg-gradient-to-br from-gray-900 to-purple-900/50 rounded-xl overflow-hidden flex items-center justify-center"
          style={{ width: "500px", height: "500px", maxWidth: "100%" }}
        >
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-purple-400/30 border-t-purple-400 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-white/70 text-sm">Loading avatars...</p>
            <p className="text-white/50 text-xs mt-1">
              {loadedImages.size} /{" "}
              {displayContacts.length + (targetProfile?.picture ? 1 : 0)}
            </p>
          </div>
        </div>
      )}

      {/* Circle Visualization */}
      <div
        ref={circleRef}
        className={`relative mx-auto bg-gradient-to-br from-gray-900 to-purple-900/50 rounded-xl overflow-hidden ${isLoadingImages ? "hidden" : ""}`}
        style={{ width: "500px", height: "500px", maxWidth: "100%" }}
      >
        {/* Center Profile */}
        <div
          className="absolute transform -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${(layout.centerX / 500) * 100}%`,
            top: `${(layout.centerY / 500) * 100}%`,
            width: layout.centerRadius * 2,
            height: layout.centerRadius * 2,
          }}
        >
          {targetProfile?.picture ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={getImageUrl(targetProfile.picture)}
              alt=""
              crossOrigin="anonymous"
              className="w-full h-full rounded-full object-cover border-2 border-white/50"
              onError={(e) => {
                (e.target as HTMLImageElement).src =
                  `https://api.dicebear.com/7.x/bottts/svg?seed=${targetPubkey}`;
              }}
            />
          ) : (
            <div className="w-full h-full rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center border-2 border-white/50">
              <User className="text-white" size={50} />
            </div>
          )}
        </div>

        {/* Contact Avatars */}
        {layout.positions.map((pos, i) => (
          <div
            key={pos.contact.pubkey}
            className="absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-transform hover:scale-110"
            style={{
              left: `${(pos.x / 500) * 100}%`,
              top: `${(pos.y / 500) * 100}%`,
              width: pos.size,
              height: pos.size,
            }}
            onMouseEnter={() => setHoveredContact(pos.contact)}
            onMouseLeave={() => setHoveredContact(null)}
          >
            {pos.contact.profile?.picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={getImageUrl(pos.contact.profile.picture)}
                alt=""
                crossOrigin="anonymous"
                className="w-full h-full rounded-full object-cover border border-white/30"
                onError={(e) => {
                  (e.target as HTMLImageElement).src =
                    `https://api.dicebear.com/7.x/bottts/svg?seed=${pos.contact.pubkey}`;
                }}
              />
            ) : (
              <div className="w-full h-full rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center border border-white/30">
                <User className="text-white" size={pos.size * 0.5} />
              </div>
            )}
          </div>
        ))}

        {/* Branding Overlay */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/snoopable_overlay.png"
          alt=""
          className="absolute inset-0 w-full h-full pointer-events-none"
        />

        {/* Hover Tooltip */}
        {hoveredContact && (
          <div className="absolute bottom-12 left-1/2 transform -translate-x-1/2 bg-black/80 text-white px-4 py-2 rounded-lg text-sm z-10">
            <div className="font-medium">
              {hoveredContact.profile?.display_name ||
                hoveredContact.profile?.name ||
                hexToNpub(hoveredContact.pubkey).slice(0, 16) + "..."}
            </div>
            <div className="text-xs text-gray-300">
              {hoveredContact.title} · {hoveredContact.totalCount} exchanges
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col items-center gap-3">
        <div className="flex justify-center gap-3">
          <button
            onClick={handleDownload}
            disabled={isGenerating || isPublishing}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
          >
            {isGenerating ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>{publishStatus || "Generating..."}</span>
              </>
            ) : (
              <>
                <Download size={18} />
                <span>Download PNG</span>
              </>
            )}
          </button>

          {isSignedIn && (
            <button
              onClick={handlePublish}
              disabled={isGenerating || isPublishing}
              className="flex items-center gap-2 px-4 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 transition-colors disabled:opacity-50"
            >
              {isPublishing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>{publishStatus || "Publishing..."}</span>
                </>
              ) : (
                <>
                  <Share2 size={18} />
                  <span>Share to Nostr</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Publish Error */}
        {publishError && (
          <div className="text-red-500 text-sm">{publishError}</div>
        )}

        {/* Published Success */}
        {publishedNoteId && (
          <div className="flex flex-col items-center gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
            <div className="flex items-center gap-2 text-green-500">
              <Check size={18} />
              <span className="font-medium">Published to Nostr!</span>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={`https://njump.me/${publishedNoteId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-purple-400 hover:text-purple-300"
              >
                <ExternalLink size={14} />
                View Note
              </a>
              <button
                onClick={copyNoteLink}
                className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-300"
              >
                {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                {copiedLink ? "Copied!" : "Copy Link"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Info */}
      <p className="text-center text-sm text-gray-500 dark:text-gray-400">
        Showing top {displayContacts.length} contacts by message volume
        {contacts.length > 36 && ` (${contacts.length} total)`}
      </p>
    </div>
  );
}
