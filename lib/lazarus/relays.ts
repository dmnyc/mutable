import type { Event, Filter } from "nostr-tools";
import {
  isLazarusVersion,
  type LazarusReadAnswer,
  type LazarusRelayListStatus,
  type LazarusRelayOutcome,
  type LazarusRelaySource,
  type LazarusRetryResult,
  type LazarusTaggedEvent,
} from "./recovery";

// Mutable's relay layer for Lazarus. Each request opens its own socket and
// reads the relay's actual EOSE / CLOSED / close, so an unreachable relay is
// never mistaken for an empty one (pooled clients report EOSE on failures),
// and every socket is closed when its request ends.

const RELAY_LIST_KIND = 10002;
export const LAZARUS_SCAN_TIMEOUT_MS = 6000;
export const LAZARUS_REREAD_TIMEOUT_MS = 5000;
const PUBLISH_TIMEOUT_MS = 8000;
const SCAN_LIMIT = 50;
const DEFAULT_CONCURRENCY = 12;
const MAX_EVENTS_PER_REQUEST = 1000;

// Relays observed keeping replaceable history (Lazarus README, 2026-09).
export const LAZARUS_ARCHIVAL_RELAYS = [
  "wss://relay.ditto.pub",
  "wss://hist.nostr.land",
  "wss://nos.lol",
  "wss://nostr.mom",
  "wss://purplepag.es",
  "wss://nostr.bitcoiner.social",
];

export interface LazarusSocket {
  readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export type LazarusSocketFactory = (url: string) => LazarusSocket;

const SOCKET_OPEN = 1;

const browserSocketFactory: LazarusSocketFactory = (url) =>
  new WebSocket(url) as unknown as LazarusSocket;

let socketFactory: LazarusSocketFactory = browserSocketFactory;

// Tests inject a fake relay; called with no argument it restores WebSocket.
export function setLazarusSocketFactory(factory?: LazarusSocketFactory): void {
  socketFactory = factory ?? browserSocketFactory;
}

export function normalizeLazarusRelayUrl(url: string): string | null {
  const trimmed = url?.trim();
  if (!trimmed || !/^wss?:\/\//i.test(trimmed)) return null;
  return trimmed.replace(/\/+$/, "").toLowerCase();
}

export function uniqueRelayUrls(urls: string[]): string[] {
  return Array.from(
    new Set(
      urls.map(normalizeLazarusRelayUrl).filter((url): url is string => !!url),
    ),
  );
}

export interface LazarusRelayAnswer {
  url: string;
  events: Event[];
  outcome: LazarusRelayOutcome;
  reason?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function closeSocket(socket: LazarusSocket | undefined, farewell?: string) {
  if (!socket) return;
  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;
  try {
    if (farewell && socket.readyState === SOCKET_OPEN) socket.send(farewell);
  } catch {
    // The socket is going away regardless.
  }
  try {
    socket.close();
  } catch {
    // Already closed.
  }
}

function parseMessage(data: unknown): unknown[] | undefined {
  try {
    const parsed: unknown = JSON.parse(String(data));
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// Events sent before a failure or timeout are kept: they're real versions,
// even though that relay's history is incomplete.
export function requestFromRelay(
  url: string,
  filters: Filter | Filter[],
  timeoutMs: number = LAZARUS_SCAN_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<LazarusRelayAnswer> {
  return new Promise((resolve) => {
    const events: Event[] = [];
    const subId = `lazarus-${Math.random().toString(36).slice(2, 10)}`;
    let socket: LazarusSocket | undefined;
    let done = false;

    const finish = (outcome: LazarusRelayOutcome, reason?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      closeSocket(socket, JSON.stringify(["CLOSE", subId]));
      resolve({ url, events, outcome, reason });
    };
    const onAbort = () => finish("failed", "canceled");
    const timer = setTimeout(() => finish("timed-out"), timeoutMs);

    if (signal?.aborted) return finish("failed", "canceled");
    signal?.addEventListener("abort", onAbort);

    try {
      socket = socketFactory(url);
    } catch (error) {
      return finish("failed", errorMessage(error));
    }

    socket.onopen = () => {
      try {
        const list = Array.isArray(filters) ? filters : [filters];
        socket?.send(JSON.stringify(["REQ", subId, ...list]));
      } catch (error) {
        finish("failed", errorMessage(error));
      }
    };
    socket.onmessage = (message) => {
      const data = parseMessage(message.data);
      if (!data || data[1] !== subId) return;
      const [type, , payload] = data;
      if (type === "EVENT") {
        if (payload && typeof payload === "object") {
          if (events.length < MAX_EVENTS_PER_REQUEST) {
            events.push(payload as Event);
          }
        }
      } else if (type === "EOSE") {
        finish("answered");
      } else if (type === "CLOSED") {
        finish("failed", typeof payload === "string" ? payload : "closed");
      }
    };
    socket.onerror = () => finish("failed", "connection error");
    socket.onclose = () => finish("failed", "connection closed");
  });
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}

export interface LazarusRequestOptions {
  timeoutMs?: number;
  concurrency?: number;
  signal?: AbortSignal;
}

export function requestFromRelays(
  urls: string[],
  filtersFor: (url: string) => Filter | Filter[],
  { timeoutMs, concurrency, signal }: LazarusRequestOptions = {},
): Promise<LazarusRelayAnswer[]> {
  return mapWithConcurrency(
    urls,
    (url) => requestFromRelay(url, filtersFor(url), timeoutMs, signal),
    concurrency,
  );
}

export interface LazarusOwnRelayList {
  read: string[];
  write: string[];
  createdAt: number;
}

export interface LazarusRelayConfig {
  defaultRelays: string[];
  archivalRelays?: string[];
  // The app's own copy of the user's relay list.
  ownRelayList?: LazarusOwnRelayList;
  timeoutMs?: number;
  concurrency?: number;
  signal?: AbortSignal;
}

export interface LazarusUserRelays {
  read: string[];
  write: string[];
  relayList: LazarusRelayListStatus;
}

function requestOptions(config: LazarusRelayConfig): LazarusRequestOptions {
  return {
    timeoutMs: config.timeoutMs,
    concurrency: config.concurrency,
    signal: config.signal,
  };
}

function newestValid(
  events: Event[],
  kind: number,
  pubkey: string,
): Event | undefined {
  return events
    .filter((event) => isLazarusVersion(event, kind, pubkey))
    .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1))[0];
}

// An unmarked relay is both read and write (NIP-65).
export function parseRelayListEvent(event: Event): {
  read: string[];
  write: string[];
} {
  const read: string[] = [];
  const write: string[] = [];
  for (const [name, url, marker] of event.tags) {
    if (name !== "r" || !url) continue;
    if (marker !== "write") read.push(url);
    if (marker !== "read") write.push(url);
  }
  return { read: uniqueRelayUrls(read), write: uniqueRelayUrls(write) };
}

// The newest relay list, from relays or the app's copy. A list relays answered
// without is missing (defaults stand in, labeled); one no relay answered for,
// with no copy on hand, is unknown and never substituted.
export async function resolveLazarusRelays(
  pubkey: string,
  config: LazarusRelayConfig,
): Promise<LazarusUserRelays> {
  const lookupRelays = uniqueRelayUrls([
    ...config.defaultRelays,
    ...(config.archivalRelays ?? LAZARUS_ARCHIVAL_RELAYS),
  ]);
  const answers = await requestFromRelays(
    lookupRelays,
    () => ({ kinds: [RELAY_LIST_KIND], authors: [pubkey], limit: 1 }),
    requestOptions(config),
  );
  const newest = newestValid(
    answers.flatMap((answer) => answer.events),
    RELAY_LIST_KIND,
    pubkey,
  );
  const own = config.ownRelayList;

  let found: { read: string[]; write: string[] } | undefined;
  if (newest && (!own || newest.created_at >= own.createdAt)) {
    found = parseRelayListEvent(newest);
  } else if (own && (own.read.length > 0 || own.write.length > 0)) {
    found = {
      read: uniqueRelayUrls(own.read),
      write: uniqueRelayUrls(own.write),
    };
  }

  if (!found && !answers.some((answer) => answer.outcome === "answered")) {
    return { read: [], write: [], relayList: "unknown" };
  }
  if (!found || found.write.length === 0) {
    return {
      read: found?.read ?? [],
      write: uniqueRelayUrls(config.defaultRelays),
      relayList: "missing",
    };
  }
  return { ...found, relayList: "found" };
}

export interface LazarusScanPlan extends LazarusUserRelays {
  relays: string[];
}

export async function getLazarusScanPlan(
  pubkey: string,
  config: LazarusRelayConfig,
): Promise<LazarusScanPlan> {
  const user = await resolveLazarusRelays(pubkey, config);
  return {
    ...user,
    relays: uniqueRelayUrls([
      ...user.write,
      ...user.read,
      ...config.defaultRelays,
      ...(config.archivalRelays ?? LAZARUS_ARCHIVAL_RELAYS),
    ]),
  };
}

// Versions of `kind` from each relay: only valid ones count, as candidates,
// toward responding relays, and for paging.
export async function fetchLazarusVersionsFrom(
  kind: number,
  pubkey: string,
  urls: string[],
  config: LazarusRelayConfig,
  cursors?: Record<string, number>,
): Promise<LazarusRetryResult> {
  const answers = await requestFromRelays(
    urls,
    (url) => {
      const filter: Filter = {
        kinds: [kind],
        authors: [pubkey],
        limit: SCAN_LIMIT,
      };
      return cursors ? { ...filter, until: cursors[url] } : filter;
    },
    requestOptions(config),
  );

  const tagged: LazarusTaggedEvent[] = [];
  const respondingRelays: string[] = [];
  const olderCursors: Record<string, number> = {};
  const outcomes: Record<string, LazarusRelayOutcome> = {};
  for (const { url, events, outcome } of answers) {
    outcomes[url] = outcome;
    const versions = events.filter((event) =>
      isLazarusVersion(event, kind, pubkey),
    );
    if (versions.length > 0) respondingRelays.push(url);
    for (const event of versions) tagged.push({ event, relayUrl: url });
    // A full page may hide older versions. `until` is inclusive, so a cursor
    // that didn't move means the relay has nothing older.
    if (versions.length >= SCAN_LIMIT) {
      const oldest = Math.min(...versions.map((e) => e.created_at));
      if (!cursors || oldest < cursors[url]) olderCursors[url] = oldest;
    }
  }
  return { tagged, respondingRelays, olderCursors, outcomes };
}

const PLAN_TTL_MS = 10 * 60 * 1000;

export function createLazarusRelaySource(
  config: LazarusRelayConfig,
): LazarusRelaySource {
  // Scanning several kinds in a row shouldn't look the relay list up each time.
  const plans = new Map<
    string,
    { plan: Promise<LazarusScanPlan>; at: number }
  >();
  const planFor = (pubkey: string) => {
    const cached = plans.get(pubkey);
    if (cached && Date.now() - cached.at < PLAN_TTL_MS) return cached.plan;
    const plan = getLazarusScanPlan(pubkey, config);
    plans.set(pubkey, { plan, at: Date.now() });
    // A plan built without the user's relay list is never reused.
    plan.then(
      (resolved) => {
        if (resolved.relayList === "unknown") plans.delete(pubkey);
      },
      () => plans.delete(pubkey),
    );
    return plan;
  };

  return {
    async fetchVersions(kind, pubkey, cursors) {
      const plan = cursors ? undefined : await planFor(pubkey);
      const urls = plan ? plan.relays : Object.keys(cursors ?? {});
      const result = await fetchLazarusVersionsFrom(
        kind,
        pubkey,
        urls,
        config,
        cursors,
      );
      return {
        ...result,
        queriedRelays: urls,
        ...(plan && {
          currentConfirmed: plan.write.some(
            (url) => result.outcomes[url] === "answered",
          ),
          relayList: plan.relayList,
          writeRelays: plan.write,
        }),
      };
    },
  };
}

export interface LazarusWriteRelayAnswer extends LazarusReadAnswer {
  url: string;
  outcome: LazarusRelayOutcome;
}

export async function readLazarusCurrent(
  kind: number,
  pubkey: string,
  writeRelays: string[],
  {
    timeoutMs = LAZARUS_REREAD_TIMEOUT_MS,
    concurrency,
    signal,
  }: LazarusRequestOptions = {},
): Promise<LazarusWriteRelayAnswer[]> {
  const answers = await requestFromRelays(
    uniqueRelayUrls(writeRelays),
    () => ({ kinds: [kind], authors: [pubkey], limit: 1 }),
    { timeoutMs, concurrency, signal },
  );
  return answers.map(({ url, events, outcome }) => ({
    url,
    outcome,
    events: events.filter((event) => isLazarusVersion(event, kind, pubkey)),
    answered: outcome === "answered",
  }));
}

export type LazarusPublishStatus =
  "accepted" | "rejected" | "failed" | "timed-out";

export interface LazarusPublishResult {
  url: string;
  status: LazarusPublishStatus;
  message?: string;
}

export function publishToRelay(
  url: string,
  event: Event,
  timeoutMs: number = PUBLISH_TIMEOUT_MS,
): Promise<LazarusPublishResult> {
  return new Promise((resolve) => {
    let socket: LazarusSocket | undefined;
    let done = false;
    const finish = (status: LazarusPublishStatus, message?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      closeSocket(socket);
      resolve({ url, status, message });
    };
    const timer = setTimeout(() => finish("timed-out"), timeoutMs);

    try {
      socket = socketFactory(url);
    } catch (error) {
      return finish("failed", errorMessage(error));
    }
    socket.onopen = () => {
      try {
        socket?.send(JSON.stringify(["EVENT", event]));
      } catch (error) {
        finish("failed", errorMessage(error));
      }
    };
    socket.onmessage = (message) => {
      const data = parseMessage(message.data);
      if (!data || data[0] !== "OK" || data[1] !== event.id) return;
      finish(
        data[2] === true ? "accepted" : "rejected",
        typeof data[3] === "string" && data[3] ? data[3] : undefined,
      );
    };
    socket.onerror = () => finish("failed", "connection error");
    socket.onclose = () => finish("failed", "connection closed");
  });
}

export interface LazarusPublishOutcome {
  accepted: boolean;
  write: LazarusPublishResult[];
  // Best effort; never affects `accepted`.
  extra: Promise<LazarusPublishResult[]>;
}

// Success means at least one write relay accepted. Other relays that answered
// the scan get the restored version too, so they stop serving the clobber,
// but only once the write relays took it.
export async function publishLazarusRecovery(
  event: Event,
  writeRelays: string[],
  extraRelays: string[] = [],
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<LazarusPublishOutcome> {
  const write = uniqueRelayUrls(writeRelays);
  if (write.length === 0) throw new Error("No write relays to publish to");
  const writeResults = await mapWithConcurrency(
    write,
    (url) => publishToRelay(url, event),
    concurrency,
  );
  const accepted = writeResults.some((result) => result.status === "accepted");
  const extra = uniqueRelayUrls(extraRelays).filter(
    (url) => !write.includes(url),
  );
  return {
    accepted,
    write: writeResults,
    extra:
      accepted && extra.length > 0
        ? mapWithConcurrency(
            extra,
            (url) => publishToRelay(url, event),
            concurrency,
          )
        : Promise.resolve([]),
  };
}

export type LazarusRelayLiveness = "live" | "dead" | "timed-out";

export function probeRelay(
  url: string,
  timeoutMs = 5000,
): Promise<LazarusRelayLiveness> {
  return new Promise((resolve) => {
    let socket: LazarusSocket | undefined;
    let done = false;
    const finish = (liveness: LazarusRelayLiveness) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      closeSocket(socket);
      resolve(liveness);
    };
    const timer = setTimeout(() => finish("timed-out"), timeoutMs);
    const normalized = normalizeLazarusRelayUrl(url);
    if (!normalized) return finish("dead");
    try {
      socket = socketFactory(normalized);
    } catch {
      return finish("dead");
    }
    socket.onopen = () => finish("live");
    socket.onerror = () => finish("dead");
    socket.onclose = () => finish("dead");
  });
}

// The newest version of each kind, for a data export.
export async function fetchLatestVersions(
  pubkey: string,
  kinds: number[],
  relays: string[],
  options: LazarusRequestOptions = {},
): Promise<{ events: Event[]; answers: LazarusRelayAnswer[] }> {
  const answers = await requestFromRelays(
    uniqueRelayUrls(relays),
    () => kinds.map((kind) => ({ kinds: [kind], authors: [pubkey], limit: 1 })),
    options,
  );
  const all = answers.flatMap((answer) => answer.events);
  const events = kinds
    .map((kind) => newestValid(all, kind, pubkey))
    .filter((event): event is Event => !!event);
  return { events, answers };
}
