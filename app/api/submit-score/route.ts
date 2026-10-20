import { NextRequest, NextResponse } from "next/server";
import { findScoreByInvoice, publishAttestedScore } from "@/lib/nostr/sitePublish";
import { isBanned } from "@/lib/security/blockList";
import { markSubmitPublished, reserveSubmit, type SubmitRecord } from "@/lib/security/invoiceStore";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";
import { MAX_RANKED_SCORE, verifyRankedToken } from "@/lib/security/rankedToken";
import { MAX_FLAPS, MAX_REPLAY_FRAMES, replayRun } from "@/lib/game/engine";

export async function POST(req: NextRequest) {
  const limit = rateLimit(`submit:${clientIp(req)}`, 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "Too many requests", retryable: true }, { status: 429 });
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
  if (isBanned(payload.pubkey)) {
    return NextResponse.json({ error: "This account cannot submit ranked scores" }, { status: 403 });
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
  if (replay.frames > elapsed * 60 * 1.1 + 300) {
    return NextResponse.json({ error: "Run is longer than the time since payment" }, { status: 400 });
  }

  if (replay.score > MAX_RANKED_SCORE) {
    return NextResponse.json({ error: "Invalid score" }, { status: 400 });
  }

  let reserved;
  try {
    reserved = await reserveSubmit(payload.invoiceId, {
      pubkey: payload.pubkey,
      score: replay.score,
      distance: Math.floor(replay.distance),
    });
  } catch (err) {
    console.error("submit-score store failed:", err);
    return NextResponse.json(
      { error: "Could not record your score. Your payment is still valid, retry the submit.", retryable: true },
      { status: 503 }
    );
  }

  const record = reserved.record;
  if (!record || record.pubkey !== payload.pubkey) {
    return NextResponse.json({ error: "This payment was already used" }, { status: 409 });
  }
  // Already published: answer the retry with the stored result.
  if (reserved.eventId) {
    return NextResponse.json({ ok: true, eventId: reserved.eventId, score: record.score });
  }
  // Reserved but not yet published (first try, or an earlier publish failed):
  // always publish the stored score, never a different run's.
  return publish(payload.invoiceId, record);
}

async function publish(invoiceId: string, record: SubmitRecord) {
  let eventId: string;
  try {
    // Covers invoices spent before this store existed, and a publish whose write-back failed.
    const onRelays = await findScoreByInvoice(invoiceId);
    if (onRelays) {
      const sameRun =
        onRelays.tags.some((t) => t[0] === "p" && t[1] === record.pubkey) &&
        onRelays.tags.some((t) => t[0] === "score" && t[1] === String(record.score));
      if (!sameRun) {
        return NextResponse.json({ error: "This payment was already used" }, { status: 409 });
      }
      eventId = onRelays.id;
    } else {
      const event = await publishAttestedScore({
        playerPubkey: record.pubkey,
        score: record.score,
        distance: record.distance,
        invoiceId,
      });
      eventId = event.id;
    }
  } catch (err) {
    console.error("submit-score relay lookup/publish failed:", err);
    return NextResponse.json(
      { error: "Could not publish your score. Your payment is still valid, retry the submit.", retryable: true },
      { status: 502 }
    );
  }

  try {
    if (!(await markSubmitPublished(invoiceId, record.pubkey, eventId))) {
      console.warn("submit-score eventId write-back skipped by guard:", invoiceId);
    }
  } catch (err) {
    // The score is already on the relays; a retry finds it there and writes back again.
    console.error("submit-score eventId write-back failed:", err);
  }
  return NextResponse.json({ ok: true, eventId, score: record.score });
}
