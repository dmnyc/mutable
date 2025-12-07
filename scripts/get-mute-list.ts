
import { SimplePool, nip19 } from 'nostr-tools';
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

type OutputFormat = 'json' | 'text';

async function getMuteList(npub: string, outputFormat: OutputFormat) {
  const pool = new SimplePool();
  let pubkey: string;

  try {
    pubkey = nip19.decode(npub).data as string;
  } catch (error) {
    console.error('❌ Invalid npub');
    return;
  }

  console.log(`🔍 Searching for mute list for npub: ${npub}\n`);
  console.log('Hex pubkey:', pubkey, '\n');
  console.log('Relays:', RELAYS, '\n');

  try {
    const filter = {
      kinds: [10000],
      authors: [pubkey],
      limit: 1
    };

    const event = await pool.get(RELAYS, filter);

    if (event) {
      console.log('✅ Found mute list event\n');
      console.log('Event ID:', event.id);
      console.log('Created:', new Date(event.created_at * 1000).toISOString());
      
      const mutedPubkeys = event.tags.filter(t => t[0] === 'p').map(t => t[1]);

      if (mutedPubkeys.length > 0) {
        const mutedNpubs = mutedPubkeys.map(hex => nip19.npubEncode(hex));
        
        let outputContent: string;
        let fileExtension: string;

        if (outputFormat === 'json') {
          outputContent = JSON.stringify(mutedNpubs, null, 2);
          fileExtension = 'json';
        } else {
          outputContent = mutedNpubs.join('\n');
          fileExtension = 'txt';
        }

        const outputDir = path.join(process.cwd(), 'output');
        if (!fs.existsSync(outputDir)){
            fs.mkdirSync(outputDir);
        }
        const filePath = path.join(outputDir, `${npub}-mutes.${fileExtension}`);
        
        fs.writeFileSync(filePath, outputContent);
        console.log(`\n✅ Successfully wrote ${mutedNpubs.length} muted npubs to ${filePath}`);

      } else {
        console.log('No muted pubkeys found in the event.');
      }
    } else {
      console.log('❌ Mute list not found');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    pool.close(RELAYS);
  }
}

const npub = process.argv[2];
const format = (process.argv[3] || 'text') as OutputFormat;


if (!npub) {
  console.error('Please provide an npub as a command-line argument.');
  console.error('Usage: ts-node scripts/get-mute-list.ts <npub> [json|text]');
  process.exit(1);
}

if (format !== 'json' && format !== 'text') {
    console.error('Invalid output format. Please use "json" or "text".');
    process.exit(1);
}

getMuteList(npub, format);
