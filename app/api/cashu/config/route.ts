import { NextResponse } from "next/server";
import { cashuConfigured, cashuMintUrl } from "@/lib/cashu/config";
import { CASHU_ENTRY_FEE_SATS } from "@/lib/cashu/constants";

export const dynamic = "force-dynamic";

/** The one mint the browser wallet may use. The browser never chooses it. */
export async function GET() {
  if (!cashuConfigured()) {
    return NextResponse.json({ enabled: false, priceSats: CASHU_ENTRY_FEE_SATS });
  }
  return NextResponse.json({ enabled: true, mintUrl: cashuMintUrl(), priceSats: CASHU_ENTRY_FEE_SATS });
}
