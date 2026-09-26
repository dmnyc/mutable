// NIP-51 private items: sized from the encrypted payload without decrypting,
// and counted exactly once decrypted.

export type LazarusEncryption = "nip04" | "nip44";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

// NIP-44 v2: version (1) + nonce (32) + length (2) + padded plaintext + mac (32)
const NIP44_OVERHEAD_BYTES = 67;
// 32 bytes of padded plaintext is the smallest payload: 99 bytes, 132 base64 chars.
const NIP44_MIN_PAYLOAD_CHARS = 132;

// Assumes the common item shape ["p", <64-hex>] (72 chars) plus a comma.
const BYTES_PER_ITEM = 73;

export function getContentEncryption(
  content: string,
): LazarusEncryption | null {
  const value = content.trim();
  if (!value) return null;
  const [cipherText, iv, ...rest] = value.split("?iv=");
  if (iv !== undefined) {
    return rest.length === 0 && BASE64.test(cipherText) && BASE64.test(iv)
      ? "nip04"
      : null;
  }
  return value.length >= NIP44_MIN_PAYLOAD_CHARS && BASE64.test(value)
    ? "nip44"
    : null;
}

function base64ByteLength(value: string): number | undefined {
  if (value.length % 4) return undefined;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

function nip44PaddedLength(length: number): number {
  if (length <= 32) return 32;
  const nextPower = 1 << (Math.floor(Math.log2(length - 1)) + 1);
  const chunk = nextPower <= 256 ? 32 : nextPower / 8;
  return chunk * (Math.floor((length - 1) / chunk) + 1);
}

export function getPlaintextLengthRange(
  content: string,
): { min: number; max: number } | undefined {
  const value = content.trim();
  const encryption = getContentEncryption(value);

  if (encryption === "nip04") {
    const bytes = base64ByteLength(value.split("?iv=")[0]);
    // PKCS#7 always adds 1 to 16 bytes of padding.
    if (!bytes || bytes % 16) return undefined;
    return { min: bytes - 16, max: bytes - 1 };
  }

  if (encryption === "nip44") {
    const bytes = base64ByteLength(value);
    if (bytes === undefined) return undefined;
    const padded = bytes - NIP44_OVERHEAD_BYTES;
    if (padded < 32 || padded > 65536 || nip44PaddedLength(padded) !== padded) {
      return undefined;
    }
    let low = 1;
    let high = padded;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (nip44PaddedLength(mid) >= padded) high = mid;
      else low = mid + 1;
    }
    return { min: low, max: padded };
  }

  return undefined;
}

export function estimatePrivateItems(
  content: string,
): { min: number; max: number } | undefined {
  const range = getPlaintextLengthRange(content);
  if (!range) return undefined;
  // A JSON array of n such tags is 73n + 1 bytes.
  return {
    min: Math.max(Math.floor((range.min - 1) / BYTES_PER_ITEM), 0),
    max: Math.max(Math.ceil((range.max - 1) / BYTES_PER_ITEM), 0),
  };
}

export function parsePrivateTags(plainText: string): string[][] | undefined {
  try {
    const parsed: unknown = JSON.parse(plainText);
    if (
      !Array.isArray(parsed) ||
      !parsed.every(
        (tag) =>
          Array.isArray(tag) && tag.every((value) => typeof value === "string"),
      )
    ) {
      return undefined;
    }
    return parsed as string[][];
  } catch {
    return undefined;
  }
}

export function countItemTags(tags: string[][], types: string[]): number {
  return tags.filter((tag) => types.includes(tag[0])).length;
}
