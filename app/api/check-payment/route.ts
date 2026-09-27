import { NextRequest, NextResponse } from "next/server";
import { strikeConfigured, strikeGetInvoice } from "@/lib/payments/strike";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";
import { isSafeInvoiceId } from "@/lib/security/rankedToken";

export async function GET(req: NextRequest) {
  const limit = rateLimit(`check:${clientIp(req)}`, 40, 60_000);
  if (!limit.ok) {
    return NextResponse.json({ paid: false, rateLimited: true }, { status: 429 });
  }

  const hash = req.nextUrl.searchParams.get("hash") || "";
  if (!isSafeInvoiceId(hash)) {
    return NextResponse.json({ error: "Missing payment hash" }, { status: 400 });
  }

  if (!strikeConfigured()) {
    return NextResponse.json({ error: "Payments are not available" }, { status: 500 });
  }

  try {
    const status = await strikeGetInvoice(hash);
    return NextResponse.json({ paid: status.paid, amount: status.amountSats });
  } catch (err) {
    console.error("check-payment failed:", err);
    return NextResponse.json({ paid: false });
  }
}
