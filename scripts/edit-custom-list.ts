import { SimplePool, nip19 } from 'nostr-tools';

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.wine',
  'wss://relay.snort.social',
];

async function editCustomList(nevent: string) {
  const pool = new SimplePool();
  
  try {
    const { type, data } = nip19.decode(nevent);

    if (type !== 'nevent') {
      console.error('❌ Invalid nevent');
      return;
    }

    const { id, relays } = data;
    const allRelays = [...RELAYS, ...(relays || [])];

    console.log(`🔍 Searching for event: ${id}\n`);
    console.log('Relays:', allRelays, '\n');
    
    const filter = {
      ids: [id],
    };

    const event = await pool.get(allRelays, filter);

    if (event) {
      console.log('✅ Found event\n');
      console.log(JSON.stringify(event, null, 2));
    } else {
      console.log('❌ Event not found');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    pool.close(RELAYS);
  }
}

const nevent = process.argv[2];

if (!nevent) {
  console.error('Please provide an nevent as a command-line argument.');
  process.exit(1);
}

editCustomList(nevent);
