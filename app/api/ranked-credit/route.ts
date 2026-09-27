import { NextRequest, NextResponse } from "next/server";
import { strikeConfigured, strikeGetInvoice } from "@/lib/payments/strike";
import { findScoreByInvoice } from "@/lib/nostr/sitePublish";
import {
  ENTRY_FEE_SATS,
  isHexPubkey,
  issueRankedToken,
  verifyClaimSecret,
} from "@/lib/security/rankedToken";

export async function POST(req: NextRequest) {
  if (!strikeConfigured()) {
    return NextResponse.json({ error: "Strike is not configured" }, { status: 500 });
  }

  let body: { invoiceId?: string; pubkey?: string; claimSecret?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const invoiceId = String(body.invoiceId || "").trim();
  const pubkey = String(body.pubkey || "").trim().toLowerCase();
  const claimSecret = String(body.claimSecret || "").trim();

  if (!invoiceId || !isHexPubkey(pubkey)) {
    return NextResponse.json({ error: "Missing invoice or invalid pubkey" }, { status: 400 });
  }

  if (!verifyClaimSecret(invoiceId, claimSecret)) {
    return NextResponse.json({ error: "Invalid claim" }, { status: 403 });
  }

  try {
    const status = await strikeGetInvoice(invoiceId);
    if (!status.paid) {
      return NextResponse.json({ error: "Invoice is not paid" }, { status: 402 });
    }

    if (status.amountSats !== null && status.amountSats < ENTRY_FEE_SATS) {
      return NextResponse.json({ error: "Invoice amount too low" }, { status: 400 });
    }

    const already = await findScoreByInvoice(invoiceId);
    if (already) {
      return NextResponse.json({ error: "This payment was already used" }, { status: 409 });
    }

    const token = issueRankedToken(pubkey, invoiceId);
    return NextResponse.json({ ok: true, token });
  } catch (err) {
    console.error("ranked-credit failed:", err);
    return NextResponse.json({ error: "Could not issue ranked credit" }, { status: 502 });
  }
}
