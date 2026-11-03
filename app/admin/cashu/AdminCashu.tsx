"use client";

import { useRef, useState } from "react";
import type { VaultSummary } from "@/lib/cashu/vaultExport";

const field =
  "w-full rounded border border-alien-border bg-alien-deep px-3 py-2 text-white outline-none focus:border-alien-cyan";
const button =
  "rounded border border-alien-orange bg-alien-orange/10 px-4 py-2 font-bold text-alien-orange hover:bg-alien-orange/20 disabled:opacity-50";

export function AdminLogin() {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/admin/cashu/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, password }),
        credentials: "same-origin",
        cache: "no-store",
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error || `Login failed (${res.status})`);
      setPassword("");
    } catch {
      setError("Connection lost. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" autoComplete="on">
      <label className="flex flex-col gap-1">
        <span className="text-alien-muted">User</span>
        <input
          className={field}
          name="username"
          autoComplete="username"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          required
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-alien-muted">Password</span>
        <input
          className={field}
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      <button type="submit" className={button} disabled={busy}>
        {busy ? "Checking…" : "Log in"}
      </button>
      {error && (
        <p role="alert" data-testid="login-error" className="text-candle-red">
          {error}
        </p>
      )}
    </form>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded border border-alien-border bg-alien-panel p-3">
      <div className="text-xs uppercase tracking-wider text-alien-muted">{label}</div>
      <div className="mt-1 text-xl font-bold text-white" data-testid={testId}>
        {value}
      </div>
    </div>
  );
}

const fmt = (n: number) => n.toLocaleString("en-US");

export function AdminVault({
  summary: initial,
  error: initialError,
  canExport,
}: {
  summary: VaultSummary | null;
  error: string | null;
  canExport: boolean;
}) {
  const [summary, setSummary] = useState(initial);
  const [error, setError] = useState(initialError);
  const [token, setToken] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  const doExport = async () => {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch("/admin/cashu/export", { method: "POST", credentials: "same-origin", cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as {
        token?: string | null;
        summary?: VaultSummary;
        error?: string;
      };
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      if (!res.ok) {
        setError(data.error || `Export failed (${res.status})`);
        return;
      }
      if (data.summary) setSummary(data.summary);
      setToken(data.token ?? null);
      setExported(true);
    } catch {
      setError("Connection lost. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      // Older browsers / no clipboard permission: select it so Ctrl+C works.
      area.current?.select();
      setCopied(document.execCommand?.("copy") ?? false);
    }
    setTimeout(() => setCopied(false), 2000);
  };

  const logout = async () => {
    await fetch("/admin/cashu/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
    window.location.reload();
  };

  return (
    <div className="flex flex-col gap-5">
      {summary && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Runs" value={fmt(summary.runs)} testId="stat-runs" />
          <Stat label="Proofs" value={fmt(summary.proofs)} testId="stat-proofs" />
          <Stat label="Unspent sats" value={fmt(summary.unspentSats)} testId="stat-unspent" />
        </div>
      )}
      {summary && (summary.spentProofs > 0 || summary.pendingProofs > 0 || summary.unreadableRuns > 0) && (
        <p className="text-xs text-alien-muted" data-testid="stat-detail">
          {summary.unspentProofs} unspent proofs, {summary.spentProofs} spent
          {summary.pendingProofs ? `, ${summary.pendingProofs} pending` : ""}
          {summary.unreadableRuns
            ? `. ${summary.unreadableRuns} vault entries could not be opened with this CASHU_VAULT_KEY.`
            : "."}
        </p>
      )}

      {error && (
        <p role="alert" data-testid="vault-error" className="text-candle-red">
          {error}
        </p>
      )}

      {canExport && (
        <button type="button" className={button} onClick={doExport} disabled={busy} data-testid="export">
          {busy ? "Asking the mint…" : "Export token"}
        </button>
      )}

      {exported && !token && (
        <p className="text-alien-muted" data-testid="export-empty">
          Nothing to export: the vault has no unspent proofs.
        </p>
      )}

      {token && (
        <div className="flex flex-col gap-2">
          <p className="text-alien-muted">
            {fmt(summary?.unspentSats ?? 0)} sats, {summary?.unspentProofs ?? 0} proofs. Receive it in a Cashu wallet.
            This is bearer money: anyone with the token can take it.
          </p>
          <textarea
            ref={area}
            readOnly
            value={token}
            rows={6}
            spellCheck={false}
            className={`${field} break-all font-mono text-xs`}
            data-testid="token"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" className={button} onClick={copy} data-testid="copy">
            {copied ? "Copied" : "Copy token"}
          </button>
        </div>
      )}

      <button type="button" onClick={logout} className="self-start text-xs text-alien-muted underline">
        Log out
      </button>
    </div>
  );
}
