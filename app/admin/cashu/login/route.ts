import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_COOKIE_NAME,
  attemptLogin,
  createSession,
  isHttpsOk,
  isSameOrigin,
  sessionCookieOptions,
} from "@/lib/cashu/adminAuth";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** POST { user, password } → sets the httpOnly admin session cookie (path /admin/cashu). */
export async function POST(req: NextRequest) {
  if (!isHttpsOk(req)) return NextResponse.json({ error: "HTTPS required" }, { status: 403, headers: NO_STORE });
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });

  let body: { user?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400, headers: NO_STORE });
  }
  const user = typeof body.user === "string" ? body.user.slice(0, 256) : "";
  const password = typeof body.password === "string" ? body.password.slice(0, 1024) : "";

  const result = await attemptLogin(req, user, password);
  if (!result.ok) {
    const headers: Record<string, string> = { ...NO_STORE };
    if (result.retryAfterSec) headers["Retry-After"] = String(result.retryAfterSec);
    return NextResponse.json({ error: result.error }, { status: result.status, headers });
  }

  const session = createSession();
  if (!session) return NextResponse.json({ error: "Admin login is not set up" }, { status: 503, headers: NO_STORE });
  const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
  res.cookies.set(ADMIN_COOKIE_NAME, session, sessionCookieOptions());
  return res;
}
