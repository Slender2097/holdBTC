import { NextRequest, NextResponse } from "next/server";
import type { Event } from "nostr-tools";
import { strikeConfigured, strikeGetInvoice } from "@/lib/payments/strike";
import { findScoreByInvoice } from "@/lib/nostr/sitePublish";
import { verifyAuthEvent } from "@/lib/nostr/verifyAuth";
import { getInvoiceRecord, tryMarkIssued } from "@/lib/security/invoiceStore";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";
import {
  ENTRY_FEE_SATS,
  isHexPubkey,
  isSafeInvoiceId,
  issueRankedToken,
  verifyClaimSecret,
} from "@/lib/security/rankedToken";

export async function POST(req: NextRequest) {
  const limit = rateLimit(`credit:${clientIp(req)}`, 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  if (!strikeConfigured()) {
    return NextResponse.json({ error: "Payments are not available" }, { status: 500 });
  }

  let body: { invoiceId?: string; pubkey?: string; claimSecret?: string; authEvent?: Event };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const invoiceId = String(body.invoiceId || "").trim();
  const pubkey = String(body.pubkey || "").trim().toLowerCase();
  const claimSecret = String(body.claimSecret || "").trim();

  if (!isSafeInvoiceId(invoiceId) || !isHexPubkey(pubkey)) {
    return NextResponse.json({ error: "Missing invoice or invalid pubkey" }, { status: 400 });
  }

  const authError = verifyAuthEvent(body.authEvent, pubkey, "credit", invoiceId);
  if (authError) {
    return NextResponse.json({ error: authError }, { status: 401 });
  }

  if (!verifyClaimSecret(invoiceId, pubkey, claimSecret)) {
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

    if (getInvoiceRecord(invoiceId)) {
      return NextResponse.json({ error: "This payment was already used" }, { status: 409 });
    }

    const already = await findScoreByInvoice(invoiceId);
    if (already) {
      tryMarkIssued(invoiceId, pubkey);
      return NextResponse.json({ error: "This payment was already used" }, { status: 409 });
    }

    if (!tryMarkIssued(invoiceId, pubkey)) {
      return NextResponse.json({ error: "This payment was already used" }, { status: 409 });
    }

    const verifiedPubkey = String(body.authEvent?.pubkey || pubkey).toLowerCase();
    return NextResponse.json({ ok: true, token: issueRankedToken(verifiedPubkey, invoiceId) });
  } catch (err) {
    console.error("ranked-credit failed:", err);
    return NextResponse.json({ error: "Could not issue ranked credit" }, { status: 502 });
  }
}
