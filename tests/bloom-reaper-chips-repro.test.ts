import { describe, expect, it } from "vitest";
import { buildBlobInventory, groupCopiesByLabel } from "@/lib/blossom/inventory";

// The mobile screenshot (IMG_1352): one blob listed by blossom.band,
// blossom.nostr.build, onlydans.blossom.band and six per-npub blossom.band
// subdomains — the shape a real kind 10063 list produces. Each copy is a
// distinct server, but every blossom.band subdomain folds to the same
// label, so the tile must show one chip per distinct label.
describe("repro: tile server chips", () => {
  it("groups folded labels instead of rendering one chip per copy", () => {
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

    // All nine copies stay in the inventory ("9 servers" badge agrees),
    // but the tile renders three chips.
    expect(item.copies).toHaveLength(9);
    const chips = groupCopiesByLabel(item.copies);
    expect(chips.map((chip) => chip.label)).toEqual([
      "blossom.band",
      "blossom.nostr.build",
      "onlydans.blossom.band",
    ]);
    expect(chips[0].copies).toHaveLength(7);
    expect(chips.map((chip) => chip.copies.length)).toEqual([7, 1, 1]);
  });
});
