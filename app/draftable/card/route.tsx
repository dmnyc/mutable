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
const MAX_COVER_BYTES = 1_500_000;
const MAX_DESCRIPTION_CHARS = 120;
const IMAGE_TIMEOUT_MS = 2500;

const OD = "#4b5320";
const OD_DARK = "#232b10";
const OD_MID = "#5f6b34";
const TAN = "#8a7f4a";
const KHAKI = "#d8cba0";
const STAMP = "#e3d9a8";

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

/** Inline an image as a data URI so one dead image can't break the card. */
async function imageDataUri(
  raw: string | undefined,
  maxBytes: number,
): Promise<string | null> {
  if (!raw) return null;
  try {
    const res = await fetchPublicImage(raw);
    if (!res) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    // The card renderer handles png/jpeg/gif; skip webp/avif/svg.
    if (!/^image\/(png|jpe?g|gif)$/i.test(type)) return null;
    if (Number(res.headers.get("content-length") || 0) > maxBytes) {
      return null;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > maxBytes) return null;
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
        border: `6px solid ${STAMP}`,
        color: STAMP,
        padding: "6px 22px",
        fontSize: 40,
        fontWeight: 700,
        letterSpacing: 6,
        borderRadius: 12,
        transform: "rotate(-6deg)",
        background: "rgba(35, 43, 16, 0.65)",
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      NO WAY OUT
    </div>
  );
}

/** Irregular rounded blob — the card renderer can't do radial-gradient
 * camo, so overlapping shapes stand in for it. */
function Blob({
  width,
  height,
  top,
  left,
  color,
  opacity,
  radius,
}: {
  width: number;
  height: number;
  top: number;
  left: number;
  color: string;
  opacity: number;
  radius: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        width,
        height,
        top,
        left,
        background: color,
        opacity,
        borderRadius: radius,
      }}
    />
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
        background: `linear-gradient(135deg, ${OD} 0%, ${OD_DARK} 100%)`,
        overflow: "hidden",
      }}
    >
      <Blob
        width={460}
        height={360}
        top={-130}
        left={-110}
        color={OD_MID}
        opacity={0.5}
        radius="60% 40% 55% 45% / 55% 60% 40% 45%"
      />
      <Blob
        width={340}
        height={300}
        top={-90}
        left={880}
        color={TAN}
        opacity={0.35}
        radius="45% 55% 40% 60% / 60% 40% 55% 45%"
      />
      <Blob
        width={520}
        height={380}
        top={380}
        left={-140}
        color="#2a3016"
        opacity={0.6}
        radius="55% 45% 60% 40% / 40% 60% 45% 55%"
      />
      <Blob
        width={400}
        height={320}
        top={330}
        left={820}
        color={OD_MID}
        opacity={0.45}
        radius="50% 50% 45% 55% / 55% 45% 50% 50%"
      />
      <Blob
        width={280}
        height={240}
        top={180}
        left={520}
        color={TAN}
        opacity={0.22}
        radius="55% 45% 50% 50% / 45% 55% 45% 55%"
      />
      {children}
    </div>
  );
}

interface CardData {
  name: string;
  authorName: string;
  count: number;
  avatars: (string | null)[];
  extra: number;
  cover: string | null;
  description: string | null;
}

async function loadCardData(pack: FollowPack): Promise<CardData> {
  const shown = pack.members.slice(0, MAX_AVATARS).map((m) => m.pubkey);
  const [profiles, cover] = await Promise.all([
    fetchPreviewProfiles([pack.author, ...shown]),
    imageDataUri(pack.image, MAX_COVER_BYTES),
  ]);
  const avatars = await Promise.all(
    shown.map((pubkey) =>
      imageDataUri(profiles.get(pubkey)?.picture, MAX_AVATAR_BYTES),
    ),
  );
  const description = pack.description
    ?.replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DESCRIPTION_CHARS);
  return {
    name: pack.name.length > 70 ? `${pack.name.slice(0, 69)}…` : pack.name,
    authorName: previewName(profiles.get(pack.author)) ?? "its author",
    count: pack.members.length,
    avatars,
    extra: pack.members.length - shown.length,
    cover,
    description: description
      ? pack.description.length > MAX_DESCRIPTION_CHARS
        ? `${description}…`
        : description
      : null,
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

function packCard({
  name,
  authorName,
  count,
  avatars,
  extra,
  cover,
  description,
}: CardData) {
  return (
    <Frame>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 26,
          letterSpacing: 3,
          color: KHAKI,
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
          alignItems: "center",
          gap: 28,
          marginTop: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: name.length > 36 ? 64 : 84,
              fontWeight: 700,
              lineHeight: 1.1,
            }}
          >
            {name}
          </div>
          {description && (
            <div
              style={{
                display: "flex",
                fontSize: 22,
                lineHeight: 1.3,
                marginTop: 10,
                color: KHAKI,
                maxWidth: 780,
              }}
            >
              {description}
            </div>
          )}
        </div>
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt=""
            width={190}
            height={190}
            style={{
              borderRadius: 24,
              border: `6px solid ${OD_DARK}`,
              objectFit: "cover",
              flexShrink: 0,
            }}
          />
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", marginTop: 20 }}>
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
                border: `6px solid ${OD_DARK}`,
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
                border: `6px solid ${OD_DARK}`,
                marginLeft: i === 0 ? 0 : -26,
                background: OD_MID,
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
              color: KHAKI,
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
          gap: 40,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minWidth: 0,
          }}
        >
          <div style={{ display: "flex", fontSize: 36, fontWeight: 700 }}>
            {conscriptCount(count)}
          </div>
          <div style={{ display: "flex", fontSize: 28, color: KHAKI }}>
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
            description: data.description
              ? latinOnly(data.description, "") || null
              : null,
          }),
          cache,
        );
      } catch {
        // fall through to the generic card
      }
    }
  }

  // No pack, or one that didn't load (slow relays): send the static card.
  // Keep that short-lived for a pack URL so a later fetch can draw it.
  return new Response(null, {
    status: 307,
    headers: {
      Location: new URL("/draftable_social_card.png", request.url).toString(),
      "Cache-Control": dTag
        ? "public, max-age=60, s-maxage=300"
        : "public, max-age=3600, s-maxage=86400",
    },
  });
}
