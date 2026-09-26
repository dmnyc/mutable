import type { LazarusItemCount } from "@/lib/lazarus";
import { getLazarusItemRange } from "@/lib/lazarus";
import { hexToNote, hexToNpub } from "@/lib/nostr";

const ITEM_NOUNS: Record<number, [string, string]> = {
  3: ["follow", "follows"],
  10000: ["item", "items"],
  10003: ["bookmark", "bookmarks"],
  10044: ["key", "keys"],
  10002: ["relay", "relays"],
  10050: ["relay", "relays"],
  10006: ["relay", "relays"],
};

// "Mute list" reads as "mute list" mid-sentence; "DM relays" keeps its acronym.
export function kindPhrase(name: string): string {
  return name.length > 1 && name[1] === name[1].toLowerCase()
    ? name[0].toLowerCase() + name.slice(1)
    : name;
}

export function itemNoun(kind: number, count: number): string {
  const [one, many] = ITEM_NOUNS[kind] ?? ["item", "items"];
  return count === 1 ? one : many;
}

export function formatCount(kind: number, itemCount: LazarusItemCount): string {
  if (kind === 0) return itemCount.count > 0 ? "Profile" : "Empty profile";
  const { min, max } = getLazarusItemRange(itemCount);
  if (min === max) return `${min} ${itemNoun(kind, min)}`;
  return `≈ ${min}–${max} ${itemNoun(kind, max)}`;
}

export function formatDateTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString("en-US", {
    dateStyle: "medium",
  });
}

function shorten(value: string, head = 12, tail = 6): string {
  return value.length > head + tail + 1
    ? `${value.slice(0, head)}…${value.slice(-tail)}`
    : value;
}

function safely(convert: (value: string) => string, value: string): string {
  try {
    return convert(value);
  } catch {
    return value;
  }
}

export function describeItem(tag: string[]): string {
  const [type, value = "", marker] = tag;
  switch (type) {
    case "p":
      return shorten(safely(hexToNpub, value), 14, 6);
    case "word":
      return `word “${value}”`;
    case "t":
      return `#${value}`;
    case "e":
      return shorten(safely(hexToNote, value), 14, 6);
    case "a":
      return shorten(value, 24, 12);
    case "r":
      return marker ? `${value} (${marker} only)` : value;
    case "relay":
      return value;
    default:
      return tag.join(" ");
  }
}

export function shortRelay(url: string): string {
  return url.replace(/^wss?:\/\//, "");
}
