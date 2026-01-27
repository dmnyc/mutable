import {
  SimplePool,
  nip19,
  finalizeEvent,
  getPublicKey,
  type Event,
  type EventTemplate,
} from "nostr-tools";
import * as fs from "fs";

const RELAYS = [
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nos.lol",
  "wss://nostr.wine",
  "wss://relay.snort.social",
  "wss://purplepag.es",
  "wss://relay.nostr.net",
];

async function editCustomList(
  neventStr: string,
  nsec: string,
  npubsFilePath: string,
) {
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

    // 3. Get new npubs from file
    const newNpubs = fs
      .readFileSync(npubsFilePath, "utf-8")
      .split("\n")
      .filter((npub) => npub.trim() !== "");
    const newPubkeys = newNpubs.map(
      (npub) => nip19.decode(npub).data as string,
    );

    console.log(`📝 Read ${newNpubs.length} npubs from file`);

    // 4. Merge and deduplicate
    const existingPubkeys = existingEvent.tags
      .filter((t) => t[0] === "p")
      .map((t) => t[1]);
    console.log(`📋 Existing list has ${existingPubkeys.length} pubkeys`);

    const allPubkeys = Array.from(new Set([...existingPubkeys, ...newPubkeys]));
    console.log(
      `✅ Merged list will have ${allPubkeys.length} pubkeys (${allPubkeys.length - existingPubkeys.length} new)`,
    );

    if (allPubkeys.length === existingPubkeys.length) {
      console.log("⚠️  No new pubkeys to add - all were duplicates!");
    }

    // 5. Create a new event
    const dTag = existingEvent.tags.find((t) => t[0] === "d");
    if (!dTag) {
      throw new Error("Could not find d tag in existing event");
    }

    const { data: nsecData } = nip19.decode(nsec);

    // Create event template (unsigned event)
    const eventTemplate: EventTemplate = {
      kind: 30000,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        dTag,
        ...allPubkeys.map((pk) => ["p", pk]),
        ...existingEvent.tags.filter((t) => t[0] !== "p" && t[0] !== "d"),
      ],
      content: existingEvent.content,
    };

    // 6. Sign and publish
    const signedEvent = finalizeEvent(eventTemplate, nsecData as Uint8Array);

    console.log("Publishing new event:", signedEvent);

    const publishPromises = pool.publish(allRelays, signedEvent);
    const results = await Promise.allSettled(publishPromises);

    let successCount = 0;
    let failCount = 0;

    results.forEach((result, i) => {
      if (result.status === "fulfilled") {
        console.log(`✅ ${allRelays[i]}: accepted`);
        successCount++;
      } else {
        console.log(`❌ ${allRelays[i]}: ${result.reason}`);
        failCount++;
      }
    });

    console.log(
      `\n📊 Published to ${successCount}/${allRelays.length} relays (${failCount} failed)`,
    );

    if (successCount === 0) {
      throw new Error(
        "Event was rejected by all relays! Check your nsec and event signature.",
      );
    }

    console.log("✅ Successfully updated and published the list!");
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    pool.close(RELAYS);
  }
}

const neventStr = process.argv[2];
const nsec = process.argv[3];
const npubsFilePath = process.argv[4];

if (!neventStr || !nsec || !npubsFilePath) {
  console.error(
    "Please provide an nevent, nsec, and a file path for the npubs to add.",
  );
  console.error(
    "Usage: ts-node scripts/edit-custom-list.ts <nevent> <nsec> <npubs-file>",
  );
  process.exit(1);
}

editCustomList(neventStr, nsec, npubsFilePath);
