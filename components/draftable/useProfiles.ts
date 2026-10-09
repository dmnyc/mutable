"use client";

import { useEffect, useMemo, useState } from "react";
import { Profile } from "@/types";
import { fetchProfile, DEFAULT_RELAYS } from "@/lib/nostr";
import { naMetadata } from "@/lib/nostrArchives";

// Shared across every Draftable view so moving from the pack grid into a pack
// doesn't refetch faces we already have. null = looked up, nothing found.
const cache = new Map<string, Profile | null>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();

const RELAY_BATCH = 6;

function notify() {
  listeners.forEach((listener) => listener());
}

async function load(pubkeys: string[], relays: string[]) {
  const wanted = pubkeys.filter((p) => !cache.has(p) && !inflight.has(p));
  if (wanted.length === 0) return;
  wanted.forEach((p) => inflight.add(p));

  try {
    // One bulk request to the archive index covers most people...
    for (const p of await naMetadata(wanted)) {
      cache.set(p.pubkey, {
        pubkey: p.pubkey,
        name: p.preferred_name || p.name,
        display_name: p.display_name,
        picture: p.picture,
        nip05: p.nip05,
        about: p.about,
      });
    }
    notify();

    // ...and relays fill in the rest, a few at a time so faces pop in.
    const missing = wanted.filter((p) => !cache.has(p));
    for (let i = 0; i < missing.length; i += RELAY_BATCH) {
      const batch = missing.slice(i, i + RELAY_BATCH);
      const results = await Promise.all(
        batch.map((pk) => fetchProfile(pk, relays).catch(() => null)),
      );
      batch.forEach((pk, idx) => cache.set(pk, results[idx]));
      notify();
    }
  } finally {
    wanted.forEach((p) => inflight.delete(p));
  }
}

/** Profiles for the given pubkeys, filled in progressively as they load. */
export function useProfiles(
  pubkeys: string[],
  relays: string[] = DEFAULT_RELAYS,
): Map<string, Profile> {
  const [version, setVersion] = useState(0);
  const key = pubkeys.join(",");

  useEffect(() => {
    const listener = () => setVersion((v) => v + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (!key) return;
    load(key.split(","), relays);
    // relays only matter for the first lookup of each pubkey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return useMemo(() => {
    const map = new Map<string, Profile>();
    for (const pubkey of key ? key.split(",") : []) {
      const profile = cache.get(pubkey);
      if (profile) map.set(pubkey, profile);
    }
    return map;
    // version bumps whenever the cache gains entries
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
}
