import { verifyEvent, type Event } from "nostr-tools";
import { fitsNip46Request } from "./nip46";
import { countItemTags, getContentEncryption } from "./private-items";
import {
  getLazarusKindProfile,
  type LazarusItemCount,
  type LazarusKindProfile,
} from "./registry";

// Lazarus core (spec 0.6.0-draft): scan orchestration, ranking, deltas, and
// the recovery draft. Pure: relays come in through a LazarusRelaySource, and
// nothing here signs or publishes.

const RELAY_LIST_KIND = 10002;

// A drop of at least 20% and at least 5 items between two versions is a
// sudden drop; curation moves a few items at a time.
const CLOBBER_MIN_LOSS_RATIO = 0.2;
const CLOBBER_MIN_LOSS_ITEMS = 5;
const CLOBBER_EPISODE_SECONDS = 24 * 60 * 60;
// A clobber edited on this often, over this long, is the user's choice now.
const SETTLED_MIN_EDITS = 5;
const SETTLED_MIN_SECONDS = 7 * 24 * 60 * 60;

export interface LazarusTaggedEvent {
  event: Event;
  relayUrl: string;
}

export type LazarusRelayOutcome = "answered" | "failed" | "timed-out";

export type LazarusRelayListStatus = "found" | "missing" | "unknown";

export interface LazarusCandidate {
  event: Event;
  foundOn: string[];
  itemCount: LazarusItemCount;
  isCurrent: boolean;
  isRecommended: boolean;
}

export interface LazarusScanResult {
  kind: number;
  candidates: LazarusCandidate[];
  current: LazarusCandidate | undefined;
  recommended: LazarusCandidate | undefined;
  requiresIntentConfirmation: boolean;
  queriedRelays: string[];
  // Relays that returned at least one valid version.
  respondingRelays: string[];
  currentConfirmed: boolean;
  relayOutcomes?: Record<string, LazarusRelayOutcome>;
  relayList?: LazarusRelayListStatus;
  writeRelays?: string[];
  olderCursors?: Record<string, number>;
}

export type LazarusPrivateTags = ReadonlyMap<string, string[][]>;

export function getLazarusItemRange(itemCount: LazarusItemCount): {
  min: number;
  max: number;
} {
  const { count, privateCount, privateEstimate } = itemCount;
  if (privateCount !== undefined) {
    return { min: count + privateCount, max: count + privateCount };
  }
  if (privateEstimate) {
    return {
      min: count + privateEstimate.min,
      max: count + privateEstimate.max,
    };
  }
  return { min: count, max: count };
}

export function isLazarusSizeKnown(itemCount: LazarusItemCount): boolean {
  return !itemCount.partial || !!itemCount.privateEstimate;
}

function countItems(
  profile: LazarusKindProfile,
  event: Event,
  privateTags: string[][] | undefined,
): LazarusItemCount {
  const itemCount = profile.itemCount(event);
  if (!privateTags || !profile.privateItemTypes) return itemCount;
  return {
    count: itemCount.count,
    partial: false,
    privateCount: countItemTags(privateTags, profile.privateItemTypes),
  };
}

export interface LazarusRelaySource {
  // With cursors, fetch the next older page from just those relays.
  fetchVersions(
    kind: number,
    pubkey: string,
    cursors?: Record<string, number>,
  ): Promise<{
    tagged: LazarusTaggedEvent[];
    queriedRelays: string[];
    respondingRelays: string[];
    olderCursors?: Record<string, number>;
    outcomes?: Record<string, LazarusRelayOutcome>;
    // A source that doesn't report it is taken as confirmed.
    currentConfirmed?: boolean;
    relayList?: LazarusRelayListStatus;
    writeRelays?: string[];
  }>;
}

// Relays are untrusted: a restore would sign whatever content they return.
export function isLazarusVersion(
  event: Event,
  kind: number,
  pubkey: string,
): boolean {
  return event.kind === kind && event.pubkey === pubkey && verifyEvent(event);
}

export function scanLazarusKind(
  kind: number,
  pubkey: string,
  source: LazarusRelaySource,
): Promise<LazarusScanResult> {
  const profile = getLazarusKindProfile(kind);
  if (!profile) {
    return Promise.reject(
      new Error(`kind ${kind} is not in the Lazarus registry`),
    );
  }
  return source.fetchVersions(kind, pubkey).then((result) => {
    // No answer at all is a failed scan, not an empty one; versions that
    // arrived before the relays failed are still shown.
    if (
      result.outcomes &&
      result.tagged.length === 0 &&
      !answeredAny(result.outcomes)
    ) {
      throw new Error("No relay answered the scan");
    }
    return {
      ...rankLazarusCandidates(
        profile,
        result.tagged,
        result.queriedRelays,
        result.respondingRelays,
        new Map(),
        result.currentConfirmed ?? true,
      ),
      olderCursors: result.olderCursors ?? {},
      relayOutcomes: result.outcomes,
      relayList: result.relayList,
      writeRelays: result.writeRelays,
    };
  });
}

function answeredAny(outcomes: Record<string, LazarusRelayOutcome>): boolean {
  return Object.values(outcomes).includes("answered");
}

export function lazarusScanReachedNoRelay(scan: LazarusScanResult): boolean {
  return !!scan.relayOutcomes && !answeredAny(scan.relayOutcomes);
}

export async function loadOlderLazarusVersions(
  profile: LazarusKindProfile,
  scan: LazarusScanResult,
  pubkey: string,
  source: LazarusRelaySource,
  privateTags: LazarusPrivateTags = new Map(),
): Promise<LazarusScanResult> {
  const cursors = scan.olderCursors ?? {};
  if (Object.keys(cursors).length === 0) return scan;
  const older = await source.fetchVersions(profile.kind, pubkey, cursors);
  return {
    ...rankLazarusCandidates(
      profile,
      [...scanToTagged(scan), ...older.tagged],
      scan.queriedRelays,
      Array.from(
        new Set([...scan.respondingRelays, ...older.respondingRelays]),
      ),
      privateTags,
      scan.currentConfirmed,
    ),
    olderCursors: older.olderCursors ?? {},
    relayOutcomes: scan.relayOutcomes,
    relayList: scan.relayList,
    writeRelays: scan.writeRelays,
  };
}

export interface LazarusRetryResult {
  tagged: LazarusTaggedEvent[];
  respondingRelays: string[];
  outcomes: Record<string, LazarusRelayOutcome>;
  olderCursors?: Record<string, number>;
}

// Merge a retry of the relays that failed or timed out into the scan.
export function mergeLazarusRetry(
  profile: LazarusKindProfile,
  scan: LazarusScanResult,
  retry: LazarusRetryResult,
  privateTags: LazarusPrivateTags = new Map(),
): LazarusScanResult {
  const relayOutcomes = { ...scan.relayOutcomes, ...retry.outcomes };
  const currentConfirmed = scan.writeRelays
    ? scan.writeRelays.some((url) => relayOutcomes[url] === "answered")
    : scan.currentConfirmed;
  return {
    ...rankLazarusCandidates(
      profile,
      [...scanToTagged(scan), ...retry.tagged],
      scan.queriedRelays,
      Array.from(
        new Set([...scan.respondingRelays, ...retry.respondingRelays]),
      ),
      privateTags,
      currentConfirmed,
    ),
    olderCursors: { ...scan.olderCursors, ...retry.olderCursors },
    relayOutcomes,
    relayList: scan.relayList,
    writeRelays: scan.writeRelays,
  };
}

function scanToTagged(scan: LazarusScanResult): LazarusTaggedEvent[] {
  return scan.candidates.flatMap((candidate) =>
    candidate.foundOn.map((relayUrl) => ({ event: candidate.event, relayUrl })),
  );
}

function looksClobbered(laterMax: number, earlierMin: number): boolean {
  if (earlierMin <= 0) return false;
  if (laterMax <= 0) return true;
  const loss = earlierMin - laterMax;
  return (
    loss >= CLOBBER_MIN_LOSS_ITEMS &&
    loss >= earlierMin * CLOBBER_MIN_LOSS_RATIO
  );
}

function knownTimeline(candidates: LazarusCandidate[]): LazarusCandidate[] {
  return candidates
    .filter((c) => isLazarusSizeKnown(c.itemCount))
    .sort(
      (a, b) =>
        a.event.created_at - b.event.created_at ||
        (a.event.id < b.event.id ? 1 : -1),
    );
}

interface ClobberEpisode {
  drops: number[];
  first: number;
  last: number;
}

// Newest episode first. Drops back to back or within a day are one episode.
function findClobberEpisodes(timeline: LazarusCandidate[]): ClobberEpisode[] {
  const range = (i: number) => getLazarusItemRange(timeline[i].itemCount);
  const episodes: ClobberEpisode[] = [];
  for (let i = 1; i < timeline.length; i++) {
    if (!looksClobbered(range(i).max, range(i - 1).min)) continue;
    const open = episodes[episodes.length - 1];
    if (
      open &&
      (i - 1 === open.last ||
        timeline[i].event.created_at - timeline[open.last].event.created_at <=
          CLOBBER_EPISODE_SECONDS)
    ) {
      open.drops.push(i);
      open.last = i;
    } else {
      episodes.push({ drops: [i], first: i - 1, last: i });
    }
  }
  return episodes.reverse();
}

function findRestorePoint(
  candidates: LazarusCandidate[],
  current: LazarusCandidate,
): LazarusCandidate | undefined {
  const timeline = knownTimeline(candidates);
  const minOf = (c: LazarusCandidate) => getLazarusItemRange(c.itemCount).min;
  const currentMax = getLazarusItemRange(current.itemCount).max;

  for (const episode of findClobberEpisodes(timeline)) {
    const restorePoint = episode.drops
      .map((i) => timeline[i - 1])
      .reduce((fullest, c) => (minOf(c) >= minOf(fullest) ? c : fullest));
    if (!looksClobbered(currentMax, minOf(restorePoint))) continue;
    const edits = timeline.length - 1 - episode.last;
    const settledFor =
      current.event.created_at - timeline[episode.last].event.created_at;
    if (edits >= SETTLED_MIN_EDITS && settledFor >= SETTLED_MIN_SECONDS) {
      return undefined;
    }
    return restorePoint;
  }
  return undefined;
}

export function rankLazarusCandidates(
  profile: LazarusKindProfile,
  taggedEvents: LazarusTaggedEvent[],
  queriedRelays: string[] = [],
  respondingRelays: string[] = [],
  privateTags: LazarusPrivateTags = new Map(),
  currentConfirmed = true,
): LazarusScanResult {
  const byId = new Map<string, LazarusCandidate>();
  for (const { event, relayUrl } of taggedEvents) {
    const existing = byId.get(event.id);
    if (existing) {
      if (!existing.foundOn.includes(relayUrl)) existing.foundOn.push(relayUrl);
      continue;
    }
    byId.set(event.id, {
      event,
      foundOn: [relayUrl],
      itemCount: countItems(profile, event, privateTags.get(event.id)),
      isCurrent: false,
      isRecommended: false,
    });
  }

  const candidates = Array.from(byId.values());
  // Same-second versions: the lowest id wins, as relays apply it (NIP-01).
  const newestFirst = [...candidates].sort(
    (a, b) =>
      b.event.created_at - a.event.created_at ||
      (a.event.id < b.event.id ? -1 : 1),
  );
  const current = newestFirst[0];
  if (current) current.isCurrent = true;

  let ordered: LazarusCandidate[];
  let recommended: LazarusCandidate | undefined;
  const requiresIntentConfirmation = profile.ranking === "intent";

  if (profile.ranking === "count") {
    const size = (c: LazarusCandidate) => {
      const range = getLazarusItemRange(c.itemCount);
      return range.min + range.max;
    };
    ordered = [...candidates].sort(
      (a, b) => size(b) - size(a) || b.event.created_at - a.event.created_at,
    );
    if (currentConfirmed && current && isLazarusSizeKnown(current.itemCount)) {
      recommended = findRestorePoint(candidates, current);
    }
  } else {
    ordered = newestFirst;
  }

  if (recommended) recommended.isRecommended = true;

  return {
    kind: profile.kind,
    candidates: ordered,
    current,
    recommended,
    requiresIntentConfirmation,
    queriedRelays,
    respondingRelays,
    currentConfirmed,
  };
}

export function applyLazarusPrivateTags(
  profile: LazarusKindProfile,
  scan: LazarusScanResult,
  privateTags: LazarusPrivateTags,
): LazarusScanResult {
  return {
    ...rankLazarusCandidates(
      profile,
      scanToTagged(scan),
      scan.queriedRelays,
      scan.respondingRelays,
      privateTags,
      scan.currentConfirmed,
    ),
    olderCursors: scan.olderCursors,
    relayOutcomes: scan.relayOutcomes,
    relayList: scan.relayList,
    writeRelays: scan.writeRelays,
  };
}

export type LazarusSortOrder = "date" | "size";

export function sortLazarusCandidates(
  candidates: LazarusCandidate[],
  order: LazarusSortOrder,
): LazarusCandidate[] {
  const byDate = (a: LazarusCandidate, b: LazarusCandidate) =>
    b.event.created_at - a.event.created_at ||
    (a.event.id < b.event.id ? -1 : 1);
  if (order === "date") return [...candidates].sort(byDate);
  const size = (c: LazarusCandidate) => {
    const range = getLazarusItemRange(c.itemCount);
    return range.min + range.max;
  };
  return [...candidates].sort((a, b) => size(b) - size(a) || byDate(a, b));
}

export function isPastEmptyVersion(
  candidate: LazarusCandidate,
  profile: LazarusKindProfile,
): boolean {
  return (
    !candidate.isCurrent &&
    !profile.meaningfulEmpty &&
    isLazarusSizeKnown(candidate.itemCount) &&
    getLazarusItemRange(candidate.itemCount).max === 0
  );
}

export type LazarusListItem =
  | { type: "version"; candidate: LazarusCandidate }
  | { type: "group"; candidates: LazarusCandidate[]; clobbered: boolean };

// Newest first, folding runs of small edits and clobber episodes into groups.
// Current and empty versions keep their own rows.
export function groupLazarusCandidates(
  scan: LazarusScanResult,
  profile: LazarusKindProfile,
  { hidePastEmpty = false }: { hidePastEmpty?: boolean } = {},
): LazarusListItem[] {
  const newestFirst = sortLazarusCandidates(scan.candidates, "date");
  const visible = hidePastEmpty
    ? newestFirst.filter((candidate) => !isPastEmptyVersion(candidate, profile))
    : newestFirst;
  if (profile.ranking !== "count") {
    return visible.map((candidate): LazarusListItem => ({
      type: "version",
      candidate,
    }));
  }

  const timeline = knownTimeline(scan.candidates);
  const episodeOf = new Map<string, number>();
  findClobberEpisodes(timeline).forEach((episode, n) => {
    for (let i = episode.first; i <= episode.last; i++) {
      episodeOf.set(timeline[i].event.id, n);
    }
  });

  const items: LazarusListItem[] = [];
  let run: LazarusCandidate[] = [];
  let runEpisode: number | undefined;
  const flush = () => {
    if (run.length === 1) items.push({ type: "version", candidate: run[0] });
    if (run.length > 1) {
      items.push({
        type: "group",
        candidates: run,
        clobbered: runEpisode !== undefined,
      });
    }
    run = [];
  };
  for (const candidate of visible) {
    const empty =
      isLazarusSizeKnown(candidate.itemCount) &&
      getLazarusItemRange(candidate.itemCount).max === 0;
    if (candidate.isCurrent || empty) {
      flush();
      items.push({ type: "version", candidate });
      continue;
    }
    const episode = episodeOf.get(candidate.event.id);
    if (run.length > 0 && episode !== runEpisode) flush();
    runEpisode = episode;
    run.push(candidate);
  }
  flush();
  return items;
}

export interface LazarusDelta {
  added: string[][];
  removed: string[][];
  addedCount: number;
  removedCount: number;
  grows: boolean;
  shrinks: boolean;
  // Private items in either version couldn't be compared.
  privateUnknown: boolean;
}

// Type and value identify an item; a rewritten relay hint or petname isn't a
// change. On relay lists the read/write marker counts too.
function tagIdentity(tag: string[], kind: number): string {
  return JSON.stringify(tag.slice(0, kind === RELAY_LIST_KIND ? 3 : 2));
}

export function computeLazarusDelta(
  chosen: Event,
  current: Event | undefined,
  privateTags: LazarusPrivateTags = new Map(),
): LazarusDelta {
  const itemsOf = (event: Event | undefined) => {
    if (!event) return { tags: [] as string[][], unknown: false };
    const decrypted = privateTags.get(event.id);
    return {
      tags: [...event.tags, ...(decrypted ?? [])],
      unknown: !decrypted && !!getContentEncryption(event.content),
    };
  };
  const identity = (tag: string[]) => tagIdentity(tag, chosen.kind);
  const unique = (tags: string[][]) =>
    Array.from(new Map(tags.map((t) => [identity(t), t])).values());
  const chosenTags = unique(itemsOf(chosen).tags);
  const currentTags = unique(itemsOf(current).tags);
  const chosenIds = new Set(chosenTags.map(identity));
  const currentIds = new Set(currentTags.map(identity));
  const added = chosenTags.filter((tag) => !currentIds.has(identity(tag)));
  const removed = currentTags.filter((tag) => !chosenIds.has(identity(tag)));
  return {
    added,
    removed,
    addedCount: added.length,
    removedCount: removed.length,
    grows: added.length > 0 && added.length >= removed.length,
    shrinks: removed.length > added.length,
    privateUnknown: itemsOf(chosen).unknown || itemsOf(current).unknown,
  };
}

const PROFILE_FIELDS = [
  "name",
  "display_name",
  "about",
  "picture",
  "banner",
  "nip05",
  "lud16",
  "lud06",
  "website",
];

export interface LazarusProfileChange {
  field: string;
  from?: string;
  to?: string;
}

// A restore replaces all of a profile, so every field and tag counts.
export function computeLazarusProfileChanges(
  chosen: Event,
  current: Event | undefined,
): LazarusProfileChange[] {
  const fieldsOf = (event: Event | undefined): Record<string, unknown> => {
    try {
      const parsed = JSON.parse(event?.content || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  };
  const tagsOf = (event: Event | undefined): Record<string, string> => {
    const byName: Record<string, string[]> = {};
    for (const [name, ...values] of event?.tags ?? []) {
      if (name) (byName[`${name} tags`] ??= []).push(values.join(" "));
    }
    return Object.fromEntries(
      Object.entries(byName).map(([field, values]) => [
        field,
        values.sort().join(", "),
      ]),
    );
  };
  const text = (value: unknown) => {
    if (typeof value === "string") return value.trim() ? value : undefined;
    return value === undefined || value === null
      ? undefined
      : JSON.stringify(value);
  };
  const to = fieldsOf(chosen);
  const from = fieldsOf(current);
  const toTags = tagsOf(chosen);
  const fromTags = tagsOf(current);
  const otherFields = Array.from(
    new Set([...Object.keys(from), ...Object.keys(to)]),
  )
    .filter((field) => !PROFILE_FIELDS.includes(field))
    .sort();
  const tagFields = Array.from(
    new Set([...Object.keys(fromTags), ...Object.keys(toTags)]),
  ).sort();
  return [
    ...[...PROFILE_FIELDS, ...otherFields].map((field) => ({
      field,
      from: text(from[field]),
      to: text(to[field]),
    })),
    ...tagFields.map((field) => ({
      field,
      from: fromTags[field],
      to: toTags[field],
    })),
  ].filter((change) => change.from !== change.to);
}

export interface LazarusReadAnswer {
  events: Event[];
  answered: boolean;
}

export type LazarusCurrentCheck =
  | { status: "proceed"; current: Event | undefined }
  | { status: "changed"; current: Event }
  | { status: "unconfirmed" };

// Only a newer version is a change: the re-read asks fewer relays than the
// scan did. An empty answer from a write relay confirms; the local copy alone
// never does.
export function checkLazarusCurrent(
  reviewed: Event | undefined,
  local: Event | undefined,
  answers: LazarusReadAnswer[],
): LazarusCurrentCheck {
  let newest = reviewed;
  for (const event of [local, ...answers.flatMap((answer) => answer.events)]) {
    if (event && (!newest || event.created_at > newest.created_at)) {
      newest = event;
    }
  }
  if (newest && newest.id !== reviewed?.id) {
    return { status: "changed", current: newest };
  }
  if (!answers.some((answer) => answer.answered)) {
    return { status: "unconfirmed" };
  }
  return { status: "proceed", current: reviewed };
}

export interface LazarusRecoveryDraft {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
}

// Copies the item set verbatim (private content stays encrypted to the user)
// and dates it after current, even when a clobbering client's clock ran ahead.
export function buildLazarusRecoveryDraft(
  chosen: Event,
  {
    current,
    now = Math.floor(Date.now() / 1000),
  }: { current?: Event; now?: number } = {},
): LazarusRecoveryDraft {
  return {
    kind: chosen.kind,
    content: chosen.content,
    tags: chosen.tags.map((tag) => [...tag]),
    created_at: Math.max(now, (current?.created_at ?? 0) + 1),
  };
}

export function fitsLazarusRemoteRestore(
  chosen: Event,
  pubkey: string,
): boolean {
  return fitsNip46Request("sign_event", [
    JSON.stringify({ ...buildLazarusRecoveryDraft(chosen), pubkey }),
  ]);
}
