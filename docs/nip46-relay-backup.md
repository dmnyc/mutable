# NIP-46 Relay Backup: Implementation Notes

Reference documentation for the NIP-46-compatible relay backup system.
These patterns will be reused in the plebsvszombies rebuild.

## Problems Solved

### 1. Signer Race Condition

**Problem**: `getSigner()` from Zustand store returns `null` during async operations
because the store state updates asynchronously after NIP-46 connection.

**Solution**: Thread the signer explicitly through the call chain from the React
`useEffect` that has it, rather than re-reading from the store mid-operation.

```
useEffect → loadRelayBackup(signer) → fetchBackupFromRelay(signer)
  → fetchMuteBackupFromRelay(pubkey, relays, signer)
  → fetchAppData(pubkey, relays, dTag, signer)
  → decryptData(ciphertext, pubkey, signer)
```

### 2. NIP-04 Permission Denied by Bunkers

**Problem**: NIP-46 bunkers (e.g., Primal) deny `nip04_decrypt` RPC calls.
Self-encrypted relay storage data couldn't be decrypted.

**Solution**: Add NIP-44 encryption support as the preferred method.
NIP-44 is the modern standard and better supported by NIP-46 bunkers.

- `encryptData()` tries NIP-44 first, falls back to NIP-04
- Published events include an `["enc", "nip44"]` or `["enc", "nip04"]` tag
- `decryptData()` reads the `enc` tag to determine which method to use
- NIP-04 and NIP-44 ciphertext are **incompatible** — cannot cross-decrypt

### 3. NIP-46 Transport Size Limit (65,535 bytes)

**Problem**: NIP-46 RPC messages are encrypted with NIP-44 for transport.
NIP-44 has a plaintext limit of 65,535 bytes. Follow lists with 1000+ pubkeys
exceed this even with gzip compression.

**Solution**: Chunked follow backups — split follow list across multiple NIP-78
events, each containing at most 500 pubkeys.

## Architecture

### Encryption Layer

```
Signer interface (lib/signers/types.ts):
  - nip04Encrypt / nip04Decrypt — required
  - nip44Encrypt / nip44Decrypt — optional (preferred when available)

encryptData(plaintext, pubkey, signer?):
  1. Try signer.nip44Encrypt(pubkey, plaintext)
  2. If unavailable or fails, fall back to signer.nip04Encrypt(pubkey, plaintext)
  3. Return { encrypted, encMethod: "nip44" | "nip04" }

decryptData(ciphertext, pubkey, encTag?, signer?):
  - If encTag === "nip44" → use nip44Decrypt
  - If encTag === "nip04" or no tag → use nip04Decrypt
  - Error messages mention NIP-46 size limits when ciphertext > 60KB
```

### Compression Layer

Uses native browser `CompressionStream` / `DecompressionStream` API with gzip.

```
Marker prefix: "gz:" indicates compressed data
Compression threshold: 1KB (only compress if data exceeds this)

compressData(json) → base64(gzip(json)) → "gz:" + base64
decompressData(data) → if starts with "gz:", decompress; otherwise treat as raw
```

### Chunked Follow Backups

```
Constants:
  FOLLOW_CHUNK_SIZE = 500 pubkeys per chunk
  MAX_FOLLOW_CHUNKS = 20 (supports up to 10,000 follows)

D-tags:
  mutable:follow-backup:0  — chunk 0 (includes totalChunks metadata)
  mutable:follow-backup:1  — chunk 1
  ...
  mutable:follow-backup:N  — chunk N

MuteBackupData fields for chunking:
  totalChunks?: number  — total number of chunks (only in chunk 0)
  chunkIndex?: number   — this chunk's index

Save flow (saveMuteBackupToRelay):
  1. Build base backup data (mute list + notes)
  2. Split followList into chunks of 500
  3. Publish mute backup event (d-tag: mutable:mute-backup)
  4. For each follow chunk, publish separate event:
     - d-tag: mutable:follow-backup:${chunkIndex}
     - Includes followList slice, totalChunks, chunkIndex
  5. All chunks published in parallel

Fetch flow (fetchMuteBackupFromRelay):
  1. Fetch mute backup + follow chunk 0 in parallel
  2. Read totalChunks from chunk 0
  3. If totalChunks > 1, fetch remaining chunks in parallel
  4. Merge all follow lists, deduplicate
  5. Legacy fallback: try old single d-tag "mutable:follow-backup"
```

### Event Structure (NIP-78, kind 30078)

```json
{
  "kind": 30078,
  "tags": [
    ["d", "mutable:follow-backup:0"],
    ["enc", "nip44"]
  ],
  "content": "<encrypted and optionally compressed JSON>",
  "created_at": 1234567890
}
```

## Key Files

| File | Role |
|------|------|
| `lib/signers/types.ts` | Signer interface with optional NIP-44 methods |
| `lib/signers/Nip07Signer.ts` | Browser extension signer (NIP-07) |
| `lib/signers/Nip46Signer.ts` | Remote signer (NIP-46 bunker) |
| `lib/relayStorage.ts` | Core relay storage: encrypt/decrypt, compress, chunk, publish/fetch |
| `lib/backupService.ts` | Backup orchestration, signer passthrough |
| `hooks/useRelaySync.ts` | React hook for sync operations |
| `lib/syncManager.ts` | Parallel sync of all services on app init |

## Gotchas

1. **NIP-04 vs NIP-44 ciphertext is incompatible.** Always store an `enc` tag so
   you know which method to use for decryption. Never try to fallback-decrypt
   with the wrong method.

2. **NIP-46 bunkers may not implement `ping`.** The restore flow catches ping
   failures silently — connectivity is verified on first real operation.

3. **Zustand `getState()` in async chains is unreliable.** Always pass the signer
   from the React component that has it, don't re-read from the store.

4. **CompressionStream is not available in all environments.** The compression
   functions check for API availability and skip compression if unavailable.

5. **Follow chunk cleanup.** When saving fewer chunks than previously existed,
   old higher-numbered chunks remain on relays. This is harmless because
   `totalChunks` in chunk 0 controls how many are fetched.
