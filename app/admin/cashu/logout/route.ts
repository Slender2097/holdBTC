import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, isSameOrigin, sessionCookieOptions } from "@/lib/cashu/adminAuth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(ADMIN_COOKIE_NAME, "", sessionCookieOptions(0));
  return res;
}
