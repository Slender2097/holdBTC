import { NextRequest, NextResponse } from "next/server";
import { issueChallenge, type ChallengeScope } from "@/lib/security/challenge";
import { isHexPubkey, isSafeInvoiceId } from "@/lib/security/rankedToken";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";

export async function GET(req: NextRequest) {
  const limit = rateLimit(`challenge:${clientIp(req)}`, 30, 60_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "Too many challenges" }, { status: 429 });
  }

  const pubkey = String(req.nextUrl.searchParams.get("pubkey") || "").trim().toLowerCase();
  const scope = String(req.nextUrl.searchParams.get("scope") || "invoice") as ChallengeScope;
  const invoiceId = String(req.nextUrl.searchParams.get("invoiceId") || "").trim();

  if (!isHexPubkey(pubkey)) {
    return NextResponse.json({ error: "Invalid pubkey" }, { status: 400 });
  }
  if (scope !== "invoice" && scope !== "credit") {
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  }
  if (scope === "credit" && !isSafeInvoiceId(invoiceId)) {
    return NextResponse.json({ error: "invoiceId required for credit challenge" }, { status: 400 });
  }

  try {
    const issued = issueChallenge({
      pubkey,
      scope,
      invoiceId: scope === "credit" ? invoiceId : undefined,
    });
    return NextResponse.json(issued);
  } catch (err) {
    console.error("challenge failed:", err);
    return NextResponse.json({ error: "Challenge unavailable" }, { status: 500 });
  }
}
