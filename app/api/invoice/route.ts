import { NextRequest, NextResponse } from "next/server";
import type { Event } from "nostr-tools";
import { strikeConfigured, strikeCreateInvoice } from "@/lib/payments/strike";
import { ENTRY_FEE_SATS, isHexPubkey, makeClaimSecret } from "@/lib/security/rankedToken";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";
import { verifyAuthEvent } from "@/lib/nostr/verifyAuth";
import { isBanned } from "@/lib/security/blockList";

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  const limit = rateLimit(`invoice:${ip}`, 5, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many invoices. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  if (!strikeConfigured()) {
    return NextResponse.json({ error: "Payments are not available" }, { status: 500 });
  }

  let pubkey = "";
  let authEvent: Event | undefined;
  try {
    const body = await req.json();
    pubkey = String(body?.pubkey || "").trim().toLowerCase();
    authEvent = body?.authEvent;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!isHexPubkey(pubkey)) {
    return NextResponse.json(
      { error: "Login to Nostr before creating an invoice" },
      { status: 401 }
    );
  }
  if (isBanned(pubkey)) {
    return NextResponse.json({ error: "This account cannot start a ranked run" }, { status: 403 });
  }

  const pkLimit = rateLimit(`invoice-pk:${pubkey}`, 8, 60 * 60 * 1000);
  if (!pkLimit.ok) {
    return NextResponse.json({ error: "Too many invoices for this account" }, { status: 429 });
  }

  const authError = verifyAuthEvent(authEvent, pubkey, "invoice");
  if (authError) {
    return NextResponse.json({ error: authError }, { status: 401 });
  }

  try {
    const created = await strikeCreateInvoice(ENTRY_FEE_SATS, "Hold BTC – Ranked entry");
    const claimSecret = makeClaimSecret(created.invoiceId, pubkey);
    return NextResponse.json({
      payment_hash: created.invoiceId,
      payment_request: created.payment_request,
      amount: ENTRY_FEE_SATS,
      invoiceId: created.invoiceId,
      claimSecret,
    });
  } catch (err) {
    console.error("Invoice creation failed:", err);
    return NextResponse.json({ error: "Could not create invoice" }, { status: 502 });
  }
}
