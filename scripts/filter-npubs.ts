import { SimplePool, nip19 } from 'nostr-tools';
import { bech32 } from 'bech32';
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

function parseTLV(data: Buffer) {
    const result: { type: number; length: number; value: Buffer }[] = [];
    let T = 0, L = 1, V = 2;
    let p = 0;
    while (p < data.length) {
        const t = data[p];
        const l = data[p + 1];
        const v = data.slice(p + 2, p + 2 + l);
        result.push({ type: t, length: l, value: v });
        p += 2 + l;
    }
    return result;
}


async function filterNpubs(neventStr: string, npubsFilePath: string) {
  const pool = new SimplePool();

  try {
    // 1. Decode nevent to get event id and author pubkey
    const { prefix, words } = bech32.decode(neventStr);
    const data = Buffer.from(bech32.fromWords(words));
    const tlv = parseTLV(data);

    const id = tlv.find(e => e.type === 0)?.value.toString('hex');
    const relays = tlv.filter(e => e.type === 1).map(e => e.value.toString('utf-8'));
    
    if (!id) {
        throw new Error('Could not find event id in nevent');
    }

    const allRelays = [...RELAYS, ...relays];
    
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
