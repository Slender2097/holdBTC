import { NextRequest, NextResponse } from "next/server";
import { findScoreByInvoice, publishAttestedScore } from "@/lib/nostr/sitePublish";
import { tryMarkSubmitted } from "@/lib/security/invoiceStore";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";
import { MAX_RANKED_SCORE, verifyRankedToken } from "@/lib/security/rankedToken";
import { MAX_FLAPS, MAX_REPLAY_FRAMES, replayRun } from "@/lib/game/engine";

export async function POST(req: NextRequest) {
  const limit = rateLimit(`submit:${clientIp(req)}`, 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: { token?: string; flaps?: number[]; frames?: number; width?: number; height?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const payload = verifyRankedToken(String(body.token || ""));
  if (!payload || payload.seed == null) {
    return NextResponse.json({ error: "Invalid or expired ranked token" }, { status: 401 });
  }

  const flaps = Array.isArray(body.flaps) ? body.flaps : [];
  if (flaps.length === 0 || flaps.length > MAX_FLAPS) {
    return NextResponse.json({ error: "Invalid run log" }, { status: 400 });
  }

  const replay = replayRun({
    seed: payload.seed,
    flaps,
    width: Number(body.width),
    height: Number(body.height),
    maxFrames: Math.min(
      MAX_REPLAY_FRAMES,
      Math.max(Number(body.frames) || 0, flaps[flaps.length - 1] || 0) + 180
    ),
  });

  if (!replay.dead || replay.score <= 0) {
    return NextResponse.json({ error: "Run could not be verified" }, { status: 400 });
  }

  const elapsed = Math.max(1, Math.floor(Date.now() / 1000) - payload.iat);
  if (replay.score > elapsed * 45 + 80) {
    return NextResponse.json({ error: "Score does not match run time" }, { status: 400 });
  }

  if (replay.score > MAX_RANKED_SCORE) {
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
      score: replay.score,
      distance: Math.floor(replay.distance),
      invoiceId: payload.invoiceId,
    });

    return NextResponse.json({ ok: true, eventId: event.id, score: replay.score });
  } catch (err) {
    console.error("submit-score failed:", err);
    return NextResponse.json({ error: "Could not publish attested score" }, { status: 502 });
  }
}
