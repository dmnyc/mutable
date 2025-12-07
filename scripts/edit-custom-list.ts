import { SimplePool, nip19, Event, getEventHash, getSignature, getPublicKey } from 'nostr-tools';
import { bech32 } from 'bech32';
import * as fs from 'fs';

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

async function editCustomList(neventStr: string, nsec: string, npubsFilePath: string) {
  const pool = new SimplePool();

  try {
    // 1. Decode nevent to get event id
    const { words } = bech32.decode(neventStr);
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

    // 3. Get new npubs from file
    const newNpubs = fs.readFileSync(npubsFilePath, 'utf-8').split('\n').filter(npub => npub.trim() !== '');
    const newPubkeys = newNpubs.map(npub => nip19.decode(npub).data as string);

    // 4. Merge and deduplicate
    const existingPubkeys = existingEvent.tags.filter(t => t[0] === 'p').map(t => t[1]);
    const allPubkeys = [...new Set([...existingPubkeys, ...newPubkeys])];

    // 5. Create a new event
    const dTag = existingEvent.tags.find(t => t[0] === 'd');
    if (!dTag) {
        throw new Error('Could not find d tag in existing event');
    }

    const { data: nsecData } = nip19.decode(nsec);
    const pubkey = getPublicKey(nsecData as Uint8Array);

    const newEvent: Event = {
      kind: 30000,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        dTag,
        ...allPubkeys.map(pubkey => ["p", pubkey]),
        ...existingEvent.tags.filter(t => t[0] !== 'p' && t[0] !== 'd')
      ],
      content: existingEvent.content,
      pubkey,
      id: '',
      sig: ''
    };

    // 6. Sign and publish
    newEvent.id = getEventHash(newEvent);
    newEvent.sig = getSignature(newEvent, nsecData as Uint8Array);

    console.log('Publishing new event:', newEvent);
    await pool.publish(allRelays, newEvent);

    console.log('✅ Successfully updated and published the list!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    pool.close(RELAYS);
  }
}

const neventStr = process.argv[2];
const nsec = process.argv[3];
const npubsFilePath = process.argv[4];

if (!neventStr || !nsec || !npubsFilePath) {
  console.error('Please provide an nevent, nsec, and a file path for the npubs to add.');
  console.error('Usage: ts-node scripts/edit-custom-list.ts <nevent> <nsec> <npubs-file>');
  process.exit(1);
}

editCustomList(neventStr, nsec, npubsFilePath);