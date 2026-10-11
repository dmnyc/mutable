import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { parseAuthorParam } from "@/lib/draftable/pack";
import { fetchPreviewProfiles, previewName } from "@/lib/draftable/server";
import { fetchPublicImage } from "@/lib/draftable/safeFetch";

// Needs the Node runtime's global WebSocket to reach relays.
export const runtime = "nodejs";

const WIDTH = 1200;
const HEIGHT = 630;
const MAX_AVATAR_BYTES = 400_000;
const IMAGE_TIMEOUT_MS = 2500;

const INK = "#26231b";
const AMBER = "#d9a83f";
const AMBER_DEEP = "#a8792a";
const FOLDER_TAB = "#c9962f";
const CANVAS_A = "#161c26";
const CANVAS_B = "#0b101c";
const SLATE_LIGHT = "#aab4c2";

const FONT = "Montserrat";

function svgAsset(read: () => Promise<Buffer>): () => Promise<string | null> {
  let asset: Promise<string | null> | null = null;
  return () => {
    asset ??= read()
      .then((data) => `data:image/svg+xml;base64,${data.toString("base64")}`)
      .catch(() => null);
    return asset;
  };
}
const logoSvg = svgAsset(() =>
  readFile(join(process.cwd(), "public/mutable_logo.svg")),
);
const wordmarkSvg = svgAsset(() =>
  readFile(join(process.cwd(), "public/mutable_text.svg")),
);

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

/** Inline an avatar as a data URI so one dead image can't break the card. */
async function avatarDataUri(
  raw: string | undefined,
): Promise<string | null> {
  if (!raw) return null;
  const image = await fetchPublicImage(raw, {
    maxBytes: MAX_AVATAR_BYTES,
    timeoutMs: IMAGE_TIMEOUT_MS,
  }).catch(() => null);
  return image
    ? `data:${image.type};base64,${image.data.toString("base64")}`
    : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const hex =
    parseAuthorParam(url.searchParams.get("npub")) ??
    parseAuthorParam(url.searchParams.get("p"));

  const [fonts, profiles, logo, wordmark] = await Promise.all([
    loadFonts(),
    hex
      ? fetchPreviewProfiles([hex])
      : Promise.resolve(new Map()),
    logoSvg(),
    wordmarkSvg(),
  ]);
  const profile = hex ? profiles.get(hex) : undefined;
  const name = (profile && previewName(profile)) || "Unknown subject";
  const avatar = await avatarDataUri(profile?.picture);
  const npub = hex
    ? `${hex.slice(0, 12)}…${hex.slice(-6)}`
    : "open a profile at mutable.top/dossier";
  const nip05 = profile?.nip05;

  const shortName = name.length > 22 ? `${name.slice(0, 21)}…` : name;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: `linear-gradient(180deg, ${CANVAS_A}, ${CANVAS_B})`,
          fontFamily: FONT,
        }}
      >
        {/* The light bar */}
        <div
          style={{
            height: 5,
            width: "100%",
            background:
              "linear-gradient(90deg, transparent, #ef4444 30%, #fca5a5 50%, #ef4444 70%, transparent)",
            flexShrink: 0,
          }}
        />

        {/* Brand row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "34px 64px 0",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            {logo ? (
              <img src={logo} width={52} height={52} alt="" />
            ) : null}
            {wordmark ? (
              <img src={wordmark} width={170} height={34} alt="" />
            ) : null}
          </div>
          <div
            style={{
              color: SLATE_LIGHT,
              fontSize: 19,
              letterSpacing: 5,
              fontWeight: 500,
            }}
          >
            NO LOGIN REQUIRED
          </div>
        </div>

        {/* The folder */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: "30px 64px 0",
          }}
        >
          <div
            style={{
              display: "flex",
              background: `linear-gradient(180deg, ${FOLDER_TAB}, ${AMBER_DEEP})`,
              borderTopLeftRadius: 14,
              borderTopRightRadius: 14,
              padding: "12px 34px 10px",
              marginLeft: 26,
              alignSelf: "flex-start",
            }}
          >
            <span
              style={{
                fontSize: 24,
                fontWeight: 800,
                letterSpacing: 9,
                color: INK,
              }}
            >
              DOSSIER
            </span>
          </div>
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              background: `linear-gradient(180deg, #e2b54a, ${AMBER}) 55%`,
              borderRadius: 18,
              borderTopLeftRadius: 0,
              border: `3px solid ${AMBER_DEEP}`,
              padding: "36px 48px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
              {avatar ? (
                <img
                  src={avatar}
                  width={150}
                  height={150}
                  alt=""
                  style={{
                    borderRadius: 16,
                    border: `4px solid ${INK}`,
                    objectFit: "cover",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 150,
                    height: 150,
                    borderRadius: 16,
                    border: `4px solid ${INK}`,
                    background: "rgba(38,35,27,0.15)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 56,
                    fontWeight: 800,
                    color: INK,
                  }}
                >
                  {shortName.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                  maxWidth: 760,
                }}
              >
                <div
                  style={{
                    fontSize: 19,
                    letterSpacing: 6,
                    color: "#6b5220",
                    fontWeight: 500,
                  }}
                >
                  SUBJECT
                </div>
                <div
                  style={{
                    fontSize: 62,
                    fontWeight: 800,
                    color: INK,
                    lineHeight: 1.05,
                  }}
                >
                  {shortName}
                </div>
                <div
                  style={{
                    fontSize: 19,
                    letterSpacing: 2,
                    color: "#6b5220",
                    fontWeight: 500,
                  }}
                >
                  {nip05 ? nip05 : npub}
                </div>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 34,
                paddingTop: 26,
                borderTop: "2px solid rgba(38,35,27,0.28)",
              }}
            >
              {["MUTE SCORE", "REPORTS", "DELETIONS", "FOOTPRINT"].map(
                (label) => (
                  <span
                    key={label}
                    style={{
                      fontSize: 21,
                      fontWeight: 800,
                      letterSpacing: 4,
                      color: "#4a3c14",
                    }}
                  >
                    {label}
                  </span>
                ),
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "30px 64px 38px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: 23,
              fontWeight: 800,
              letterSpacing: 3,
              color: "#fca5a5",
            }}
          >
            OPEN THE FULL FILE
            <span style={{ fontSize: 26 }}>→</span>
          </div>
          <div
            style={{
              fontSize: 20,
              letterSpacing: 2,
              color: SLATE_LIGHT,
              fontWeight: 500,
            }}
          >
            mutable.top/dossier
          </div>
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      fonts,
    },
  );
}
