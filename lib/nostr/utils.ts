import { nip19 } from "nostr-tools";

/** Safe short form of an npub (always returns npub1... format) */
export function shortNpub(npubOrHex: string, chars = 8): string {
  try {
    let npub = npubOrHex;

    // If it's a hex pubkey, convert to npub first
    if (!npubOrHex.startsWith("npub1") && /^[0-9a-fA-F]{64}$/.test(npubOrHex)) {
      npub = nip19.npubEncode(npubOrHex);
    }

    // If it's already an npub, just truncate it nicely
    if (npub.startsWith("npub1")) {
      return `${npub.slice(0, 4 + chars)}…${npub.slice(-4)}`;
    }

    // Fallback
    return npub.slice(0, 12) + "…";
  } catch {
    return npubOrHex.slice(0, 12) + "…";
  }
}

/** Convert hex pubkey to npub */
export function toNpub(hex: string): string {
  try {
    return nip19.npubEncode(hex);
  } catch {
    return hex;
  }
}

/** Parse nsec or return null */
export function parseNsec(input: string): Uint8Array | null {
  try {
    const trimmed = input.trim();
    if (trimmed.startsWith("nsec1")) {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "nsec") return decoded.data as Uint8Array;
    }
    // raw hex 64
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      const bytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        bytes[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
      }
      return bytes;
    }
  } catch {
    /* ignore */
  }
  return null;
}