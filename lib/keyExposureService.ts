import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { bech32, bech32m } from "bech32";
import { nip19 } from "nostr-tools";

export const DEFAULT_ESPLORA_ENDPOINT = "https://mempool.space/api";

// ---------- Types ----------

export interface LedgerEntry {
  txid: string;
  txUrl: string;
  confirmed: boolean;
  height: number | null;
  time: number | null;
  deltaSats: number;
  runningSats: number;
}

export interface AddressReport {
  type: string;
  address: string;
  addressUrl: string;
  confirmedSats: number;
  unconfirmedSats: number;
  txCount: number;
  history?: LedgerEntry[];
  error?: string;
}

export interface ExposureReport {
  input: string;
  resolvedVia: string;
  pubkeyHex: string;
  npub: string;
  addresses: AddressReport[];
  totalSats: number;
  source: string;
  fetchedAt: number;
}

interface AddressInfo {
  type: string;
  address: string;
  primary?: boolean;
}

// ---------- Crypto utilities ----------

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function taggedHash(tag: string, msg: Uint8Array): Uint8Array {
  const tagHash = sha256(new TextEncoder().encode(tag));
  const input = new Uint8Array(tagHash.length * 2 + msg.length);
  input.set(tagHash, 0);
  input.set(tagHash, tagHash.length);
  input.set(msg, tagHash.length * 2);
  return sha256(input);
}

function hash160(bytes: Uint8Array): Uint8Array {
  return ripemd160(sha256(bytes));
}

function sha256d(bytes: Uint8Array): Uint8Array {
  return sha256(sha256(bytes));
}

function base58Encode(bytes: Uint8Array): string {
  const ALPHABET =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt("0x" + toHex(bytes));
  const BIGINT_58 = BigInt(58);
  const BIGINT_0 = BigInt(0);
  let s = "";
  while (n > BIGINT_0) {
    const r = Number(n % BIGINT_58);
    n = n / BIGINT_58;
    s = ALPHABET[r] + s;
  }
  let zeros = 0;
  for (const b of bytes) {
    if (b !== 0) break;
    zeros++;
  }
  return "1".repeat(zeros) + s;
}

function base58Check(payload: Uint8Array): string {
  const checksum = sha256d(payload).slice(0, 4);
  const full = new Uint8Array(payload.length + 4);
  full.set(payload);
  full.set(checksum, payload.length);
  return base58Encode(full);
}

// ---------- Address derivation ----------

function p2pkhAddress(h160: Uint8Array): string {
  const payload = new Uint8Array(21);
  payload[0] = 0x00;
  payload.set(h160, 1);
  return base58Check(payload);
}

function p2shAddress(h160: Uint8Array): string {
  const payload = new Uint8Array(21);
  payload[0] = 0x05;
  payload.set(h160, 1);
  return base58Check(payload);
}

function p2wpkhAddress(h160: Uint8Array): string {
  const words = bech32.toWords(h160 as unknown as Buffer);
  return bech32.encode("bc", [0, ...words]);
}

function p2trAddress(xonly: Uint8Array): string {
  const words = bech32m.toWords(xonly as unknown as Buffer);
  return bech32m.encode("bc", [1, ...words]);
}

// BIP341 key-path tweak: Q = P + TapTweak(P) * G
function p2trKeyPath(xonlyHex: string): Uint8Array | null {
  try {
    const xonlyBytes = fromHex(xonlyHex);
    const P = secp256k1.ProjectivePoint.fromHex("02" + xonlyHex);
    const tweak = taggedHash("TapTweak", xonlyBytes);
    const t = BigInt("0x" + toHex(tweak)) % secp256k1.CURVE.n;
    const Q = P.add(secp256k1.ProjectivePoint.BASE.multiply(t));
    return Q.toRawBytes(true).slice(1);
  } catch {
    return null;
  }
}

export function deriveAddresses(xonlyHex: string): AddressInfo[] {
  const xonly = fromHex(xonlyHex);
  const out: AddressInfo[] = [];

  // Hash160-based types: two Y-parity candidates (02 / 03)
  for (const [prefix, tag] of [
    [0x02, "02"],
    [0x03, "03"],
  ] as const) {
    const compressed = new Uint8Array(33);
    compressed[0] = prefix;
    compressed.set(xonly, 1);
    const h160 = hash160(compressed);

    out.push({ type: `P2PKH-${tag}`, address: p2pkhAddress(h160) });
    out.push({ type: `P2WPKH-${tag}`, address: p2wpkhAddress(h160) });

    // P2SH-P2WPKH: hash160 of the redeemScript (OP_0 <20-byte-hash>)
    const redeemScript = new Uint8Array(22);
    redeemScript[0] = 0x00;
    redeemScript[1] = 0x14;
    redeemScript.set(h160, 2);
    out.push({
      type: `P2SH-${tag}`,
      address: p2shAddress(hash160(redeemScript)),
    });
  }

  // Canonical BIP341 Taproot (tweaked output key) — the one real wallets use
  const qx = p2trKeyPath(xonlyHex);
  if (qx) {
    out.push({ type: "P2TR", address: p2trAddress(qx), primary: true });
  }

  // Untweaked P2TR (naive mapping of raw key — usually empty)
  out.push({ type: "P2TR-raw", address: p2trAddress(xonly) });

  return out;
}

// ---------- Identity resolution ----------

export async function resolveIdentity(
  identity: string
): Promise<{ hex: string; resolvedVia: string }> {
  const s = identity.trim();

  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    return { hex: s.toLowerCase(), resolvedVia: "hex" };
  }

  if (s.startsWith("npub1") || s.startsWith("nprofile1")) {
    const decoded = nip19.decode(s);
    if (decoded.type === "npub") {
      return { hex: decoded.data, resolvedVia: "npub" };
    }
    if (decoded.type === "nprofile") {
      return { hex: decoded.data.pubkey, resolvedVia: "nprofile" };
    }
    throw new Error("Unrecognized bech32 type");
  }

  if (s.includes(".")) {
    return resolveNip05(s);
  }

  throw new Error(
    "Unrecognized identity — use npub, nprofile, NIP-05, or 64-char hex"
  );
}

async function resolveNip05(
  identity: string
): Promise<{ hex: string; resolvedVia: string }> {
  const [local, domain] = identity.includes("@")
    ? identity.split("@", 2)
    : ["_", identity];
  const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(local)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NIP-05 fetch failed: ${res.status}`);
  const doc = await res.json();
  const pk = doc?.names?.[local];
  if (!pk) throw new Error(`NIP-05: no entry for '${local}' at ${domain}`);
  return { hex: (pk as string).toLowerCase(), resolvedVia: "nip05" };
}

// ---------- Esplora client ----------

function explorerWebBase(endpoint: string): string {
  return endpoint.replace(/\/api\/?$/, "");
}

async function esploraGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

interface EsploraAddressStats {
  funded_txo_sum: number;
  spent_txo_sum: number;
  tx_count: number;
}

interface EsploraAddress {
  chain_stats: EsploraAddressStats;
  mempool_stats: EsploraAddressStats;
}

async function fetchAddressStats(
  addr: string,
  endpoint: string
): Promise<{ confirmedSats: number; unconfirmedSats: number; txCount: number }> {
  const data = await esploraGet<EsploraAddress>(`${endpoint}/address/${addr}`);
  return {
    confirmedSats:
      data.chain_stats.funded_txo_sum - data.chain_stats.spent_txo_sum,
    unconfirmedSats:
      data.mempool_stats.funded_txo_sum - data.mempool_stats.spent_txo_sum,
    txCount: data.chain_stats.tx_count + data.mempool_stats.tx_count,
  };
}

interface EsploraVout {
  value: number;
  scriptpubkey_address?: string;
}

interface EsploraVin {
  prevout?: { value: number; scriptpubkey_address?: string };
}

interface EsploraTransaction {
  txid: string;
  vout: EsploraVout[];
  vin: EsploraVin[];
  status: { confirmed: boolean; block_height?: number; block_time?: number };
}

function txDelta(tx: EsploraTransaction, addr: string): number {
  const received = tx.vout
    .filter((v) => v.scriptpubkey_address === addr)
    .reduce((s, v) => s + v.value, 0);
  const spent = tx.vin
    .filter((i) => i.prevout?.scriptpubkey_address === addr)
    .reduce((s, i) => s + (i.prevout?.value ?? 0), 0);
  return received - spent;
}

export async function fetchAddressHistory(
  addr: string,
  endpoint = DEFAULT_ESPLORA_ENDPOINT,
  maxTxs = 2000
): Promise<LedgerEntry[]> {
  const web = explorerWebBase(endpoint);

  // Paginated confirmed txs (API returns 25 newest-first per page)
  const confirmed: EsploraTransaction[] = [];
  let lastTxid: string | null = null;
  while (confirmed.length < maxTxs) {
    const url: string = lastTxid
      ? `${endpoint}/address/${addr}/txs/chain/${lastTxid}`
      : `${endpoint}/address/${addr}/txs/chain`;
    const batch: EsploraTransaction[] = await esploraGet<EsploraTransaction[]>(url);
    if (!batch.length) break;
    confirmed.push(...batch);
    lastTxid = batch[batch.length - 1].txid;
    if (batch.length < 25) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  confirmed.reverse(); // oldest → newest

  const mempool = await esploraGet<EsploraTransaction[]>(
    `${endpoint}/address/${addr}/txs/mempool`
  );

  let running = 0;
  return [...confirmed, ...mempool].map((tx) => {
    const delta = txDelta(tx, addr);
    running += delta;
    return {
      txid: tx.txid,
      txUrl: `${web}/tx/${tx.txid}`,
      confirmed: tx.status?.confirmed ?? false,
      height: tx.status?.block_height ?? null,
      time: tx.status?.block_time ?? null,
      deltaSats: delta,
      runningSats: running,
    };
  });
}

// ---------- Main entry point ----------

export async function getExposure(
  identity: string,
  endpoint = DEFAULT_ESPLORA_ENDPOINT,
  onProgress?: (phase: string, current: number, total: number) => void
): Promise<ExposureReport> {
  const { hex: pubkeyHex, resolvedVia } = await resolveIdentity(identity);
  const npub = nip19.npubEncode(pubkeyHex);
  const addresses = deriveAddresses(pubkeyHex);
  const web = explorerWebBase(endpoint);

  const reports: AddressReport[] = [];
  let totalSats = 0;

  for (let i = 0; i < addresses.length; i++) {
    const { type, address } = addresses[i];
    onProgress?.(type, i + 1, addresses.length);

    const addressUrl = `${web}/address/${address}`;
    try {
      const stats = await fetchAddressStats(address, endpoint);
      totalSats += stats.confirmedSats + stats.unconfirmedSats;
      reports.push({ type, address, addressUrl, ...stats });
    } catch (e) {
      reports.push({
        type,
        address,
        addressUrl,
        confirmedSats: 0,
        unconfirmedSats: 0,
        txCount: 0,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Be polite to the public API
    await new Promise((r) => setTimeout(r, 600));
  }

  return {
    input: identity,
    resolvedVia,
    pubkeyHex,
    npub,
    addresses: reports,
    totalSats,
    source: web,
    fetchedAt: Date.now(),
  };
}
