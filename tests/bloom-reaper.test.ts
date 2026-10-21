import { describe, expect, it } from "vitest";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
  type Event,
  type EventTemplate,
} from "nostr-tools";
import {
  BLOSSOM_AUTH_KIND,
  buildBlossomAuthTemplate,
  deleteBlob,
  extractBlobHash,
  headBlob,
  listBlobs,
  mapWithConcurrency,
  normalizeBlossomServer,
  probeUrl,
  serverHost,
  signBlossomAuth,
  type FetchLike,
} from "@/lib/blossom/client";
import {
  BLOSSOM_SERVER_LIST_KIND,
  MUTABLE_BLOSSOM_SERVERS,
  fetchBlossomServerList,
  mergeBlossomServers,
  newestReplaceable,
  parseBlossomServerList,
} from "@/lib/blossom/servers";
import {
  extractBlobReferences,
  extractUrls,
  indexBlobReferences,
  referencedServers,
} from "@/lib/blossom/references";
import {
  buildBlobInventory,
  classifyMedia,
  findMissingBlobs,
  formatBytes,
  groupServersByContent,
  removeReapedCopies,
  shortHash,
} from "@/lib/blossom/inventory";
import { BlossomSigningError, scanBlossom } from "@/lib/blossom/scan";

const secretKey = generateSecretKey();
const pubkey = getPublicKey(secretKey);
const signer = {
  signEvent: async (template: EventTemplate) => finalizeEvent(template, secretKey),
};

const SERVER = "https://blossom.example";
const hashOf = (n: number) => n.toString(16).padStart(64, "0");
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function signed(kind: number, content = "", tags: string[][] = [], createdAt = 1000): Event {
  return finalizeEvent({ kind, created_at: createdAt, tags, content }, secretKey);
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function descriptor(n: number, server = SERVER, extra: Record<string, unknown> = {}) {
  return {
    url: `${server}/${hashOf(n)}.png`,
    sha256: hashOf(n),
    size: 100 + n,
    type: "image/png",
    uploaded: 1_700_000_000 + n,
    ...extra,
  };
}

type Call = { url: string; init: RequestInit };

function recordingFetch(handler: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return handler(call, calls.length - 1);
  };
  return { calls, fetch };
}

function decodeAuth(header: string): Event {
  expect(header.startsWith("Nostr ")).toBe(true);
  return JSON.parse(
    decodeURIComponent(escape(atob(header.slice("Nostr ".length)))),
  ) as Event;
}

describe("extractBlobHash", () => {
  it("reads the hash from Blossom URLs with and without an extension", () => {
    expect(extractBlobHash(`${SERVER}/${HASH_A}.png`)).toBe(HASH_A);
    expect(extractBlobHash(`${SERVER}/${HASH_A}`)).toBe(HASH_A);
  });

  it("lowercases and takes the last 64-hex run", () => {
    expect(extractBlobHash(`${SERVER}/${HASH_A.toUpperCase()}.jpg`)).toBe(HASH_A);
    expect(extractBlobHash(`https://cdn.example/${HASH_A}/${HASH_B}.webp`)).toBe(HASH_B);
  });

  it("ignores hex runs that are not exactly 64 characters", () => {
    expect(extractBlobHash(`${SERVER}/${"c".repeat(128)}.png`)).toBeUndefined();
    expect(extractBlobHash(`${SERVER}/${"c".repeat(40)}.png`)).toBeUndefined();
    expect(extractBlobHash("https://i.imgur.com/abc123.png")).toBeUndefined();
  });
});

describe("normalizeBlossomServer", () => {
  it("adds https, lowercases the host and drops trailing slashes", () => {
    expect(normalizeBlossomServer("Blossom.Band/")).toBe("https://blossom.band");
    expect(normalizeBlossomServer("https://nostr.download///")).toBe("https://nostr.download");
    expect(normalizeBlossomServer("  http://localhost:3000/blossom/ ")).toBe(
      "http://localhost:3000/blossom",
    );
  });

  it("rejects empty, non-http and unparsable input", () => {
    expect(normalizeBlossomServer("")).toBeNull();
    expect(normalizeBlossomServer("ftp://files.example")).toBeNull();
    expect(normalizeBlossomServer("wss://relay.example")).toBeNull();
    expect(normalizeBlossomServer("http://")).toBeNull();
  });

  it("gives a host for display", () => {
    expect(serverHost("https://blossom.band")).toBe("blossom.band");
    expect(serverHost("not a url")).toBe("not a url");
  });
});

describe("Blossom auth", () => {
  it("builds a kind 24242 template with verb, expiration and hashes", () => {
    const template = buildBlossomAuthTemplate("delete", {
      hashes: [HASH_A, HASH_B],
      now: 1000,
      ttlSeconds: 60,
    });
    expect(template.kind).toBe(BLOSSOM_AUTH_KIND);
    expect(template.created_at).toBe(1000);
    expect(template.tags).toEqual([
      ["t", "delete"],
      ["expiration", "1060"],
      ["x", HASH_A],
      ["x", HASH_B],
    ]);
    expect(template.content).toBe("Delete blobs");
  });

  it("signs and encodes a header that decodes to a valid event", async () => {
    const header = await signBlossomAuth(signer, "list");
    const event = decodeAuth(header);
    expect(verifyEvent(event)).toBe(true);
    expect(event.pubkey).toBe(pubkey);
    expect(event.tags).toContainEqual(["t", "list"]);
    const expiration = Number(event.tags.find((t) => t[0] === "expiration")?.[1]);
    expect(expiration).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});

describe("listBlobs", () => {
  it("pages with limit and cursor until a short page", async () => {
    const pageOne = Array.from({ length: 100 }, (_, i) => descriptor(i));
    const pageTwo = Array.from({ length: 30 }, (_, i) => descriptor(100 + i));
    const { calls, fetch } = recordingFetch((_, index) =>
      jsonResponse(200, index === 0 ? pageOne : pageTwo),
    );

    const outcome = await listBlobs(SERVER, pubkey, "Nostr abc", { fetch });

    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.blobs).toHaveLength(130);
    expect(calls).toHaveLength(2);
    const first = new URL(calls[0].url);
    expect(first.pathname).toBe(`/list/${pubkey}`);
    expect(first.searchParams.get("limit")).toBe("100");
    expect(first.searchParams.get("cursor")).toBeNull();
    expect(new URL(calls[1].url).searchParams.get("cursor")).toBe(hashOf(99));
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Nostr abc");
  });

  it("stops when a server ignores the cursor and repeats itself", async () => {
    const page = Array.from({ length: 100 }, (_, i) => descriptor(i));
    const { calls, fetch } = recordingFetch(() => jsonResponse(200, page));

    const outcome = await listBlobs(SERVER, pubkey, undefined, { fetch });

    expect(outcome).toMatchObject({ status: "ok" });
    if (outcome.status !== "ok") return;
    expect(outcome.blobs).toHaveLength(100);
    expect(calls).toHaveLength(2);
    expect(calls[0].init.headers).toEqual({});
  });

  it("drops malformed descriptors and fills in a missing url", async () => {
    const { fetch } = recordingFetch(() =>
      jsonResponse(200, [
        descriptor(1),
        { sha256: "nope", url: `${SERVER}/nope` },
        { sha256: HASH_A.toUpperCase(), size: "512" },
        "garbage",
      ]),
    );

    const outcome = await listBlobs(SERVER, pubkey, undefined, { fetch });

    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.blobs).toHaveLength(2);
    expect(outcome.blobs[1]).toEqual({
      url: `${SERVER}/${HASH_A}`,
      sha256: HASH_A,
      size: 512,
      type: undefined,
      uploaded: undefined,
    });
  });

  it("reports unauthorized, unsupported and failed servers", async () => {
    const statusOf = async (response: Response) =>
      listBlobs(SERVER, pubkey, undefined, { fetch: async () => response });

    expect(await statusOf(new Response("", { status: 401 }))).toEqual({
      status: "unauthorized",
      code: 401,
    });
    expect(await statusOf(new Response("", { status: 403 }))).toEqual({
      status: "unauthorized",
      code: 403,
    });
    expect(await statusOf(new Response("", { status: 404 }))).toEqual({
      status: "unsupported",
      code: 404,
    });
    expect(await statusOf(new Response("", { status: 405 }))).toEqual({
      status: "unsupported",
      code: 405,
    });
    expect(
      await statusOf(
        new Response("", { status: 500, headers: { "X-Reason": "db down" } }),
      ),
    ).toEqual({ status: "failed", message: "HTTP 500: db down" });
    expect(await statusOf(new Response("{not json", { status: 200 }))).toEqual({
      status: "failed",
      message: "Malformed response",
    });
    expect(await statusOf(jsonResponse(200, { blobs: [] }))).toEqual({
      status: "failed",
      message: "Malformed response",
    });
  });

  it("reports network errors and timeouts", async () => {
    const network = await listBlobs(SERVER, pubkey, undefined, {
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(network).toEqual({ status: "failed", message: "Network error" });

    const hanging: FetchLike = (_url, init) =>
      new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    const timedOut = await listBlobs(SERVER, pubkey, undefined, {
      fetch: hanging,
      timeoutMs: 10,
    });
    expect(timedOut).toEqual({ status: "failed", message: "Timed out" });
  });
});

describe("deleteBlob", () => {
  it("sends an authorized DELETE to the blob path", async () => {
    const { calls, fetch } = recordingFetch(() => new Response(null, { status: 204 }));

    const outcome = await deleteBlob(SERVER, HASH_A, "Nostr tok", { fetch });

    expect(outcome).toEqual({ status: "deleted" });
    expect(calls[0].url).toBe(`${SERVER}/${HASH_A}`);
    expect(calls[0].init.method).toBe("DELETE");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Nostr tok");
  });

  it("maps the response codes", async () => {
    const outcomeOf = (response: Response) =>
      deleteBlob(SERVER, HASH_A, "Nostr tok", { fetch: async () => response });

    expect(await outcomeOf(new Response("ok", { status: 200 }))).toEqual({ status: "deleted" });
    expect(await outcomeOf(new Response("", { status: 404 }))).toEqual({ status: "missing" });
    expect(await outcomeOf(new Response("", { status: 403 }))).toEqual({
      status: "unauthorized",
      code: 403,
    });
    expect(
      await outcomeOf(
        new Response("", { status: 500, headers: { "X-Reason": "nope" } }),
      ),
    ).toEqual({ status: "failed", message: "HTTP 500: nope" });
    expect(
      await deleteBlob(SERVER, HASH_A, "Nostr tok", {
        fetch: async () => {
          throw new TypeError("offline");
        },
      }),
    ).toEqual({ status: "failed", message: "Network error" });
  });
});

describe("probeUrl and headBlob", () => {
  it("uses HEAD and maps presence", async () => {
    const { calls, fetch } = recordingFetch(() => new Response(null, { status: 200 }));
    expect(await headBlob(SERVER, HASH_A, { fetch })).toBe("present");
    expect(calls[0].url).toBe(`${SERVER}/${HASH_A}`);
    expect(calls[0].init.method).toBe("HEAD");

    expect(
      await probeUrl("https://x/y", { fetch: async () => new Response(null, { status: 404 }) }),
    ).toBe("missing");
    expect(
      await probeUrl("https://x/y", { fetch: async () => new Response(null, { status: 410 }) }),
    ).toBe("missing");
    expect(
      await probeUrl("https://x/y", { fetch: async () => new Response(null, { status: 503 }) }),
    ).toBe("failed");
    expect(
      await probeUrl("https://x/y", {
        fetch: async () => {
          throw new TypeError("offline");
        },
      }),
    ).toBe("failed");
  });
});

describe("mapWithConcurrency", () => {
  it("runs every task, keeps order, and caps parallelism", async () => {
    let running = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return n * 10;
    });
    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });
});

describe("server lists (kind 10063)", () => {
  it("keeps the list order, normalizes and dedupes server tags", () => {
    const event = signed(BLOSSOM_SERVER_LIST_KIND, "", [
      ["server", "https://blossom.band/"],
      ["server", "nostr.download"],
      ["server", "https://Blossom.Band"],
      ["server"],
      ["r", "wss://relay.example"],
      ["server", "wss://not-http.example"],
    ]);
    expect(parseBlossomServerList(event)).toEqual([
      "https://blossom.band",
      "https://nostr.download",
    ]);
    expect(parseBlossomServerList(undefined)).toEqual([]);
  });

  it("picks the newest version, lowest id on a tie", () => {
    const older = signed(BLOSSOM_SERVER_LIST_KIND, "", [["server", "https://old.example"]], 100);
    const newer = signed(BLOSSOM_SERVER_LIST_KIND, "", [["server", "https://new.example"]], 200);
    const otherKind = signed(10002, "", [["r", "wss://relay"]], 300);
    expect(newestReplaceable([older, otherKind, newer], BLOSSOM_SERVER_LIST_KIND, pubkey)).toBe(newer);

    const tieA = signed(BLOSSOM_SERVER_LIST_KIND, "a", [], 500);
    const tieB = signed(BLOSSOM_SERVER_LIST_KIND, "b", [], 500);
    const winner = tieA.id < tieB.id ? tieA : tieB;
    expect(newestReplaceable([tieA, tieB], BLOSSOM_SERVER_LIST_KIND, pubkey)).toBe(winner);
  });

  it("fetches the list through the relay query", async () => {
    const event = signed(BLOSSOM_SERVER_LIST_KIND, "", [["server", "https://mine.example"]]);
    const list = await fetchBlossomServerList(pubkey, async (filter) => {
      expect(filter).toEqual({ kinds: [BLOSSOM_SERVER_LIST_KIND], authors: [pubkey] });
      return [event];
    });
    expect(list.event).toBe(event);
    expect(list.servers).toEqual(["https://mine.example"]);
  });

  it("merges the user's servers first, then Mutable's, then referenced hosts", () => {
    const merged = mergeBlossomServers(
      ["https://mine.example", "https://blossom.band"],
      ["https://cdn.example", "https://mine.example"],
    );
    expect(merged.map((entry) => entry.server)).toEqual([
      "https://mine.example",
      "https://blossom.band",
      ...MUTABLE_BLOSSOM_SERVERS.filter((s) => s !== "https://blossom.band"),
      "https://cdn.example",
    ]);
    expect(merged[0].origins).toEqual(["list", "referenced"]);
    expect(merged[1].origins).toEqual(["list", "mutable"]);
    expect(MUTABLE_BLOSSOM_SERVERS).toContain("https://blossom.nostr.build");
  });
});

describe("blob references", () => {
  it("prefers the imeta hash and keeps one reference per hash per event", () => {
    const url = `${SERVER}/${HASH_A}.png`;
    const event = signed(1, `look ${url}.`, [
      ["imeta", `url ${url}`, `x ${HASH_A.toUpperCase()}`, "m image/png"],
    ]);
    const refs = extractBlobReferences(event);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ hash: HASH_A, url, via: "imeta", kind: 1 });
  });

  it("reads bare URLs from note content and strips trailing punctuation", () => {
    const event = signed(1, `pic: ${SERVER}/${HASH_B}.jpg, and ${SERVER}/${HASH_A}!`);
    const refs = extractBlobReferences(event);
    expect(refs.map((r) => [r.hash, r.url, r.via])).toEqual([
      [HASH_B, `${SERVER}/${HASH_B}.jpg`, "content"],
      [HASH_A, `${SERVER}/${HASH_A}`, "content"],
    ]);
    expect(extractUrls("see https://a.example/x). and https://b.example")).toEqual([
      "https://a.example/x",
      "https://b.example",
    ]);
  });

  it("reads profile picture and banner, ignoring non-hash URLs", () => {
    const profile = signed(
      0,
      JSON.stringify({
        picture: `${SERVER}/${HASH_A}.webp`,
        banner: "https://i.imgur.com/banner.png",
      }),
    );
    expect(extractBlobReferences(profile)).toEqual([
      expect.objectContaining({ hash: HASH_A, via: "picture" }),
    ]);
    expect(extractBlobReferences(signed(0, "not json"))).toEqual([]);
  });

  it("reads NIP-94 x/url tags and pack cover image tags", () => {
    const file = signed(1063, "", [["url", `${SERVER}/${HASH_A}.pdf`], ["x", HASH_A]]);
    expect(extractBlobReferences(file)).toEqual([
      expect.objectContaining({ hash: HASH_A, url: `${SERVER}/${HASH_A}.pdf`, via: "url" }),
    ]);
    const pack = signed(39089, "", [["d", "pack"], ["image", `${SERVER}/${HASH_B}.png`]]);
    expect(extractBlobReferences(pack)).toEqual([
      expect.objectContaining({ hash: HASH_B, via: "image" }),
    ]);
  });

  it("indexes newest-first and lists the hosts posts load from", () => {
    const older = signed(1, `${SERVER}/${HASH_A}.png`, [], 100);
    const newer = signed(1, `https://cdn.example/${HASH_A}.png`, [], 200);
    const index = indexBlobReferences([older, newer, older]);
    expect(index.get(HASH_A)?.map((r) => r.eventId)).toEqual([newer.id, older.id]);
    expect(referencedServers(index)).toEqual(["https://cdn.example", SERVER]);
  });
});

describe("inventory", () => {
  it("groups copies by hash in server order and picks the earliest upload", () => {
    const other = "https://mirror.example";
    const listings = new Map([
      [SERVER, [descriptor(1, SERVER, { uploaded: 500 }), descriptor(2)]],
      [other, [descriptor(1, other, { uploaded: 400, type: undefined })]],
    ]);
    const refs = indexBlobReferences([signed(1, `${SERVER}/${hashOf(2)}.png`)]);

    const items = buildBlobInventory(listings, [SERVER, other], refs);

    expect(items.map((item) => item.hash)).toEqual([hashOf(2), hashOf(1)]);
    const shared = items[1];
    expect(shared.copies.map((copy) => copy.server)).toEqual([SERVER, other]);
    expect(shared.primaryUrl).toBe(`${SERVER}/${hashOf(1)}.png`);
    expect(shared.uploaded).toBe(400);
    expect(shared.media).toBe("image");
    expect(shared.references).toEqual([]);
    expect(items[0].references).toHaveLength(1);
  });

  it("finds referenced hashes no server holds", () => {
    const refs = indexBlobReferences([
      signed(1, `${SERVER}/${HASH_A}.png and ${SERVER}/${HASH_B}.png`),
    ]);
    const items = buildBlobInventory(
      new Map([[SERVER, [{ url: `${SERVER}/${HASH_A}.png`, sha256: HASH_A, size: 1 }]]]),
      [SERVER],
      refs,
    );
    expect(findMissingBlobs(items, refs)).toEqual([
      { hash: HASH_B, url: `${SERVER}/${HASH_B}.png`, references: refs.get(HASH_B) },
    ]);
  });

  it("classifies media and formats sizes and hashes", () => {
    expect(classifyMedia("image/webp")).toBe("image");
    expect(classifyMedia("video/mp4")).toBe("video");
    expect(classifyMedia(undefined, `${SERVER}/${HASH_A}.JPG?x=1`)).toBe("image");
    expect(classifyMedia(undefined, `${SERVER}/${HASH_A}.mov`)).toBe("video");
    expect(classifyMedia("application/pdf", `${SERVER}/${HASH_A}.pdf`)).toBe("other");
    expect(formatBytes(0)).toBe("—");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(20 * 1024 * 1024)).toBe("20 MB");
    expect(shortHash(HASH_A)).toBe("aaaaaaaa…aaaa");
  });

  it("drops reaped copies and items left with none", () => {
    const mirror = "https://mirror.example";
    const items = buildBlobInventory(
      new Map([
        [SERVER, [descriptor(1), descriptor(2)]],
        [mirror, [descriptor(1, mirror)]],
      ]),
      [SERVER, mirror],
      new Map(),
    );
    expect(removeReapedCopies(items, [])).toBe(items);

    const remaining = removeReapedCopies(items, [
      { hash: hashOf(1), server: SERVER },
      { hash: hashOf(2), server: SERVER },
    ]);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].hash).toBe(hashOf(1));
    expect(remaining[0].copies.map((copy) => copy.server)).toEqual([mirror]);
    expect(remaining[0].primaryUrl).toBe(`${mirror}/${hashOf(1)}.png`);
  });

  it("collapses servers with identical file sets into one group", () => {
    const band = "https://blossom.band";
    const subdomain = "https://npub1.example.blossom.band";
    const primal = "https://blossom.primal.net";
    const listings = new Map([
      [band, [descriptor(1, band), descriptor(2, band)]],
      [subdomain, [descriptor(2, subdomain), descriptor(1, subdomain)]],
      [primal, [descriptor(1, primal)]],
      ["https://empty.example", []],
    ]);

    const groups = groupServersByContent(listings, [
      band,
      subdomain,
      primal,
      "https://empty.example",
    ]);

    expect(groups).toEqual([
      { server: band, mirrors: [subdomain], count: 2 },
      { server: primal, mirrors: [], count: 1 },
    ]);
  });

  it("keeps same-count but different-file servers apart", () => {
    const a = "https://a.example";
    const b = "https://b.example";
    const groups = groupServersByContent(
      new Map([
        [a, [descriptor(1, a)]],
        [b, [descriptor(2, b)]],
      ]),
      [a, b],
    );
    expect(groups.map((group) => group.server)).toEqual([a, b]);
    expect(groups.every((group) => group.mirrors.length === 0)).toBe(true);
  });
});

describe("scanBlossom", () => {
  const mine = "https://mine.example";
  const cdn = "https://cdn.example";
  const serverListEvent = signed(BLOSSOM_SERVER_LIST_KIND, "", [["server", `${mine}/`]]);
  const note = signed(1, `old ${cdn}/${HASH_A}.png and ${mine}/${HASH_B}.png`, [], 2000);
  const query = async (filter: { kinds?: number[] }) =>
    filter.kinds?.[0] === BLOSSOM_SERVER_LIST_KIND ? [serverListEvent] : [note];

  function routedFetch() {
    return recordingFetch(({ url }) => {
      if (url.startsWith(`${mine}/list/`)) {
        return jsonResponse(200, [
          { url: `${mine}/${HASH_B}.png`, sha256: HASH_B, size: 10, type: "image/png", uploaded: 1 },
        ]);
      }
      if (url.startsWith(`${SERVER}/list/`)) return new Response("", { status: 401 });
      if (url.startsWith(`${cdn}/list/`)) return new Response("", { status: 404 });
      throw new Error(`unexpected request ${url}`);
    });
  }

  it("signs once, asks every server, and builds the gallery and missing list", async () => {
    const { calls, fetch } = routedFetch();
    const events: string[] = [];

    const scan = await scanBlossom(
      { pubkey, signer, query, request: { fetch }, defaultServers: [SERVER] },
      {
        onSigned: () => events.push("signed"),
        onServers: (servers) => events.push(`servers:${servers.length}`),
        onServerResult: (server, outcome) => events.push(`${serverHost(server)}:${outcome.status}`),
      },
    );

    expect(scan.servers).toEqual([
      { server: mine, origins: ["list", "referenced"] },
      { server: SERVER, origins: ["mutable"] },
      { server: cdn, origins: ["referenced"] },
    ]);
    expect(scan.outcomes.get(mine)?.status).toBe("ok");
    expect(scan.outcomes.get(SERVER)).toEqual({ status: "unauthorized", code: 401 });
    expect(scan.outcomes.get(cdn)).toEqual({ status: "unsupported", code: 404 });
    expect(scan.referenceEventCount).toBe(1);

    expect(scan.items).toHaveLength(1);
    expect(scan.items[0]).toMatchObject({
      hash: HASH_B,
      primaryUrl: `${mine}/${HASH_B}.png`,
      media: "image",
    });
    expect(scan.items[0].references.map((r) => r.eventId)).toEqual([note.id]);
    expect(scan.missing).toEqual([
      { hash: HASH_A, url: `${cdn}/${HASH_A}.png`, references: scan.references.get(HASH_A) },
    ]);

    expect(calls).toHaveLength(3);
    const tokens = new Set(
      calls.map((call) => (call.init.headers as Record<string, string>).Authorization),
    );
    expect(tokens.size).toBe(1);
    const token = decodeAuth(Array.from(tokens)[0]);
    expect(verifyEvent(token)).toBe(true);
    expect(token.pubkey).toBe(pubkey);
    expect(token.tags).toContainEqual(["t", "list"]);

    expect(events[0]).toBe("signed");
    expect(events[1]).toBe("servers:3");
    expect(events.slice(2).sort()).toEqual([
      "blossom.example:unauthorized",
      "cdn.example:unsupported",
      "mine.example:ok",
    ]);
  });

  it("stops before touching the network when signing is declined", async () => {
    const { calls, fetch } = routedFetch();
    let queried = 0;
    await expect(
      scanBlossom({
        pubkey,
        signer: { signEvent: async () => { throw new Error("User rejected"); } },
        query: async (filter) => { queried += 1; return query(filter); },
        request: { fetch },
        defaultServers: [SERVER],
      }),
    ).rejects.toBeInstanceOf(BlossomSigningError);
    expect(queried).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("falls back to the default servers when relays fail", async () => {
    const { calls, fetch } = recordingFetch(() => jsonResponse(200, [descriptor(1)]));
    const scan = await scanBlossom({
      pubkey,
      signer,
      query: async () => { throw new Error("relay down"); },
      request: { fetch },
      defaultServers: [SERVER],
    });
    expect(scan.servers).toEqual([{ server: SERVER, origins: ["mutable"] }]);
    expect(scan.items.map((item) => item.hash)).toEqual([hashOf(1)]);
    expect(scan.missing).toEqual([]);
    expect(scan.referenceEventCount).toBe(0);
    expect(calls).toHaveLength(1);
  });
});
