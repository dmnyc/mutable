#!/usr/bin/env node
// Offline nsec → WIF (compressed, mainnet) converter.
// Usage: node scripts/nsec-to-wif.mjs
// Reads the nsec from stdin so it never appears in shell history or argv.

import { nip19 } from 'nostr-tools';
import { base58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha256';
import readline from 'node:readline';
import { Writable } from 'node:stream';

const muted = new Writable({ write(_c, _e, cb) { cb(); } });
const rl = readline.createInterface({ input: process.stdin, output: muted, terminal: true });

process.stdout.write('Paste your nsec (input is hidden), then press Enter: ');

rl.question('', (answer) => {
  rl.close();
  process.stdout.write('\n');

  const nsec = answer.trim();
  if (!nsec.startsWith('nsec1')) {
    console.error('Error: input does not look like an nsec (must start with nsec1).');
    process.exit(1);
  }

  let privHex;
  try {
    const decoded = nip19.decode(nsec);
    if (decoded.type !== 'nsec') throw new Error('not an nsec');
    privHex = decoded.data instanceof Uint8Array
      ? Buffer.from(decoded.data).toString('hex')
      : decoded.data;
  } catch (e) {
    console.error('Error: failed to decode nsec:', e.message);
    process.exit(1);
  }

  const privBytes = Buffer.from(privHex, 'hex');
  if (privBytes.length !== 32) {
    console.error('Error: decoded key is not 32 bytes.');
    process.exit(1);
  }

  // Mainnet WIF, compressed: 0x80 || 32-byte key || 0x01, then base58check.
  const payload = Buffer.concat([Buffer.from([0x80]), privBytes, Buffer.from([0x01])]);
  const wif = base58check(sha256).encode(payload);

  console.log('WIF (compressed, mainnet):');
  console.log(wif);
  console.log('\nImport this in Sparrow: File → New Wallet → Taproot (P2TR) → New or Imported Software Wallet → Master Private Key (WIF).');
  console.log('Verify the derived address matches what Muggable showed before sweeping.');
});
