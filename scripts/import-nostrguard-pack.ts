/**
 * Script to import nostrguard packs and convert them to mutable format
 *
 * Usage: npx tsx scripts/import-nostrguard-pack.ts
 */

import { SimplePool, Event } from 'nostr-tools';
import { finalizeEvent, getPublicKey } from 'nostr-tools';

// Nostrguard uses kind 30001 with these tags:
// - ["d", pack.id] - unique identifier
// - ["title", pack.name] - pack name
// - ["description", ...] - description
// - ["t", tag] - category tags
// - ["p", npub] - pubkeys to mute

// Mutable uses kind 30001 with these tags:
// - ["d", name] - unique identifier (pack name in lowercase-with-hyphens)
// - ["name", name] - display name
// - ["description", ...] - description
// - ["L", "mutable"] - namespace
// - ["l", "community-pack", "mutable"] - category in namespace
// - ["t", category] - category tags
// - ["p", pubkey] - muted pubkeys

const NOSTRGUARD_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
  'wss://relay.nostr.band',
  'wss://nostr.wine'
];

interface NostrguardPack {
  id: string;
  title: string;
  description: string;
  tags: string[];
  npubs: string[];
  author: string;
  createdAt: number;
}

async function fetchNostrguardPacks(limit = 10): Promise<NostrguardPack[]> {
  const pool = new SimplePool();

  console.log('🔍 Searching for nostrguard packs...');
  console.log('Relays:', NOSTRGUARD_RELAYS);

  // Fetch kind 30001 events with "title" tag (nostrguard uses this)
  const filter = {
    kinds: [30001],
    limit
  };

  try {
    const events = await pool.querySync(NOSTRGUARD_RELAYS, filter);
    console.log(`\n📦 Found ${events.length} kind 30001 events`);

    const packs: NostrguardPack[] = [];
    const unknownFormats: any[] = [];

    for (const event of events) {
      const dTag = event.tags.find(tag => tag[0] === 'd')?.[1];
      const titleTag = event.tags.find(tag => tag[0] === 'title')?.[1];
      const nameTag = event.tags.find(tag => tag[0] === 'name')?.[1];
      const descTag = event.tags.find(tag => tag[0] === 'description')?.[1];

      // Collect all unique tag types to understand format
      const tagTypes = [...new Set(event.tags.map(tag => tag[0]))];

      // Only process events with "title" tag (nostrguard format)
      if (titleTag) {
        const categoryTags = event.tags
          .filter(tag => tag[0] === 't')
          .map(tag => tag[1]);

        const npubTags = event.tags
          .filter(tag => tag[0] === 'p')
          .map(tag => tag[1]);

        // Parse content for additional npubs
        let contentNpubs: string[] = [];
        try {
          if (event.content) {
            const parsed = JSON.parse(event.content);
            if (Array.isArray(parsed.npubs)) {
              contentNpubs = parsed.npubs;
            }
          }
        } catch (e) {
          // Content parsing failed, continue with tag npubs only
        }

        const allNpubs = [...npubTags, ...contentNpubs];
        const uniqueNpubs = [...new Set(allNpubs)].filter(Boolean);

        packs.push({
          id: dTag || event.id,
          title: titleTag,
          description: descTag || '',
          tags: categoryTags,
          npubs: uniqueNpubs,
          author: event.pubkey,
          createdAt: event.created_at
        });

        console.log(`\n✅ Found nostrguard pack: "${titleTag}"`);
        console.log(`   ID: ${dTag || event.id}`);
        console.log(`   Author: ${event.pubkey.slice(0, 16)}...`);
        console.log(`   Pubkeys: ${uniqueNpubs.length}`);
        console.log(`   Tags: ${categoryTags.join(', ') || 'none'}`);
        console.log(`   Description: ${descTag?.slice(0, 80)}${(descTag?.length || 0) > 80 ? '...' : ''}`);
      } else {
        // Track unknown formats for analysis
        unknownFormats.push({
          dTag,
          nameTag,
          tagTypes,
          author: event.pubkey.slice(0, 16),
          eventId: event.id.slice(0, 16)
        });
      }
    }

    // Show sample of unknown formats for debugging
    if (unknownFormats.length > 0) {
      console.log(`\n📊 Found ${unknownFormats.length} events with different formats (not nostrguard):`);
      console.log('\nSample of first 5 events:');
      unknownFormats.slice(0, 5).forEach((fmt, i) => {
        console.log(`\n${i + 1}. Event ${fmt.eventId}...`);
        console.log(`   d-tag: ${fmt.dTag || 'none'}`);
        console.log(`   name-tag: ${fmt.nameTag || 'none'}`);
        console.log(`   Tag types: ${fmt.tagTypes.join(', ')}`);
        console.log(`   Author: ${fmt.author}...`);
      });
    }

    pool.close(NOSTRGUARD_RELAYS);
    return packs;

  } catch (error) {
    console.error('❌ Error fetching packs:', error);
    pool.close(NOSTRGUARD_RELAYS);
    return [];
  }
}

async function convertToMutablePack(pack: NostrguardPack): Promise<void> {
  console.log(`\n🔄 Converting "${pack.title}" to mutable format...`);

  // Convert title to mutable pack name (lowercase with hyphens)
  const mutableName = pack.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  console.log(`   Mutable name: ${mutableName}`);

  // Build tags in mutable format
  const tags = [
    ['d', mutableName],
    ['name', pack.title],
    ['description', pack.description],
    ['L', 'mutable'],
    ['l', 'community-pack', 'mutable'],
  ];

  // Add category tags
  pack.tags.forEach(tag => {
    tags.push(['t', tag]);
  });

  // Add muted pubkeys as 'p' tags
  pack.npubs.forEach(npub => {
    tags.push(['p', npub]);
  });

  console.log(`\n📋 Mutable pack details:`);
  console.log(`   Name: ${pack.title}`);
  console.log(`   Identifier: ${mutableName}`);
  console.log(`   Pubkeys to mute: ${pack.npubs.length}`);
  console.log(`   Categories: ${pack.tags.join(', ') || 'none'}`);
  console.log(`   Original author: ${pack.author.slice(0, 16)}...`);
  console.log(`\n⚠️  Note: This pack would need to be republished with YOUR signature`);
  console.log(`   to appear as a mutable community pack.`);
  console.log(`\n📝 Tags that would be used:`);
  console.log(JSON.stringify(tags.slice(0, 10), null, 2));
  if (tags.length > 10) {
    console.log(`   ... and ${tags.length - 10} more tags`);
  }
}

async function main() {
  console.log('🚀 Nostrguard Pack Import Tool\n');
  console.log('This script fetches nostrguard packs and shows how to convert them to mutable format.\n');

  const packs = await fetchNostrguardPacks(20);

  if (packs.length === 0) {
    console.log('\n❌ No nostrguard packs found.');
    console.log('This could mean:');
    console.log('  1. No packs are published yet');
    console.log('  2. The relays don\'t have the events');
    console.log('  3. Nostrguard uses a different event structure');
    return;
  }

  console.log(`\n\n📊 Summary: Found ${packs.length} nostrguard pack(s)\n`);

  // Show conversion for first pack as example
  if (packs.length > 0) {
    console.log('=' .repeat(80));
    console.log('EXAMPLE CONVERSION');
    console.log('=' .repeat(80));
    await convertToMutablePack(packs[0]);
  }

  console.log('\n\n' + '='.repeat(80));
  console.log('COMPATIBILITY NOTES');
  console.log('='.repeat(80));
  console.log(`
Nostrguard vs Mutable format differences:

Nostrguard (kind 30001):
  - ["title", "Pack Name"]          ← Display name
  - ["d", "unique-id"]               ← UUID identifier
  - ["p", "npub..."]                 ← Pubkeys to block

Mutable (kind 30001):
  - ["name", "Pack Name"]            ← Display name
  - ["d", "pack-name"]               ← Lowercase-hyphen identifier
  - ["L", "mutable"]                 ← Namespace marker
  - ["l", "community-pack"]          ← Category marker
  - ["p", "hex-pubkey"]              ← Muted pubkeys

Both are compatible at the data level (same event kind, similar structure),
but need namespace filtering to keep them separate in the UI.

To make them fully compatible:
1. Import nostrguard pack data (pubkeys)
2. Republish under mutable namespace with your signature
3. Or: Modify mutable to support reading both formats
  `);
}

main().catch(console.error);
