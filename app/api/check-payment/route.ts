import { NextRequest, NextResponse } from "next/server";
import { strikeConfigured, strikeGetInvoice } from "@/lib/payments/strike";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";

export async function GET(req: NextRequest) {
  const limit = rateLimit(`check:${clientIp(req)}`, 40, 60_000);
  if (!limit.ok) {
    return NextResponse.json({ paid: false }, { status: 429 });
  }

  const hash = req.nextUrl.searchParams.get("hash");
  if (!hash) {
    return NextResponse.json({ error: "Missing payment hash" }, { status: 400 });
  }

  if (!strikeConfigured()) {
    return NextResponse.json({ error: "Strike is not configured" }, { status: 500 });
  }

  try {
    const status = await strikeGetInvoice(hash);
    return NextResponse.json({
      paid: status.paid,
      amount: status.amountSats,
    });
  } catch (err) {
    console.error("check-payment failed:", err);
    return NextResponse.json({ paid: false });
  }
}
