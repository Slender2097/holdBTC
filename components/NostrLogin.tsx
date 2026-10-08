"use client";

import { useEffect, useRef, useState } from "react";
import type { NostrUser } from "@/hooks/useNostr";
import { shortNpub } from "@/lib/nostr/utils";
import { safeHttpsImageUrl } from "@/lib/security/safeUrl";

interface NostrLoginProps {
  user: NostrUser | null;
  loading: boolean;
  error: string | null;
  onLoginNip07: () => void;
  onLoginNsec: (nsec: string) => boolean;
  onLogout: () => void;
}

export default function NostrLogin({
  user,
  loading,
  error,
  onLoginNip07,
  onLoginNsec,
  onLogout,
}: NostrLoginProps) {
  const [showNsec, setShowNsec] = useState(false);
  const [nsecInput, setNsecInput] = useState("");
  const [termsOpen, setTermsOpen] = useState(false);
  const [pending, setPending] = useState<"nip07" | "nsec" | null>(null);

  const termsAccepted = () => {
    try {
      return localStorage.getItem("holdbtc_terms") === "1";
    } catch {
      return false;
    }
  };

  const askTerms = (next: "nip07" | "nsec") => {
    if (termsAccepted()) return false;
    setPending(next);
    setTermsOpen(true);
    return true;
  };

  const acceptTerms = () => {
    try {
      localStorage.setItem("holdbtc_terms", "1");
    } catch {
      /* ignore */
    }
    const next = pending;
    setTermsOpen(false);
    setPending(null);
    if (next === "nip07") onLoginNip07();
    if (next === "nsec") setShowNsec(true);
  };
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showNsec) return;

    const onPointer = (event: MouseEvent | TouchEvent) => {
      const node = event.target as Node | null;
      if (node && wrapRef.current && !wrapRef.current.contains(node)) {
        setShowNsec(false);
      }
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowNsec(false);
    };

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 20);

    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(focusTimer);
    };
  }, [showNsec]);

  if (user) {
    const name =
      user.displayName ||
      user.profile?.display_name ||
      user.profile?.name ||
      null;
    const picture = safeHttpsImageUrl(user.profile?.picture);

    return (
      <div className="flex items-center h-11 rounded-full bg-alien-panel/80 border border-alien-border pl-1 pr-2">
        <div className="w-8 h-8 rounded-full overflow-hidden bg-alien-void border border-alien-cyan/30 shrink-0 flex items-center justify-center">
          {picture ? (
            <img
              src={picture}
              alt={name || "avatar"}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
              onError={(ev) => {
                (ev.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <span className="text-xs font-bold text-alien-cyan">
              {(name || "H").charAt(0).toUpperCase()}
            </span>
          )}
        </div>
        <div className="min-w-0 hidden sm:block px-2.5">
          <p className="text-sm font-medium text-white truncate max-w-[120px] leading-none">
            {name || shortNpub(user.npub, 8)}
          </p>
        </div>
        <button
          onClick={onLogout}
          className="h-8 px-2.5 rounded-full text-xs text-alien-muted hover:text-red-400 transition font-mono tracking-wide"
          title="Log out"
        >
          EXIT
        </button>
      </div>
    );
  }

  const handleNsecSubmit = () => {
    if (!nsecInput.trim()) return;
    const success = onLoginNsec(nsecInput);
    setNsecInput("");
    if (success) setShowNsec(false);
  };

  return (
    <>
    <div ref={wrapRef} className="relative flex items-center">
      <div className="flex items-center gap-2">
        <button
          onClick={() => { if (!askTerms("nip07")) onLoginNip07(); }}
          disabled={loading}
          className="h-11 px-4 text-sm font-semibold rounded-full bg-alien-purple hover:bg-alien-purple/90 text-white transition disabled:opacity-50 tracking-wide border border-alien-purple/50 shadow-[0_0_12px_rgba(177,78,255,0.25)]"
        >
          {loading ? "..." : "NOSTR EXTENSION"}
        </button>

        <button
          onClick={() => { if (showNsec) { setShowNsec(false); return; } if (!askTerms("nsec")) setShowNsec(true); }}
          aria-expanded={showNsec}
          className={`h-11 px-4 text-sm font-mono rounded-full border transition tracking-wide ${
            showNsec
              ? "bg-alien-panel border-alien-cyan/40 text-white"
              : "bg-alien-panel border-alien-border text-alien-muted hover:text-white hover:border-alien-cyan/40"
          }`}
        >
          NSEC
        </button>
      </div>

      {showNsec && (
        <div className="absolute top-[calc(100%+10px)] right-0 w-[min(20rem,calc(100vw-1.5rem))] z-50">
          <div className="alien-panel rounded-xl border border-red-500/30 shadow-glow p-3.5">
            <p className="text-xs text-red-300/90 font-mono leading-relaxed mb-3">
              Private key stays in this tab, including refresh. Close the tab
              to wipe it. An extension is still safer.
            </p>
            <div className="flex gap-1.5">
              <input
                ref={inputRef}
                type="password"
                placeholder="nsec1..."
                value={nsecInput}
                onChange={(e) => setNsecInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleNsecSubmit();
                }}
                className="flex-1 min-w-0 bg-black/50 border border-red-500/30 rounded-md px-3 h-10 text-sm font-mono text-white placeholder:text-white/25 focus:outline-none focus:border-red-400/60"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                onClick={handleNsecSubmit}
                className="h-10 px-3 text-sm rounded-md bg-red-600 hover:bg-red-500 text-white font-mono transition"
              >
                GO
              </button>
            </div>
            {error && (
              <p className="mt-2 text-xs text-red-400 font-mono leading-relaxed">
                {error}
              </p>
            )}
          </div>
        </div>
      )}

      {!showNsec && error && (
        <p className="pointer-events-none absolute top-[calc(100%+10px)] right-0 max-w-[16rem] text-xs text-red-400 font-mono leading-relaxed bg-alien-deep/95 border border-red-500/20 rounded-xl px-3 py-2">
          {error}
        </p>
      )}
    </div>

      {termsOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-xl border border-alien-border bg-alien-deep p-5 text-left shadow-glow">
            <p className="text-[10px] font-mono tracking-[0.18em] uppercase text-alien-cyan">Terms of Service</p>
            <h2 className="mt-2 text-lg text-white">Before you connect</h2>
            <p className="mt-3 text-sm text-alien-muted leading-relaxed">
              A ranked entry is 1000 sats and is not refunded. You are responsible for your Nostr key.
              Hold BTC does not take responsibility for misuse of a Nostr account. 
              Continue means you agree to these terms.
            </p>
            <a href="/terms" className="mt-3 inline-block text-sm text-alien-cyan underline">
              Read the terms
            </a>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={acceptTerms}
                className="h-10 px-4 rounded-lg bg-alien-cyan text-alien-void text-sm font-semibold"
              >
                Continue
              </button>
              <button
                type="button"
                onClick={() => { setTermsOpen(false); setPending(null); }}
                className="h-10 px-4 rounded-lg border border-alien-border text-sm text-alien-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
