import { NextRequest, NextResponse } from "next/server";
import { findScoreByInvoice, publishAttestedScore } from "@/lib/nostr/sitePublish";
import { tryMarkSubmitted } from "@/lib/security/invoiceStore";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";
import { MAX_RANKED_SCORE, verifyRankedToken } from "@/lib/security/rankedToken";

export async function POST(req: NextRequest) {
  const limit = rateLimit(`submit:${clientIp(req)}`, 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: { token?: string; score?: number; distance?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const payload = verifyRankedToken(String(body.token || ""));
  if (!payload) {
    return NextResponse.json({ error: "Invalid or expired ranked token" }, { status: 401 });
  }

  const score = Number(body.score);
  const distance = Number(body.distance ?? body.score);
  if (!Number.isFinite(score) || score <= 0 || score > MAX_RANKED_SCORE) {
    return NextResponse.json({ error: "Invalid score" }, { status: 400 });
  }

  if (!tryMarkSubmitted(payload.invoiceId, payload.pubkey)) {
    return NextResponse.json({ error: "This payment was already used" }, { status: 409 });
  }

  try {
    const already = await findScoreByInvoice(payload.invoiceId);
    if (already) {
      return NextResponse.json({ error: "This payment was already used" }, { status: 409 });
    }

    const event = await publishAttestedScore({
      playerPubkey: payload.pubkey,
      score: Math.floor(score),
      distance: Math.floor(Number.isFinite(distance) ? distance : score),
      invoiceId: payload.invoiceId,
    });

    return NextResponse.json({ ok: true, eventId: event.id });
  } catch (err) {
    console.error("submit-score failed:", err);
    return NextResponse.json({ error: "Could not publish attested score" }, { status: 502 });
  }
}
