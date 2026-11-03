import { NextRequest, NextResponse } from "next/server";
import type { Event } from "nostr-tools";
import { cashuConfigured } from "@/lib/cashu/config";
import { redeemCashuEntry } from "@/lib/cashu/redeem";
import { verifyAuthEvent } from "@/lib/nostr/verifyAuth";
import { isBanned } from "@/lib/security/blockList";
import { isHexPubkey } from "@/lib/security/rankedToken";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";

/**
 * Cashu ranked entry: swap the player's ecash into server proofs (NUT-03), return
 * their change, and unlock one ranked run. See lib/cashu/redeem.ts.
 *
 * Body: { token: string (cashuA/B), outputs: {amount, B_, id}[], pubkey, authEvent }
 * The auth event is the same kind-22242 "credit" challenge Lightning uses, bound to
 * the runId derived from the token's proofs.
 */
export async function POST(req: NextRequest) {
  const limit = rateLimit(`cashu:${clientIp(req)}`, 20, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many requests", code: "rate_limited", retryable: true },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }
  if (!cashuConfigured()) {
    return NextResponse.json({ error: "Cashu is not available", code: "disabled", retryable: false }, { status: 503 });
  }

  let body: { token?: string; outputs?: unknown; pubkey?: string; authEvent?: Event };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON", code: "bad_request", retryable: false }, { status: 400 });
  }

  const pubkey = String(body.pubkey || "").trim().toLowerCase();
  if (!isHexPubkey(pubkey)) {
    return NextResponse.json({ error: "Log in with Nostr to play ranked", code: "login", retryable: false }, { status: 401 });
  }
  if (isBanned(pubkey)) {
    return NextResponse.json(
      { error: "This account cannot start a ranked run", code: "banned", retryable: false },
      { status: 403 }
    );
  }
  const pkLimit = rateLimit(`cashu-pk:${pubkey}`, 30, 60 * 60 * 1000);
  if (!pkLimit.ok) {
    return NextResponse.json({ error: "Too many requests", code: "rate_limited", retryable: true }, { status: 429 });
  }

  try {
    const result = await redeemCashuEntry({
      encodedToken: String(body.token || ""),
      changeOutputs: body.outputs,
      pubkey,
      authorize: (runId) => verifyAuthEvent(body.authEvent, pubkey, "credit", runId),
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, code: result.code, retryable: result.retryable },
        { status: result.status }
      );
    }
    return NextResponse.json({
      ok: true,
      runId: result.runId,
      token: result.token,
      seed: result.seed,
      change: result.change,
      feeSats: result.feeSats,
      replay: result.replay,
    });
  } catch (err) {
    console.error("cashu redeem failed:", err);
    return NextResponse.json({ error: "Try again", code: "store_down", retryable: true }, { status: 503 });
  }
}
