import { SimplePool, nip19 } from "nostr-tools";
import * as fs from "fs";
import * as path from "path";

const RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol",
  "wss://nostr.wine",
  "wss://relay.snort.social",
  "wss://purplepag.es",
  "wss://relay.nostr.net",
];

async function filterNpubs(neventStr: string, npubsFilePath: string) {
  const pool = new SimplePool();

  try {
    // 1. Clean and decode nevent to get event id and relays
    // Remove nostr: prefix if present
    const cleanNevent = neventStr.replace(/^nostr:/, "");
    const decoded = nip19.decode(cleanNevent);

    if (decoded.type !== "nevent") {
      throw new Error("Invalid nevent string");
    }

    const { id, relays: eventRelays } = decoded.data;

    if (!id) {
      throw new Error("Could not find event id in nevent");
    }

    // Deduplicate relays to avoid "duplicate url" error
    const allRelays = Array.from(new Set([...RELAYS, ...(eventRelays || [])]));

    // 2. Fetch the existing list event
    const existingEvent = await pool.get(allRelays, {
      ids: [id],
    });

    if (!existingEvent) {
      throw new Error("Could not find existing list event");
    }

    // 3. Get npubs to filter from file
    const npubsToFilter = fs
      .readFileSync(npubsFilePath, "utf-8")
      .split("\n")
      .filter((npub) => npub.trim() !== "");
    const pubkeysToFilter = npubsToFilter.map(
      (npub) => nip19.decode(npub).data as string,
    );

    // 4. Get existing pubkeys
    const existingPubkeys = existingEvent.tags
      .filter((t) => t[0] === "p")
      .map((t) => t[1]);

    // 5. Filter out duplicates
    const filteredPubkeys = pubkeysToFilter.filter(
      (pubkey) => !existingPubkeys.includes(pubkey),
    );
    const filteredNpubs = filteredPubkeys.map((hex) => nip19.npubEncode(hex));

    // 6. Write to a new file
    const outputDir = path.join(process.cwd(), "output");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }
    const outputFilePath = path.join(
      outputDir,
      `filtered-${path.basename(npubsFilePath)}`,
    );
    fs.writeFileSync(outputFilePath, filteredNpubs.join("\n"));

    console.log(
      `✅ Successfully filtered ${npubsToFilter.length - filteredNpubs.length} duplicate npubs.`,
    );
    console.log(`Filtered list saved to: ${outputFilePath}`);
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    pool.close(RELAYS);
  }
}

const neventStr = process.argv[2];
const npubsFilePath = process.argv[3];

if (!neventStr || !npubsFilePath) {
  console.error(
    "Please provide an nevent and a file path for the npubs to filter.",
  );
  console.error("Usage: ts-node scripts/filter-npubs.ts <nevent> <npubs-file>");
  process.exit(1);
}

filterNpubs(neventStr, npubsFilePath);
