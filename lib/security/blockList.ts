/** Fallback list, used only when the BANNED_PUBKEYS env var is empty. Starts empty. */
export const BANNED_PUBKEYS: string[] = [];

const HEX_PUBKEY = /^[0-9a-f]{64}$/;
let envRaw: string | undefined;
let envList = new Set<string>();

/** Pubkeys from the BANNED_PUBKEYS env var (comma-separated hex). Re-parsed only when it changes. */
function envBanned(): Set<string> {
  const raw = process.env.BANNED_PUBKEYS || "";
  if (raw !== envRaw) {
    envRaw = raw;
    const entries = raw.split(/[\s,]+/).map((item) => item.toLowerCase()).filter(Boolean);
    const valid = entries.filter((item) => HEX_PUBKEY.test(item));
    if (valid.length < entries.length) {
      console.warn(`BANNED_PUBKEYS: ignored ${entries.length - valid.length} entries that are not 64-char hex pubkeys`);
    }
    envList = new Set(valid);
  }
  return envList;
}

export function isBanned(pubkey?: string | null): boolean {
  if (!pubkey) return false;
  const pk = pubkey.toLowerCase();
  const fromEnv = envBanned();
  if (fromEnv.size) return fromEnv.has(pk);
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
