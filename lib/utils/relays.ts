import { DEFAULT_RELAYS } from "@/lib/nostr";

/** Get relays from session, falling back to DEFAULT_RELAYS. */
export function getRelays(
  session: { relays?: string[] } | null | undefined,
): string[] {
  return session?.relays && session.relays.length > 0
    ? session.relays
    : DEFAULT_RELAYS;
}
