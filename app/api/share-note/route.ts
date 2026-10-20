import { NextRequest, NextResponse } from "next/server";
import { verifyEvent, type Event } from "nostr-tools";
import { publishSignedNote } from "@/lib/nostr/sitePublish";
import { shareNoteScore } from "@/lib/nostr/shareNote";
import { isBanned } from "@/lib/security/blockList";
import { MAX_RANKED_SCORE } from "@/lib/security/rankedToken";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";

export async function POST(req: NextRequest) {
  const limit = rateLimit(`share:${clientIp(req)}`, 8, 60_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "Slow down" }, { status: 429 });
  }

  let event: Event;
  try {
    event = (await req.json()).event;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  if (!event || event.kind !== 1 || !verifyEvent(event)) {
    return NextResponse.json({ error: "Invalid note" }, { status: 400 });
  }
  if (isBanned(event.pubkey)) {
    return NextResponse.json({ error: "This account cannot share" }, { status: 403 });
  }
  const score = shareNoteScore(event.content, event.tags);
  if (score === null || score > MAX_RANKED_SCORE) {
    return NextResponse.json({ error: "Note is not a Hold BTC share" }, { status: 400 });
  }

  const pkLimit = rateLimit(`share-pk:${event.pubkey}`, 3, 10 * 60_000);
  if (!pkLimit.ok) {
    return NextResponse.json(
      { error: "You shared recently. Try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(pkLimit.retryAfterSec) } }
    );
  }

  const acks = await publishSignedNote(event);
  if (acks === 0) {
    return NextResponse.json({ error: "No relay accepted the note" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, eventId: event.id });
}
