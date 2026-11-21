import { describe, expect, it } from "vitest";
import { buildBlobInventory, shortServerHost } from "@/lib/blossom/inventory";

// Reproduces the mobile Bloom Reaper screenshot: one blob listed by
// blossom.band, blossom.nostr.build, onlydans.blossom.band and six
// per-npub blossom.band subdomains — the shape a real kind 10063 list
// produces. Each copy is a distinct server, but every blossom.band
// subdomain renders under the same folded label.
describe("repro: tile server chips", () => {
  it("renders N identical labels for distinct blossom.band subdomains", () => {
    const servers = [
      "https://blossom.band",
      "https://npub1mq8x5dn2mxpqt9smhv75s37574wmmdeca6j7asth2ahsl4megu9qlln9ze.blossom.band",
      "https://npub1qpyv9x8gf2tvdw0s3jn54khce6mua7lqqqqqqqqqqqqqqqqqqqqqqqqqqqqq.blossom.band",
      "https://npub1qpyv9x8gf2tvdw0s3jn54khce6mua7lrrrrrrrrrrrrrrrrrrrrrrrrrrrrr.blossom.band",
      "https://npub1qpyv9x8gf2tvdw0s3jn54khce6mua7lsssssssssssssssssssssssssssss.blossom.band",
      "https://npub1qpyv9x8gf2tvdw0s3jn54khce6mua7lttttttttttttttttttttttttttttt.blossom.band",
      "https://npub1qpyv9x8gf2tvdw0s3jn54khce6mua7luuuuuuuuuuuuuuuuuuuuuuuuuuuuu.blossom.band",
      "https://blossom.nostr.build",
      "https://onlydans.blossom.band",
    ];
    const hash = "a".repeat(64);
    const listings = new Map(
      servers.map((server) => [
        server,
        [{ url: `${server}/${hash}.png`, sha256: hash, size: 63500 }],
      ]),
    );

    const items = buildBlobInventory(listings, servers, new Map());
    expect(items).toHaveLength(1);
    const item = items[0];

    // The tile shows one chip per copy ("9 servers" badge agrees), and
    // every blossom.band-family chip carries the same folded label.
    const labels = item.copies.map((copy) => shortServerHost(copy.server));
    expect(item.copies).toHaveLength(9);
    expect(labels.filter((label) => label === "blossom.band")).toHaveLength(7);
    expect(new Set(labels).size).toBe(3);
  });
});
