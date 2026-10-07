/** Pubkeys hidden from the board and blocked from new ranked entries. Starts empty. */
export const BANNED_PUBKEYS: string[] = [];

export function isBanned(pubkey?: string | null): boolean {
  if (!pubkey) return false;
  const pk = pubkey.toLowerCase();
  return BANNED_PUBKEYS.some((item) => item.toLowerCase() === pk);
}

/** Same check. The leaderboard route calls this name. */
export const isBlockedPubkey = isBanned;

export function publicName(value?: string | null): string | undefined {
  if (!value) return undefined;
  const clean = value.replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.length > 32 ? clean.slice(0, 32) : clean;
}
