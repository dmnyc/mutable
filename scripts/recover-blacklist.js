// Blacklist Recovery Script
// Run this in browser console to attempt recovery from relay

async function recoverBlacklist() {
  console.log('🔍 Attempting to recover blacklist from relay...');

  try {
    // Get session
    const storage = localStorage.getItem('mutable-storage');
    if (!storage) {
      console.error('❌ No session found. Please log in first.');
      return;
    }

    const parsed = JSON.parse(storage);
    const session = parsed.state?.session;

    if (!session) {
      console.error('❌ No active session. Please log in first.');
      return;
    }

    console.log('✓ Session found:', session.pubkey);
    console.log('✓ Relays:', session.relays);

    // Current blacklist
    const currentBlacklist = localStorage.getItem('mutable_blacklisted_pubkeys');
    const currentCount = currentBlacklist ? JSON.parse(currentBlacklist).length : 0;
    console.log('📊 Current blacklist count:', currentCount);

    // Fetch from relay
    const { SimplePool } = await import('https://esm.sh/nostr-tools@2.1.4');
    const pool = new SimplePool();

    const filter = {
      kinds: [30078],
      authors: [session.pubkey],
      '#d': ['mutable-blacklist'],
      limit: 1
    };

    console.log('🔄 Fetching from relays...');
    const events = await pool.querySync(session.relays, filter);
    pool.close(session.relays);

    if (events.length === 0) {
      console.log('❌ No blacklist data found on relay');
      return;
    }

    console.log(`✓ Found ${events.length} event(s) on relay`);

    // Get most recent
    const latestEvent = events.sort((a, b) => b.created_at - a.created_at)[0];
    console.log('📅 Latest event timestamp:', new Date(latestEvent.created_at * 1000).toLocaleString());

    // Try to decrypt if encrypted
    let content = latestEvent.content;
    if (content.includes('?iv=')) {
      console.log('🔐 Content is encrypted, attempting to decrypt...');
      if (window.nostr && window.nostr.nip04) {
        content = await window.nostr.nip04.decrypt(session.pubkey, content);
        console.log('✓ Decrypted successfully');
      } else {
        console.error('❌ Cannot decrypt: NIP-04 not available');
        return;
      }
    }

    const data = JSON.parse(content);
    console.log('📊 Relay blacklist count:', data.pubkeys?.length || 0);

    if (data.pubkeys && data.pubkeys.length > currentCount) {
      console.log('');
      console.log('🎉 RECOVERY POSSIBLE!');
      console.log(`Relay has ${data.pubkeys.length} entries vs local ${currentCount}`);
      console.log('');
      console.log('To restore, run:');
      console.log(`localStorage.setItem('mutable_blacklisted_pubkeys', '${JSON.stringify(data.pubkeys)}');`);
      console.log('Then refresh the page.');

      return data.pubkeys;
    } else {
      console.log('❌ Relay data is not newer than local data');
      console.log('Data may be permanently lost');
    }

  } catch (error) {
    console.error('❌ Error during recovery:', error);
  }
}

console.log('Recovery script loaded. Run: recoverBlacklist()');
