import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME, isHttpsOk, isSameOrigin, verifySession } from "@/lib/cashu/adminAuth";
import { VaultError, exportVaultToken } from "@/lib/cashu/vaultExport";
import { clientIp, rateLimit } from "@/lib/security/rateLimit";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * POST → { token, summary }: one cashuB token with every UNSPENT vault proof.
 * Read-only: nothing in the vault is deleted or changed. Same logic as
 * scripts/cashu-vault-export.mjs.
 */
export async function POST(req: NextRequest) {
  if (!isHttpsOk(req)) return NextResponse.json({ error: "HTTPS required" }, { status: 403, headers: NO_STORE });
  if (!isSameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: NO_STORE });
  if (!verifySession(req.cookies.get(ADMIN_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "Log in again" }, { status: 401, headers: NO_STORE });
  }
  const limit = rateLimit(`cashu-admin-export:${clientIp(req)}`, 20, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSec) } }
    );
  }

  try {
    const { token, summary } = await exportVaultToken();
    console.info(`cashu admin: export ${summary.unspentProofs} proofs, ${summary.unspentSats} sats`);
    return NextResponse.json({ token, summary }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof VaultError) {
      const status = err.code === "not_configured" ? 503 : 502;
      return NextResponse.json({ error: err.message, code: err.code }, { status, headers: NO_STORE });
    }
    console.error("cashu admin: export failed:", err);
    return NextResponse.json({ error: "Export failed. Try again." }, { status: 500, headers: NO_STORE });
  }
}
