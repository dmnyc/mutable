import { ImageResponse } from "next/og";
import {
  FollowPack,
  conscriptCount,
  resolvePubkey,
} from "@/lib/draftable/pack";
import {
  fetchPackForPreview,
  fetchPreviewProfiles,
  previewName,
} from "@/lib/draftable/server";

// Needs the Node runtime's global WebSocket to reach relays.
export const runtime = "nodejs";

const WIDTH = 1200;
const HEIGHT = 630;
const MAX_AVATARS = 7;
const AVATAR_SIZE = 112;
const MAX_AVATAR_BYTES = 400_000;
const IMAGE_TIMEOUT_MS = 2500;

const GREEN_DARK = "#052e16";
const GREEN = "#14532d";
const GREEN_LIGHT = "#bbf7d0";
const STAMP_RED = "#ef4444";

/**
 * Only fetch avatars from public https hosts — profile pictures are
 * attacker-controlled URLs, and this runs on the server.
 */
function isFetchableImageUrl(raw: string | undefined): raw is string {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return false;
    if (host === "localhost" || host.endsWith(".local")) return false;
    if (host.endsWith(".internal") || host.endsWith(".onion")) return false;
    if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) {
      return false; // IP literals
    }
    return host.includes(".");
  } catch {
    return false;
  }
}

/** Fetch with redirects followed by hand, re-checking each hop's host. */
async function fetchPublicImage(raw: string): Promise<Response | null> {
  let url = raw;
  for (let hop = 0; hop < 3; hop++) {
    if (!isFetchableImageUrl(url)) return null;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
      redirect: "manual",
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url).toString();
      continue;
    }
    return res.ok ? res : null;
  }
  return null;
}

/** Inline an avatar as a data URI so one dead image can't break the card. */
async function avatarDataUri(raw: string | undefined): Promise<string | null> {
  if (!raw) return null;
  try {
    const res = await fetchPublicImage(raw);
    if (!res) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    // The card renderer handles png/jpeg/gif; skip webp/avif/svg.
    if (!/^image\/(png|jpe?g|gif)$/i.test(type)) return null;
    if (Number(res.headers.get("content-length") || 0) > MAX_AVATAR_BYTES) {
      return null;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_AVATAR_BYTES) return null;
    return `data:${type};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

function Stamp() {
  return (
    <div
      style={{
        display: "flex",
        border: `6px solid ${STAMP_RED}`,
        color: STAMP_RED,
        padding: "6px 22px",
        fontSize: 40,
        fontWeight: 700,
        letterSpacing: 6,
        borderRadius: 12,
        transform: "rotate(-6deg)",
        background: "rgba(5, 46, 22, 0.6)",
      }}
    >
      NO WAY OUT
    </div>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: WIDTH,
        height: HEIGHT,
        display: "flex",
        flexDirection: "column",
        padding: "56px 64px",
        color: "white",
        background: `linear-gradient(135deg, ${GREEN} 0%, ${GREEN_DARK} 100%)`,
      }}
    >
      {children}
    </div>
  );
}

function genericCard() {
  return (
    <Frame>
      <div style={{ display: "flex", fontSize: 30, color: GREEN_LIGHT }}>
        by Mutable
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 140,
          fontWeight: 700,
          marginTop: 40,
          lineHeight: 1,
        }}
      >
        Draftable
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 44,
          marginTop: 28,
          color: GREEN_LIGHT,
        }}
      >
        Nostr follow packs. Once you&apos;re drafted, you&apos;re in.
      </div>
      <div
        style={{
          display: "flex",
          marginTop: "auto",
          justifyContent: "flex-end",
        }}
      >
        <Stamp />
      </div>
    </Frame>
  );
}

interface CardData {
  name: string;
  authorName: string;
  count: number;
  avatars: (string | null)[];
  extra: number;
}

async function loadCardData(pack: FollowPack): Promise<CardData> {
  const shown = pack.members.slice(0, MAX_AVATARS).map((m) => m.pubkey);
  const profiles = await fetchPreviewProfiles([pack.author, ...shown]);
  const avatars = await Promise.all(
    shown.map((pubkey) => avatarDataUri(profiles.get(pubkey)?.picture)),
  );
  return {
    name: pack.name.length > 70 ? `${pack.name.slice(0, 69)}…` : pack.name,
    authorName: previewName(profiles.get(pack.author)) ?? "its author",
    count: pack.members.length,
    avatars,
    extra: pack.members.length - shown.length,
  };
}

/**
 * Emoji and non-Latin scripts make the renderer fetch glyphs from a CDN at
 * draw time; if that fails the whole image fails. This is the retry text.
 */
function latinOnly(text: string, fallback: string): string {
  const stripped = text
    .replace(/[^\p{Script=Latin}\p{Script=Common}]/gu, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || fallback;
}

function packCard({ name, authorName, count, avatars, extra }: CardData) {
  return (
    <Frame>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 26,
          letterSpacing: 3,
          color: GREEN_LIGHT,
        }}
      >
        <div style={{ display: "flex" }}>NOSTR FOLLOW PACK</div>
        <div style={{ display: "flex", letterSpacing: 0 }}>
          Draftable by Mutable
        </div>
      </div>

      <div
        style={{
          display: "flex",
          fontSize: name.length > 36 ? 64 : 84,
          fontWeight: 700,
          marginTop: 36,
          lineHeight: 1.1,
        }}
      >
        {name}
      </div>

      <div style={{ display: "flex", alignItems: "center", marginTop: 36 }}>
        {avatars.map((src, i) =>
          src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={i}
              src={src}
              alt=""
              width={AVATAR_SIZE}
              height={AVATAR_SIZE}
              style={{
                borderRadius: AVATAR_SIZE / 2,
                border: `6px solid ${GREEN}`,
                marginLeft: i === 0 ? 0 : -26,
                objectFit: "cover",
              }}
            />
          ) : (
            <div
              key={i}
              style={{
                display: "flex",
                width: AVATAR_SIZE,
                height: AVATAR_SIZE,
                borderRadius: AVATAR_SIZE / 2,
                border: `6px solid ${GREEN}`,
                marginLeft: i === 0 ? 0 : -26,
                background: "#166534",
              }}
            />
          ),
        )}
        {extra > 0 && (
          <div
            style={{
              display: "flex",
              marginLeft: 24,
              fontSize: 40,
              color: GREEN_LIGHT,
            }}
          >
            +{extra}
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          marginTop: "auto",
          justifyContent: "space-between",
          alignItems: "flex-end",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 36, fontWeight: 700 }}>
            {conscriptCount(count)}
          </div>
          <div style={{ display: "flex", fontSize: 28, color: GREEN_LIGHT }}>
            {`drafted by ${authorName}. None of them can leave.`}
          </div>
        </div>
        <Stamp />
      </div>
    </Frame>
  );
}

/**
 * Render to a buffer before responding, so a failed render can fall back
 * instead of breaking the image stream after the headers went out.
 */
async function renderPng(
  element: React.ReactElement,
  cacheControl: string,
): Promise<Response> {
  const image = new ImageResponse(element, { width: WIDTH, height: HEIGHT });
  const body = await image.arrayBuffer();
  return new Response(body, {
    headers: { "Content-Type": "image/png", "Cache-Control": cacheControl },
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dTag = searchParams.get("d");
  const author = resolvePubkey(searchParams.get("p"));

  const pack = dTag
    ? await fetchPackForPreview(dTag, author ?? undefined, 3000)
    : null;

  if (pack) {
    const data = await loadCardData(pack);
    const cache =
      "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400";
    try {
      return await renderPng(packCard(data), cache);
    } catch {
      try {
        return await renderPng(
          packCard({
            ...data,
            name: latinOnly(data.name, "Follow pack"),
            authorName: latinOnly(data.authorName, "its author"),
          }),
          cache,
        );
      } catch {
        // fall through to the generic card
      }
    }
  }

  // A pack that didn't load (slow relays) shouldn't pin the generic card to
  // its URL for long.
  return renderPng(
    genericCard(),
    dTag
      ? "public, max-age=60, s-maxage=300"
      : "public, max-age=3600, s-maxage=86400",
  );
}
