import { SimplePool, nip19 } from 'nostr-tools';
import NDK, { NDKNip19Event } from '@nostr-dev-kit/ndk';
import * as fs from 'fs';
import * as path from 'path';

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.wine',
  'wss://relay.snort.social',
];

async function filterNpubs(neventStr: string, npubsFilePath: string) {
  const ndk = new NDK({ explicitRelayUrls: RELAYS });
  await ndk.connect();

  const pool = new SimplePool();

  try {
    // 1. Decode nevent to get event id and author pubkey
    const nevent = new NDKNip19Event(ndk, neventStr);
    const { id, author, relays } = nevent;

    if (!author) {
      throw new Error('Could not find author in nevent');
    }

    const allRelays = [...RELAYS, ...(relays.map(r => r.url) || [])];
    
    // 2. Fetch the existing list event
    const existingEvent = await pool.get(allRelays, {
        ids: [id],
    });

    if (!existingEvent) {
      throw new Error('Could not find existing list event');
    }

    // 3. Get npubs to filter from file
    const npubsToFilter = fs.readFileSync(npubsFilePath, 'utf-8').split('\n').filter(npub => npub.trim() !== '');
    const pubkeysToFilter = npubsToFilter.map(npub => nip19.decode(npub).data as string);

    // 4. Get existing pubkeys
    const existingPubkeys = existingEvent.tags.filter(t => t[0] === 'p').map(t => t[1]);

    // 5. Filter out duplicates
    const filteredPubkeys = pubkeysToFilter.filter(pubkey => !existingPubkeys.includes(pubkey));
    const filteredNpubs = filteredPubkeys.map(hex => nip19.npubEncode(hex));

    // 6. Write to a new file
    const outputDir = path.join(process.cwd(), 'output');
    if (!fs.existsSync(outputDir)){
        fs.mkdirSync(outputDir);
    }
    const outputFilePath = path.join(outputDir, `filtered-${path.basename(npubsFilePath)}`);
    fs.writeFileSync(outputFilePath, filteredNpubs.join('\n'));

    console.log(`✅ Successfully filtered ${npubsToFilter.length - filteredNpubs.length} duplicate npubs.`);
    console.log(`Filtered list saved to: ${outputFilePath}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    pool.close(RELAYS);
    ndk.pool.close(RELAYS);
  }
}

const neventStr = process.argv[2];
const npubsFilePath = process.argv[3];

if (!neventStr || !npubsFilePath) {
  console.error('Please provide an nevent and a file path for the npubs to filter.');
  console.error('Usage: ts-node scripts/filter-npubs.ts <nevent> <npubs-file>');
  process.exit(1);
}

filterNpubs(neventStr, npubsFilePath);
