import type { Event } from "nostr-tools";
import type { MuteList, Profile, RelayListMetadata } from "@/types";
import { extractTagEventRef, extractTagReason } from "@/lib/utils/nostrHelpers";
import { uniqueRelayUrls } from "./relays";

// Conversions from a restored event to the app's own copies, so the next edit
// in Mutable builds on the restored version instead of the clobbered one.

export function muteListFromTags(
  publicTags: string[][],
  privateTags: string[][] = [],
): MuteList {
  const list: MuteList = { pubkeys: [], words: [], tags: [], threads: [] };
  const add = (tag: string[], isPrivate: boolean) => {
    const [type, value, ...rest] = tag;
    if (!value) return;
    const reason = extractTagReason(rest);
    const eventRef = extractTagEventRef(rest);
    switch (type) {
      case "p":
        list.pubkeys.push({
          type: "pubkey",
          value,
          reason,
          eventRef,
          private: isPrivate,
        });
        break;
      case "word":
        list.words.push({
          type: "word",
          value,
          reason,
          eventRef,
          private: isPrivate,
        });
        break;
      case "t":
        list.tags.push({
          type: "tag",
          value,
          reason,
          eventRef,
          private: isPrivate,
        });
        break;
      case "e":
        list.threads.push({
          type: "thread",
          value,
          reason,
          private: isPrivate,
        });
        break;
    }
  };
  publicTags.forEach((tag) => add(tag, false));
  privateTags.forEach((tag) => add(tag, true));
  return list;
}

export function profileFromEvent(event: Event): Profile {
  let fields: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(event.content || "{}");
    if (parsed && typeof parsed === "object") {
      fields = parsed as Record<string, unknown>;
    }
  } catch {
    // An unreadable profile restores as an empty one.
  }
  const text = (key: string) =>
    typeof fields[key] === "string" ? (fields[key] as string) : undefined;
  return {
    pubkey: event.pubkey,
    name: text("name"),
    display_name: text("display_name"),
    about: text("about"),
    picture: text("picture"),
    banner: text("banner"),
    nip05: text("nip05"),
    lud16: text("lud16"),
    website: text("website"),
  };
}

export function relayListMetadataFromEvent(event: Event): RelayListMetadata {
  const read: string[] = [];
  const write: string[] = [];
  const both: string[] = [];
  for (const [name, url, marker] of event.tags) {
    if (name !== "r" || !url) continue;
    if (marker === "read") read.push(url);
    else if (marker === "write") write.push(url);
    else both.push(url);
  }
  return {
    read: uniqueRelayUrls(read),
    write: uniqueRelayUrls(write),
    both: uniqueRelayUrls(both),
    timestamp: event.created_at,
  };
}
