import { describe, expect, it } from "vitest";
import type { LookupAddress } from "node:dns";
import {
  fetchPublicImage,
  guardedLookup,
  isFetchableImageUrl,
  isPublicAddress,
} from "@/lib/draftable/safeFetch";

describe("isPublicAddress", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "172.32.0.1", // just past 172.16/12
    "100.63.255.255", // just before carrier-grade NAT
    "100.128.0.1", // just past it
    "198.20.0.1",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "::ffff:8.8.8.8", // mapped public IPv4
    "64:ff9b::808:808", // NAT64 of 8.8.8.8
    "2002:808:808::1", // 6to4 of 8.8.8.8
  ])("allows %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.169.254", // cloud metadata
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "100.64.0.1",
    "100.127.255.255",
    "192.0.0.1",
    "192.0.2.1",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fe80::1",
    "fe80::1%eth0",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1", // the same, written in hex
    "::ffff:10.0.0.1",
    "64:ff9b::7f00:1", // NAT64 of loopback
    "2002:7f00:1::1", // 6to4 of loopback
    "2001::1", // Teredo
    "2001:db8::1", // documentation
    "100::1",
  ])("blocks %s", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it("blocks anything that isn't an address", () => {
    for (const ip of [
      "not-an-ip",
      "300.1.1.1",
      "",
      "1.2.3",
      "1:2:3:4:5:6:7:8:9",
    ]) {
      expect(isPublicAddress(ip)).toBe(false);
    }
  });
});

describe("guardedLookup", () => {
  const answer = (...addresses: LookupAddress[]) =>
    ((
      _host: string,
      _opts: unknown,
      cb: (e: Error | null, a: LookupAddress[]) => void,
    ) => cb(null, addresses)) as unknown as typeof import("node:dns").lookup;
  const run = (lookup: ReturnType<typeof guardedLookup>, all: boolean) =>
    new Promise<{
      error: NodeJS.ErrnoException | null;
      address: unknown;
      family?: number;
    }>((resolve) =>
      lookup("example.test", { all }, (error, address, family) =>
        resolve({ error, address, family }),
      ),
    );

  it("passes a public answer through, in both forms", async () => {
    const lookup = guardedLookup(answer({ address: "8.8.8.8", family: 4 }));
    expect(await run(lookup, false)).toMatchObject({
      error: null,
      address: "8.8.8.8",
      family: 4,
    });
    expect(await run(lookup, true)).toMatchObject({
      error: null,
      address: [{ address: "8.8.8.8", family: 4 }],
    });
  });

  it("refuses a name that resolves to a private address", async () => {
    const lookup = guardedLookup(answer({ address: "127.0.0.1", family: 4 }));
    expect((await run(lookup, false)).error?.code).toBe("EBLOCKED");
    expect((await run(lookup, true)).error?.code).toBe("EBLOCKED");
  });

  it("refuses an answer that mixes public and private addresses", async () => {
    const lookup = guardedLookup(
      answer(
        { address: "8.8.8.8", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ),
    );
    expect((await run(lookup, true)).error?.code).toBe("EBLOCKED");
  });

  it("refuses an empty answer and passes lookup errors along", async () => {
    expect((await run(guardedLookup(answer()), false)).error?.code).toBe(
      "EBLOCKED",
    );
    const failing = guardedLookup(((
      _h: string,
      _o: unknown,
      cb: (e: Error) => void,
    ) =>
      cb(
        Object.assign(new Error("nope"), { code: "ENOTFOUND" }),
      )) as unknown as typeof import("node:dns").lookup);
    expect((await run(failing, false)).error?.code).toBe("ENOTFOUND");
  });
});

describe("isFetchableImageUrl", () => {
  it("accepts https pictures on public-looking hostnames", () => {
    expect(isFetchableImageUrl("https://example.com/a.png")).toBe(true);
    expect(isFetchableImageUrl("https://cdn.example.com:443/a.png")).toBe(true);
  });

  it("rejects everything else", () => {
    for (const url of [
      undefined,
      "",
      "http://example.com/a.png",
      "https://user:pass@example.com/a.png",
      "https://example.com:8443/a.png",
      "https://localhost/a.png",
      "https://printer.local/a.png",
      "https://db.internal/a.png",
      "https://abc.onion/a.png",
      "https://127.0.0.1/a.png",
      "https://2130706433/a.png", // loopback written as one number
      "https://[::1]/a.png",
      "https://intranet/a.png",
      "ftp://example.com/a.png",
      "not a url",
    ]) {
      expect(isFetchableImageUrl(url)).toBe(false);
    }
  });
});

describe("fetchPublicImage", () => {
  it("never connects to a name that resolves to a private address", async () => {
    const lookup = guardedLookup(((
      _h: string,
      _o: unknown,
      cb: (e: null, a: LookupAddress[]) => void,
    ) =>
      cb(null, [
        { address: "127.0.0.1", family: 4 },
      ])) as unknown as typeof import("node:dns").lookup);
    expect(
      await fetchPublicImage("https://looks-public.example.com/a.png", {
        maxBytes: 400_000,
        timeoutMs: 2000,
        lookup,
      }),
    ).toBeNull();
  });

  it("skips URLs that fail the name check without any lookup", async () => {
    let looked = false;
    const lookup = (() => {
      looked = true;
    }) as unknown as ReturnType<typeof guardedLookup>;
    for (const url of [
      "http://example.com/a.png",
      "https://localhost/a.png",
      undefined,
    ]) {
      expect(
        await fetchPublicImage(url, { maxBytes: 1, timeoutMs: 500, lookup }),
      ).toBeNull();
    }
    expect(looked).toBe(false);
  });
});
