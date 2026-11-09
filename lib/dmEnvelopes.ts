import type { Event } from "nostr-tools";
import { DMActivityDay, DMMessageMeta } from "@/types";

/**
 * Convert a fetched kind:4 event into its public envelope snapshot —
 * everything a message row and the raw-JSON view need, without the plaintext.
 */
export function dmEventToMeta(
  event: Event,
  direction: "sent" | "received",
): DMMessageMeta {
  const tagValue = (name: string): string | undefined =>
    event.tags.find((t) => t[0] === name)?.[1] || undefined;
  const expiration = tagValue("expiration");

  return {
    eventId: event.id,
    createdAt: event.created_at,
    direction,
    counterparty:
      direction === "sent" ? tagValue("p") || "" : event.pubkey,
    contentLength: event.content?.length ?? 0,
    client: tagValue("client"),
    replyToEventId: tagValue("e"),
    expiresAt: expiration ? Number(expiration) || undefined : undefined,
    raw: {
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      tags: event.tags,
      content: event.content,
      sig: event.sig,
    },
  };
}

/**
 * Merge newly fetched envelopes into heatmap buckets, deduped by event id,
 * with per-day counts recomputed. Touches only the days that change; the
 * result is sorted by date.
 */
export function mergeEnvelopesIntoHeatmap(
  heatmapData: DMActivityDay[],
  incoming: DMMessageMeta[],
): DMActivityDay[] {
  if (incoming.length === 0) return heatmapData;

  const existing = new Set(
    heatmapData.flatMap((day) => (day.messages ?? []).map((m) => m.eventId)),
  );
  const fresh = incoming.filter((m) => !existing.has(m.eventId));
  if (fresh.length === 0) return heatmapData;

  const freshByDate = new Map<string, DMMessageMeta[]>();
  for (const msg of fresh) {
    const date = new Date(msg.createdAt * 1000).toISOString().split("T")[0];
    const list = freshByDate.get(date) || [];
    list.push(msg);
    freshByDate.set(date, list);
  }

  const merged = heatmapData.map((day) => {
    const additions = freshByDate.get(day.date);
    if (!additions) return day;
    const messages = [
      ...(day.messages ?? []),
      ...additions,
    ].sort((a, b) => a.createdAt - b.createdAt);
    const sentCount = messages.filter((m) => m.direction === "sent").length;
    return {
      ...day,
      messages,
      sentCount,
      receivedCount: messages.length - sentCount,
      count: messages.length,
    };
  });

  const existingDates = new Set(heatmapData.map((day) => day.date));
  for (const [date, additions] of freshByDate) {
    if (existingDates.has(date)) continue;
    const sentCount = additions.filter((m) => m.direction === "sent").length;
    merged.push({
      date,
      count: additions.length,
      sentCount,
      receivedCount: additions.length - sentCount,
      messages: additions.sort((a, b) => a.createdAt - b.createdAt),
    });
  }

  return merged.sort((a, b) => a.date.localeCompare(b.date));
}
