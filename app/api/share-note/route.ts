import { NextRequest, NextResponse } from "next/server";
import { verifyEvent, type Event } from "nostr-tools";
import { publishSignedNote } from "@/lib/nostr/sitePublish";
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
  const tags = event.tags || [];
  const tagged = tags.some((tag) => tag[0] === "t" && tag[1] === "holdbtc");
  if (!tagged || !event.content.includes("holdbtc.io") || event.content.length > 800) {
    return NextResponse.json({ error: "Note is not a Hold BTC share" }, { status: 400 });
  }

  const acks = await publishSignedNote(event);
  if (acks === 0) {
    return NextResponse.json({ error: "No relay accepted the note" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, eventId: event.id });
}
