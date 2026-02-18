import { hexToNpub } from "@/lib/nostr";

/** Resolve a profile's display name with fallback chain. */
export function getDisplayName(
  profile: { display_name?: string; name?: string } | null | undefined,
  fallback: string = "Anonymous",
): string {
  return profile?.display_name || profile?.name || fallback;
}

/** Truncate an npub for display. Converts hex pubkey to npub first. */
export function truncateNpub(
  pubkey: string,
  startChars: number = 16,
  endChars: number = 8,
): string {
  try {
    const npub = hexToNpub(pubkey);
    return `${npub.slice(0, startChars)}...${npub.slice(-endChars)}`;
  } catch {
    return `${pubkey.slice(0, startChars)}...${pubkey.slice(-endChars)}`;
  }
}

/** Safely extract an error message from an unknown thrown value. */
export function getErrorMessage(
  error: unknown,
  fallback: string = "An unexpected error occurred",
): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return fallback;
}
