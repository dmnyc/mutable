import { describe, expect, it } from "vitest";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
  type Event,
  type EventTemplate,
  type Filter,
} from "nostr-tools";
import {
  BLOSSOM_AUTH_KIND,
  buildBlossomAuthTemplate,
  deleteBlob,
  extractBlobHash,
  headBlob,
  listBlobs,
  mapWithConcurrency,
  mirrorBlob,
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
  fetchReferenceEventsPaged,
  indexBlobReferences,
  REFERENCE_KINDS,
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
  shortServerHost,
  type BlobItem,
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

  it("settles a timed-out delete with a presence check", async () => {
    const seen: string[] = [];
    const cacheModes: (string | undefined)[] = [];
    const hanging: FetchLike = (url, init) => {
      seen.push(`${init.method} ${url}`);
      cacheModes.push(init.cache);
      if (init.method === "DELETE") {
        return new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    };

    const outcome = await deleteBlob(SERVER, HASH_A, "Nostr tok", {
      fetch: hanging,
      timeoutMs: 10,
    });

    expect(outcome).toEqual({ status: "missing" });
    expect(seen[1]).toBe(`HEAD ${SERVER}/${HASH_A}`);
    // The gallery renders blob URLs as <img>; the check must not read that
    // cached pre-delete 200 back as "still there".
    expect(cacheModes[1]).toBe("no-store");
  });

  it("reports a timed-out delete as still there when the blob survives", async () => {
    const aborting: FetchLike = (_url, init) =>
      new Promise((_, reject) => {
        init.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    const stillThere: FetchLike = (url, init) =>
      init.method === "DELETE"
        ? aborting(url, init)
        : Promise.resolve(new Response(null, { status: 200 }));

    expect(
      await deleteBlob(SERVER, HASH_A, "Nostr tok", {
        fetch: stillThere,
        timeoutMs: 10,
      }),
    ).toEqual({ status: "failed", message: "Timed out — file still there" });
  });
});

describe("mirrorBlob", () => {
  it("sends an authorized PUT with the source URL to /mirror", async () => {
    const { calls, fetch } = recordingFetch(() =>
      new Response(JSON.stringify({ sha256: HASH_A }), { status: 201 }),
    );

    const outcome = await mirrorBlob(SERVER, "https://old.host/pic.jpg", HASH_A, "Nostr tok", { fetch });

    expect(outcome).toEqual({ status: "ok", existed: false });
    expect(calls[0].url).toBe(`${SERVER}/mirror`);
    expect(calls[0].init.method).toBe("PUT");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Nostr tok");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ url: "https://old.host/pic.jpg" });
  });

  it("maps the response codes", async () => {
    const outcomeOf = (response: Response) =>
      mirrorBlob(SERVER, "https://old.host/pic.jpg", HASH_A, "Nostr tok", {
        fetch: async () => response,
      });

    expect(await outcomeOf(new Response("{}", { status: 200 }))).toEqual({
      status: "ok",
      existed: true,
    });
    expect(await outcomeOf(new Response("", { status: 403 }))).toEqual({
      status: "unauthorized",
      code: 403,
    });
    expect(
      await outcomeOf(
        new Response("", { status: 502, headers: { "X-Reason": "origin unreachable" } }),
      ),
    ).toEqual({ status: "failed", message: "HTTP 502: origin unreachable" });
    expect(
      await mirrorBlob(SERVER, "https://old.host/pic.jpg", HASH_A, "Nostr tok", {
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
  const query = async (filter: { kinds?: number[] }) => {
    // Yield a macrotask like real relay I/O, so listing responses can land
    // between reference slices instead of the walk finishing instantly.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return filter.kinds?.[0] === BLOSSOM_SERVER_LIST_KIND ? [serverListEvent] : [note];
  };

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
    const listingsDoneItems: BlobItem[][] = [];
    const partialItems: BlobItem[][] = [];

    const scan = await scanBlossom(
      { pubkey, signer, query, request: { fetch }, defaultServers: [SERVER] },
      {
        onSigned: () => events.push("signed"),
        onServers: (servers) => events.push(`servers:${servers.length}`),
        onServerResult: (server, outcome) => events.push(`${serverHost(server)}:${outcome.status}`),
        onListingsDone: ({ items }) => listingsDoneItems.push(items),
        onReferencesPartial: ({ items }) => partialItems.push(items),
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
    expect(scan.referenceOldest).toBe(2000);

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
    // Two phases: the kind 10063 list lands before the reference walk, and
    // the post-referenced host joins with the second onServers call.
    expect(events[1]).toBe("servers:2");
    expect(events.slice(2, 4).sort()).toEqual([
      "blossom.example:unauthorized",
      "mine.example:ok",
    ]);
    expect(events[4]).toBe("servers:3");
    expect(events[5]).toBe("cdn.example:unsupported");

    // The gallery renders from listings alone first (links pending), then
    // refines as reference slices are indexed. Slices can land before the
    // (instant, mocked) listings do, so assert that refinement happens
    // rather than depending on call order.
    expect(listingsDoneItems).toHaveLength(1);
    expect(listingsDoneItems[0]).toHaveLength(1);
    expect(listingsDoneItems[0][0].references).toEqual([]);
    const refined = partialItems.find(
      (items) => items.length > 0 && items[0].references.length > 0,
    );
    expect(refined?.[0].references.map((r) => r.eventId)).toEqual([note.id]);
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

describe("fetchReferenceEventsPaged", () => {
  const eventAt = (createdAt: number, salt = ""): Event =>
    finalizeEvent({ kind: 1, created_at: createdAt, tags: [], content: salt }, secretKey);

  it("queries fixed windows newest-first and dedupes slice results", async () => {
    const seen: Filter[] = [];
    let events: Event[] = [];
    const scan = await fetchReferenceEventsPaged(pubkey, async (filter) => {
      seen.push(filter);
      if (seen.length === 1) {
        // Anchor the fixtures to whatever window the implementation
        // actually opened, so the test never races a second boundary.
        const until = filter.until as number;
        events = [
          eventAt(until - 1),
          eventAt(until - 51),
          eventAt(until - 150),
          eventAt(until - 250),
        ];
      }
      return events.filter(
        (event) =>
          event.created_at >= (filter.since as number) &&
          event.created_at <= (filter.until as number),
      );
    }, { pageSize: 2, sliceSeconds: 100, maxPages: 10 });

    const until0 = seen[0].until as number;
    expect(seen[0].since).toBe(until0 - 100);
    expect(seen[1].until).toBe(until0 - 100);
    expect(seen[1].since).toBe(until0 - 200);
    // Three empty windows in a row stop the walk.
    expect(seen).toHaveLength(6);
    expect(scan.pages).toBe(6);
    expect(scan.events.map((event) => event.created_at).sort((a, b) => b - a)).toEqual([
      until0 - 1,
      until0 - 51,
      until0 - 150,
      until0 - 250,
    ]);
    expect(scan.oldestCreated).toBe(until0 - 250);
  });

  it("stops once a slice starts before the oldest upload", async () => {
    const seen: Filter[] = [];
    const now = Math.floor(Date.now() / 1000);
    const scan = await fetchReferenceEventsPaged(pubkey, async (filter) => {
      seen.push(filter);
      return [eventAt(filter.until as number)];
    }, { pageSize: 2, sliceSeconds: 100, maxPages: 10, before: now - 160 });

    // Slice 1 covers [now-99, now+1]; slice 2 starts at now-199, below the
    // floor, so the walk ends there.
    expect(seen).toHaveLength(2);
    expect(scan.oldestCreated).toBe(seen[1].until);
  });

  it("respects the page cap even when every slice brings something new", async () => {
    let page = 0;
    const scan = await fetchReferenceEventsPaged(
      pubkey,
      async () => [eventAt(500, `slice-${page++}`)],
      {
        pageSize: 2,
        sliceSeconds: 100,
        maxPages: 3,
      },
    );
    expect(scan.pages).toBe(3);
    expect(scan.events).toHaveLength(3);
  });
});

describe("reference states", () => {
  it("splits linked, no-link-found and not-scanned by the scan window", () => {
    const refs = indexBlobReferences([signed(1, `${SERVER}/${hashOf(2)}.png`, [], 100)]);
    const listings = new Map([
      [SERVER, [
        { url: `${SERVER}/${hashOf(1)}.png`, sha256: hashOf(1), size: 1, uploaded: 50 },
        { url: `${SERVER}/${hashOf(2)}.png`, sha256: hashOf(2), size: 1, uploaded: 150 },
        { url: `${SERVER}/${hashOf(3)}.png`, sha256: hashOf(3), size: 1, uploaded: 150 },
        { url: `${SERVER}/${hashOf(4)}.png`, sha256: hashOf(4), size: 1 },
      ]],
    ]);

    const items = buildBlobInventory(listings, [SERVER], refs, 100);
    const stateOf = (n: number) =>
      items.find((item) => item.hash === hashOf(n))?.referenceState;
    expect(stateOf(1)).toBe("unscanned");
    expect(stateOf(2)).toBe("linked");
    expect(stateOf(3)).toBe("unlinked");
    expect(stateOf(4)).toBe("unscanned");

    // Without a covered window nothing can be called orphaned.
    const noWindow = buildBlobInventory(listings, [SERVER], refs);
    expect(noWindow.find((item) => item.hash === hashOf(3))?.referenceState).toBe("unscanned");
  });

  it("recomputes the state when a mirror reveals an earlier upload", () => {
    const mirror = "https://mirror.example";
    const listings = new Map([
      [SERVER, [{ url: `${SERVER}/${hashOf(3)}.png`, sha256: hashOf(3), size: 1, uploaded: 150 }]],
      [mirror, [{ url: `${mirror}/${hashOf(3)}.png`, sha256: hashOf(3), size: 1, uploaded: 90 }]],
    ]);
    const items = buildBlobInventory(listings, [SERVER, mirror], new Map(), 100);
    expect(items[0].uploaded).toBe(90);
    expect(items[0].referenceState).toBe("unscanned");
  });
});

describe("shortServerHost", () => {
  it("folds per-npub subdomains into their base host", () => {
    expect(
      shortServerHost(
        "https://npub1mq8x5dn2mxpqt9smhv75s37574wmmdeca6j7asth2ahsl4megu9qlln9ze.blossom.band",
      ),
    ).toBe("blossom.band");
    expect(shortServerHost("https://blossom.band")).toBe("blossom.band");
    expect(shortServerHost("https://onlydans.blossom.band")).toBe("onlydans.blossom.band");
    expect(shortServerHost("https://blossom.primal.net")).toBe("blossom.primal.net");
  });
});

describe("hexToNevent", () => {
  it("encodes an event id (with kind) that decodes back", async () => {
    const { hexToNevent } = await import("@/lib/nostr");
    const { nip19 } = await import("nostr-tools");
    const id = "0".repeat(63) + "a";

    const nevent = hexToNevent(id);
    expect(nevent.startsWith("nevent1")).toBe(true);
    expect((nip19.decode(nevent).data as { id: string }).id).toBe(id);

    const withKind = hexToNevent(id, 20);
    const decoded = nip19.decode(withKind).data as { id: string; kind?: number };
    expect(decoded.id).toBe(id);
    expect(decoded.kind).toBe(20);
  });
});
