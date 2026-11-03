import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, adminConfig, verifySession } from "@/lib/cashu/adminAuth";
import { cashuConfigured } from "@/lib/cashu/config";
import { VaultError, vaultSummary, type VaultSummary } from "@/lib/cashu/vaultExport";
import { AdminLogin, AdminVault } from "./AdminCashu";

/**
 * Operator page for the Cashu vault. Not linked from the game, no nav item.
 * Login with CASHU_ADMIN_USER / CASHU_ADMIN_PASSWORD; see lib/cashu/adminAuth.ts.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Cashu vault",
  robots: { index: false, follow: false, nocache: true },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-6 px-4 py-10 font-mono text-sm">
      <h1 className="text-lg font-bold tracking-wide text-alien-orange">Cashu vault</h1>
      {children}
    </main>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded border border-alien-border bg-alien-panel p-4 text-alien-muted">{children}</p>;
}

export default async function AdminCashuPage() {
  const cfg = adminConfig();
  if (!cfg.ok) {
    return (
      <Shell>
        <Notice>{cfg.reason}</Notice>
      </Shell>
    );
  }

  const jar = await cookies();
  if (!verifySession(jar.get(ADMIN_COOKIE_NAME)?.value)) {
    return (
      <Shell>
        <AdminLogin />
      </Shell>
    );
  }

  if (!cashuConfigured()) {
    return (
      <Shell>
        <Notice>Cashu is not configured. Set CASHU_MINT_URL and CASHU_VAULT_KEY.</Notice>
        <AdminVault summary={null} error={null} canExport={false} />
      </Shell>
    );
  }

  let summary: VaultSummary | null = null;
  let error: string | null = null;
  try {
    summary = await vaultSummary();
  } catch (err) {
    error = err instanceof VaultError ? err.message : "Could not read the vault.";
    if (!(err instanceof VaultError)) console.error("cashu admin: summary failed:", err);
  }

  return (
    <Shell>
      <AdminVault summary={summary} error={error} canExport />
    </Shell>
  );
}
