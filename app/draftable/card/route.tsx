import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import {
  FollowPack,
  conscriptCount,
  parseAuthorParam,
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
const AVATAR_SIZE = 92;
const MAX_AVATAR_BYTES = 400_000;
const IMAGE_TIMEOUT_MS = 2500;

const KHAKI_LIGHT = "#ece4c4";
const STAMP = "#e3d9a8";
const RING = "#1c2112";
const FONT = "Montserrat";
// The camo tile repeats at this size, about the scale of the static card.
const CAMO_TILE = 1000;

/**
 * Read an SVG from /public once per server instance, as a data URI. Each
 * read uses a literal path so the build bundles only these three files.
 */
function svgAsset(read: () => Promise<Buffer>): () => Promise<string | null> {
  let asset: Promise<string | null> | null = null;
  return () => {
    asset ??= read()
      .then((data) => `data:image/svg+xml;base64,${data.toString("base64")}`)
      .catch(() => null);
    return asset;
  };
}
const camoSvg = svgAsset(() =>
  readFile(join(process.cwd(), "public/draftable_camo.svg")),
);
const logoSvg = svgAsset(() =>
  readFile(join(process.cwd(), "public/mutable_logo.svg")),
);
const wordmarkSvg = svgAsset(() =>
  readFile(join(process.cwd(), "public/mutable_text.svg")),
);

/**
 * Montserrat from Google Fonts, once per server instance. The renderer
 * already fetches emoji and non-Latin glyphs from the web at draw time;
 * if this fails the card falls back to the renderer's built-in font.
 */
let fontsPromise: Promise<FontOptions[] | undefined> | null = null;
type FontOptions = {
  name: string;
  data: ArrayBuffer;
  weight: 500 | 800;
  style: "normal";
};
function loadFonts(): Promise<FontOptions[] | undefined> {
  if (!fontsPromise) {
    fontsPromise = (async () => {
      const css = await fetch(
        "https://fonts.googleapis.com/css2?family=Montserrat:wght@500;800",
        { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) },
      ).then((res) => (res.ok ? res.text() : ""));
      const faces = [
        ...css.matchAll(
          /font-weight:\s*(\d+);[^}]*?src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/g,
        ),
      ];
      const fonts = await Promise.all(
        faces.map(async ([, weight, url]) => {
          const res = await fetch(url, {
            signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
          });
          if (!res.ok) throw new Error(`font ${res.status}`);
          return {
            name: FONT,
            data: await res.arrayBuffer(),
            weight: Number(weight) as 500 | 800,
            style: "normal" as const,
          };
        }),
      );
      if (fonts.length < 2) throw new Error("Montserrat not found");
      return fonts;
    })().catch(() => {
      fontsPromise = null; // try again on the next card
      return undefined;
    });
  }
  return fontsPromise;
}

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
        padding: "4px 26px",
        fontSize: 46,
        fontWeight: 800,
        letterSpacing: 8,
        borderRadius: 12,
        transform: "rotate(-6deg)",
        background: "rgba(20, 24, 12, 0.7)",
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      DRAFTED
    </div>
  );
}

/** "by [logo] mutable", as on the static Draftable card. */
function MutableLockup({ logo, wordmark }: Branding) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        fontSize: 40,
        fontWeight: 800,
        color: "white",
      }}
    >
      <div style={{ display: "flex" }}>Draftable by</div>
      {logo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" width={68} height={68} />
      )}
      {wordmark ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={wordmark} alt="" width={244} height={46} />
      ) : (
        <div style={{ display: "flex" }}>Mutable</div>
      )}
    </div>
  );
}

function Frame({
  camo,
  children,
}: {
  camo: string | null;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        width: WIDTH,
        height: HEIGHT,
        display: "flex",
        position: "relative",
        fontFamily: FONT,
        color: "white",
        background: "#3d3b2c",
        overflow: "hidden",
      }}
    >
      {camo &&
        [0, CAMO_TILE].map((left) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={left}
            src={camo}
            alt=""
            width={CAMO_TILE}
            height={CAMO_TILE}
            style={{ position: "absolute", top: -120, left: left - 140 }}
          />
        ))}
      {/* Half-darken the camo, the same as the static card. */}
      <div
        style={{
          display: "flex",
          position: "absolute",
          top: 0,
          left: 0,
          width: WIDTH,
          height: HEIGHT,
          background: "rgba(0, 0, 0, 0.5)",
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          position: "relative",
          width: WIDTH,
          height: HEIGHT,
          padding: "48px 64px 46px",
          textShadow: "0 2px 10px rgba(0, 0, 0, 0.7)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

interface Branding {
  logo: string | null;
  wordmark: string | null;
}

interface Avatar {
  src: string | null;
  /** Shown when the picture can't be fetched; blank if there's no name. */
  initial: string;
}

interface CardData extends Branding {
  camo: string | null;
  name: string;
  count: number;
  avatars: Avatar[];
  extra: number;
}

async function loadCardData(pack: FollowPack): Promise<CardData> {
  const shown = pack.members.slice(0, MAX_AVATARS).map((m) => m.pubkey);
  const [profiles, camo, logo, wordmark] = await Promise.all([
    fetchPreviewProfiles(shown),
    camoSvg(),
    logoSvg(),
    wordmarkSvg(),
  ]);
  const avatars = await Promise.all(
    shown.map(async (pubkey) => {
      const profile = profiles.get(pubkey);
      const name = previewName(profile);
      return {
        src: await imageDataUri(profile?.picture, MAX_AVATAR_BYTES),
        initial: name ? Array.from(name)[0].toUpperCase() : "",
      };
    }),
  );
  return {
    camo,
    logo,
    wordmark,
    name: pack.name.length > 70 ? `${pack.name.slice(0, 69)}…` : pack.name,
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

/**
 * No orphans: join the last two words so a line never holds one word alone.
 * (The card renderer can't balance text the way CSS text-wrap can.)
 */
function noOrphan(text: string): string {
  const words = text.trim().split(/\s+/);
  if (words.length < 3) return text;
  const last = words.pop();
  return `${words.join(" ")}\u00A0${last}`;
}

const TITLE_SIZES = [112, 100, 88, 76, 64, 56];

/** Rough advance width in em for Montserrat ExtraBold; errs wide. */
function charWidth(char: string): number {
  if (/[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(char)) return 1;
  if (/\p{Extended_Pictographic}/u.test(char)) return 1.15;
  if (/[A-Z0-9]/.test(char)) return 0.76;
  if (/[il.,'!:;|]/.test(char)) return 0.32;
  return 0.64;
}

/**
 * The biggest title size that fits in two lines of `width` pixels, by
 * greedy word wrap on estimated widths. Text without spaces (CJK) wraps
 * anywhere, so it's measured per character.
 */
function titleSize(name: string, width: number): number {
  const text = noOrphan(name);
  const words = /\s/.test(text) ? text.split(" ") : Array.from(text);
  const joiner = /\s/.test(text) ? 0.28 : 0;
  for (const size of TITLE_SIZES) {
    let lines = 1;
    let line = 0;
    let fits = true;
    for (const word of words) {
      const w = Array.from(word).reduce((sum, c) => sum + charWidth(c), 0);
      if (w * size > width) {
        fits = false;
        break;
      }
      const next = line === 0 ? w : line + joiner + w;
      if (next * size > width) {
        lines++;
        line = w;
      } else {
        line = next;
      }
    }
    if (fits && lines <= 2) return size;
  }
  return TITLE_SIZES[TITLE_SIZES.length - 1];
}

function packCard({
  camo,
  logo,
  wordmark,
  name,
  count,
  avatars,
  extra,
}: CardData) {
  const titleWidth = WIDTH - 128;
  return (
    <Frame camo={camo}>
      <MutableLockup logo={logo} wordmark={wordmark} />

      <div
        style={{
          display: "flex",
          flex: 1,
          alignItems: "center",
          gap: 48,
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
          <div
            style={{
              display: "block",
              fontSize: titleSize(name, titleWidth),
              fontWeight: 800,
              lineHeight: 1.04,
              lineClamp: 2,
            }}
          >
            {noOrphan(name)}
          </div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 30 }}>
            {avatars.map(({ src, initial }, i) =>
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
                    border: `5px solid ${RING}`,
                    marginLeft: i === 0 ? 0 : -22,
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
                    border: `5px solid ${RING}`,
                    marginLeft: i === 0 ? 0 : -22,
                    background: "#4d704d",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 38,
                    fontWeight: 800,
                    color: KHAKI_LIGHT,
                  }}
                >
                  {initial}
                </div>
              ),
            )}
            {extra > 0 && (
              <div
                style={{
                  display: "flex",
                  marginLeft: 20,
                  fontSize: 40,
                  fontWeight: 800,
                  color: KHAKI_LIGHT,
                }}
              >
                +{extra}
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 40,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 800 }}>
            {conscriptCount(count)}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 30,
              fontWeight: 800,
              color: KHAKI_LIGHT,
            }}
          >
            {count === 1 ? "They can't leave." : "None of them can leave."}
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
  const image = new ImageResponse(element, {
    width: WIDTH,
    height: HEIGHT,
    fonts: await loadFonts(),
  });
  const body = await image.arrayBuffer();
  return new Response(body, {
    headers: { "Content-Type": "image/png", "Cache-Control": cacheControl },
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const dTag = searchParams.get("d");
  const author = parseAuthorParam(searchParams.get("p"));

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
            avatars: data.avatars.map((a) => ({
              ...a,
              initial: latinOnly(a.initial, ""),
            })),
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
