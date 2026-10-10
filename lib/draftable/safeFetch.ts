/**
 * Fetching images from URLs that strangers control (profile pictures), from
 * the server. A hostname can resolve to anything, including this machine or a
 * cloud metadata address, so checking its text isn't enough: the address is
 * checked when the connection is made, and the connection goes to that very
 * address, so there is no second lookup to swap out from under the check.
 */

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { get as httpsGet } from "node:https";
import { isIP, type LookupFunction } from "node:net";

function ipv4Octets(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  return octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    ? octets
    : null;
}

function isPublicIPv4([a, b, c]: number[]): boolean {
  if (a === 0 || a === 10 || a === 127) return false; // "this", private, loopback
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false; // reserved, docs
  if (a === 192 && b === 88 && c === 99) return false; // 6to4 relay
  if (a === 192 && b === 168) return false; // private
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // docs
  if (a === 203 && b === 0 && c === 113) return false; // docs
  return a < 224; // multicast and reserved
}

/** Eight 16-bit groups, or null. */
function parseIPv6(ip: string): number[] | null {
  let text = ip.split("%")[0].toLowerCase();
  // A trailing dotted IPv4 (::ffff:1.2.3.4) is two more groups.
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const o = ipv4Octets(dotted[2]);
    if (!o) return null;
    text = `${dotted[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const split = (s: string) => (s === "" ? [] : s.split(":"));
  const head = split(halves[0]);
  const tail = halves.length === 2 ? split(halves[1]) : [];
  const gap = 8 - head.length - tail.length;
  if (halves.length === 1 ? gap !== 0 : gap < 1) return null;
  const groups = [
    ...head,
    ...Array(halves.length === 2 ? gap : 0).fill("0"),
    ...tail,
  ];
  const nums = groups.map((g) =>
    /^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN,
  );
  return nums.length === 8 && !nums.some(Number.isNaN) ? nums : null;
}

const embeddedV4 = (hi: number, lo: number) => [
  hi >> 8,
  hi & 255,
  lo >> 8,
  lo & 255,
];

function isPublicIPv6(g: number[]): boolean {
  // ::, ::1, and IPv4-mapped or -compatible addresses: judge the IPv4 inside.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return isPublicIPv4(embeddedV4(g[6], g[7]));
  }
  // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) carry an IPv4 address too.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPublicIPv4(embeddedV4(g[6], g[7]));
  }
  if (g[0] === 0x2002) return isPublicIPv4(embeddedV4(g[1], g[2]));
  // Otherwise only global unicast (2000::/3), minus Teredo and documentation.
  if ((g[0] & 0xe000) !== 0x2000) return false;
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0x0db8)) return false;
  return true;
}

/** Whether an IP address is on the public internet (not private, loopback, link-local, or reserved). */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const octets = ipv4Octets(ip);
    return !!octets && isPublicIPv4(octets);
  }
  if (family === 6) {
    const groups = parseIPv6(ip);
    return !!groups && isPublicIPv6(groups);
  }
  return false;
}

/**
 * A connect-time DNS lookup that refuses to answer with anything but public
 * addresses. One non-public address in the answer rejects the whole answer.
 */
export function guardedLookup(
  resolve: typeof dnsLookup = dnsLookup,
): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) {
        callback(error, "", 4);
        return;
      }
      const list = addresses as LookupAddress[];
      if (list.length === 0 || list.some((a) => !isPublicAddress(a.address))) {
        const blocked = Object.assign(
          new Error(`${hostname} doesn't resolve to a public address`),
          { code: "EBLOCKED" },
        );
        callback(blocked, "", 4);
        return;
      }
      if (options.all) callback(null, list);
      else callback(null, list[0].address, list[0].family);
    });
  };
}

/**
 * Only fetch pictures from public https hosts on the default port, named by
 * a hostname (the address check at connect time does the rest).
 */
export function isFetchableImageUrl(raw: string | undefined): raw is string {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    if (url.port !== "") return false; // anything but 443
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

// The card renderer handles png/jpeg/gif; skip webp/avif/svg.
const ALLOWED_TYPE = /^image\/(png|jpe?g|gif)$/i;
const MAX_HOPS = 3;

export interface FetchedImage {
  type: string;
  data: Buffer;
}

interface Hop {
  location?: string;
  image?: FetchedImage;
}

function requestOnce(
  url: URL,
  maxBytes: number,
  timeoutMs: number,
  lookup: LookupFunction,
): Promise<Hop | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: Hop | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const request = httpsGet(
      url,
      {
        lookup,
        timeout: timeoutMs,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          accept: "image/png,image/jpeg,image/gif;q=0.9",
          "user-agent": "Mutable-card/1 (+https://mutable.top)",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          done({ location: response.headers.location });
          return;
        }
        const type = String(response.headers["content-type"] ?? "")
          .split(";")[0]
          .trim()
          .toLowerCase();
        const declared = Number(response.headers["content-length"] ?? 0);
        if (status !== 200 || !ALLOWED_TYPE.test(type) || declared > maxBytes) {
          response.destroy();
          done(null);
          return;
        }
        // Stop reading at the cap instead of buffering whatever arrives.
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            response.destroy();
            done(null);
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          done({ image: { type, data: Buffer.concat(chunks) } }),
        );
        response.on("error", () => done(null));
      },
    );
    request.on("timeout", () => {
      request.destroy();
      done(null);
    });
    request.on("error", () => done(null));
  });
}

/**
 * The picture at a URL, or null if it isn't a small public png/jpeg/gif.
 * Redirects are followed by hand so every hop gets the same checks.
 */
export async function fetchPublicImage(
  raw: string | undefined,
  options: {
    maxBytes: number;
    timeoutMs: number;
    lookup?: LookupFunction;
  },
): Promise<FetchedImage | null> {
  const lookup = options.lookup ?? guardedLookup();
  let target = raw;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (!isFetchableImageUrl(target)) return null;
    const result = await requestOnce(
      new URL(target),
      options.maxBytes,
      options.timeoutMs,
      lookup,
    );
    if (!result) return null;
    if (result.location) {
      try {
        target = new URL(result.location, target).toString();
      } catch {
        return null;
      }
      continue;
    }
    return result.image ?? null;
  }
  return null;
}
