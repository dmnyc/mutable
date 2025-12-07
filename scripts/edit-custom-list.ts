import { SimplePool, nip19, Event, getEventHash, getSignature } from 'nostr-tools';
import NDK, { NDKEvent, NDKNip19Event } from '@nostr-dev-kit/ndk';
import * as fs from 'fs';

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.wine',
  'wss://relay.snort.social',
];

async function editCustomList(neventStr: string, nsec: string, npubsFilePath: string) {
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

    const newEvent: Event = {
      kind: 30000,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        dTag,
        ...allPubkeys.map(pubkey => ["p", pubkey]),
        ...existingEvent.tags.filter(t => t[0] !== 'p' && t[0] !== 'd')
      ],
      content: existingEvent.content,
      pubkey: author.hexpubkey,
      id: '',
      sig: ''
    };

    // 6. Sign and publish
    const { data: nsecData } = nip19.decode(nsec);
    newEvent.id = getEventHash(newEvent);
    newEvent.sig = getSignature(newEvent, nsecData as Uint8Array);

    console.log('Publishing new event:', newEvent);
    await pool.publish(allRelays, newEvent);

    console.log('✅ Successfully updated and published the list!');
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    pool.close(RELAYS);
    ndk.pool.close(RELAYS);
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