import { NextRequest, NextResponse } from "next/server";
import { strikeConfigured, strikeCreateInvoice } from "@/lib/payments/strike";
import { ENTRY_FEE_SATS, isHexPubkey, makeClaimSecret } from "@/lib/security/rankedToken";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";

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
  try {
    const body = await req.json();
    pubkey = String(body?.pubkey || "").trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!isHexPubkey(pubkey)) {
    return NextResponse.json(
      { error: "Login to Nostr before creating an invoice" },
      { status: 401 }
    );
  }

  try {
    const created = await strikeCreateInvoice(ENTRY_FEE_SATS, "Hold BTC – Ranked entry");
    const claimSecret = makeClaimSecret(created.invoiceId);

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
