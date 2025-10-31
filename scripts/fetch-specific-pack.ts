/**
 * Fetch a specific nostrguard pack by ID
 */

import { SimplePool } from 'nostr-tools';

const RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.wine',
  'wss://relay.snort.social',
  'wss://relay.nostr.wirednet.jp'
];

const PACK_ID = '2c33075d-7967-425f-aca7-a5d7ae4c2fbc';

async function fetchPack() {
  const pool = new SimplePool();

  console.log(`🔍 Searching for pack: ${PACK_ID}\n`);
  console.log('Relays:', RELAYS, '\n');

  try {
    // Try filtering by d-tag
    console.log('Trying filter with d-tag...');
    const filter = {
      kinds: [30001],
      '#d': [PACK_ID],
      limit: 10
    };

    const events = await pool.querySync(RELAYS, filter);
    console.log(`Found ${events.length} events with d-tag filter\n`);

    if (events.length > 0) {
      events.forEach((event, i) => {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`EVENT ${i + 1}`);
        console.log('='.repeat(80));
        console.log('ID:', event.id);
        console.log('Pubkey:', event.pubkey);
        console.log('Created:', new Date(event.created_at * 1000).toISOString());
        console.log('\nTags:');

        const dTag = event.tags.find(t => t[0] === 'd')?.[1];
        const titleTag = event.tags.find(t => t[0] === 'title')?.[1];
        const nameTag = event.tags.find(t => t[0] === 'name')?.[1];
        const descTag = event.tags.find(t => t[0] === 'description')?.[1];
        const pTags = event.tags.filter(t => t[0] === 'p');
        const tTags = event.tags.filter(t => t[0] === 't');

        console.log('  d-tag:', dTag || 'none');
        console.log('  title:', titleTag || 'none');
        console.log('  name:', nameTag || 'none');
        console.log('  description:', descTag || 'none');
        console.log('  p-tags (pubkeys):', pTags.length);
        console.log('  t-tags (categories):', tTags.map(t => t[1]).join(', ') || 'none');

        console.log('\nAll tags:');
        event.tags.forEach(tag => {
          console.log('  ', JSON.stringify(tag));
        });

        console.log('\nContent:');
        if (event.content) {
          try {
            const parsed = JSON.parse(event.content);
            console.log('  (JSON):', JSON.stringify(parsed, null, 4));
          } catch {
            console.log('  (text):', event.content.slice(0, 200));
          }
        } else {
          console.log('  (empty)');
        }

        if (pTags.length > 0) {
          console.log('\nFirst 5 pubkeys:');
          pTags.slice(0, 5).forEach((tag, i) => {
            console.log(`  ${i + 1}. ${tag[1]}`);
          });
          if (pTags.length > 5) {
            console.log(`  ... and ${pTags.length - 5} more`);
          }
        }
      });
    } else {
      console.log('❌ Pack not found with d-tag filter');
      console.log('\nTrying broader search for ANY kind 30001 events...\n');

      const broadFilter = {
        kinds: [30001],
        limit: 100
      };

      const allEvents = await pool.querySync(RELAYS, broadFilter);
      console.log(`Found ${allEvents.length} total kind 30001 events`);

      // Search for the ID in any field
      const matches = allEvents.filter(e =>
        e.id === PACK_ID ||
        e.tags.some(t => t.includes(PACK_ID))
      );

      if (matches.length > 0) {
        console.log(`Found ${matches.length} events containing the ID!`);
        matches.forEach(e => {
          console.log('\nEvent:', e.id);
          console.log('Tags:', e.tags);
        });
      } else {
        console.log('No events found containing this ID anywhere');
      }
    }

    pool.close(RELAYS);

  } catch (error) {
    console.error('❌ Error:', error);
    pool.close(RELAYS);
  }
}

fetchPack();
