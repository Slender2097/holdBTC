import { verifyEvent, type Event } from "nostr-tools";
import { isHexPubkey } from "@/lib/security/rankedToken";
import { verifyScopedChallenge, type ChallengeScope } from "@/lib/security/challenge";

const AUTH_KIND = 22242;

export function verifyAuthEvent(
  event: Event | null | undefined,
  expectedPubkey: string,
  scope: ChallengeScope,
  invoiceId?: string
): string | null {
  if (!event || typeof event !== "object") return "Missing auth event";
  if (!isHexPubkey(expectedPubkey)) return "Invalid pubkey";
  if (String(event.pubkey || "").toLowerCase() !== expectedPubkey.toLowerCase()) {
    return "Auth pubkey mismatch";
  }
  if (event.kind !== AUTH_KIND) return "Invalid auth event kind";
  if (!verifyEvent(event)) return "Invalid auth signature";

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(event.created_at || 0));
  if (age > 300) return "Auth event expired";

  const challenge = String(event.content || "");
  if (
    !verifyScopedChallenge({
      challenge,
      pubkey: expectedPubkey,
      scope,
      invoiceId,
    })
  ) {
    return "Invalid or expired challenge";
  }
  return null;
}
