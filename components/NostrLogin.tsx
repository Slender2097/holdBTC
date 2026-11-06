"use client";

import { useEffect, useRef, useState } from "react";
import type { NostrUser, RemoteLoginState } from "@/hooks/useNostr";
import { shortNpub } from "@/lib/nostr/utils";
import { safeHttpsImageUrl } from "@/lib/security/safeUrl";

interface NostrLoginProps {
  user: NostrUser | null;
  loading: boolean;
  error: string | null;
  onLoginNip07: () => void;
  onCancelNip07?: () => void;
  onLoginNsec: (nsec: string) => boolean;
  remote: RemoteLoginState;
  remoteAuthUrl: string | null;
  onLoginRemote: () => void;
  onResumeRemote: () => void;
  onStartOverRemote: () => void;
  onLoginBunker: (input: string) => void;
  onCancelRemote: () => void;
  onLogout: () => void;
}

export default function NostrLogin({
  user,
  loading,
  error,
  onLoginNip07,
  onCancelNip07,
  onLoginNsec,
  remote,
  remoteAuthUrl,
  onLoginRemote,
  onResumeRemote,
  onStartOverRemote,
  onLoginBunker,
  onCancelRemote,
  onLogout,
}: NostrLoginProps) {
  const [showNsec, setShowNsec] = useState(false);
  const [nsecInput, setNsecInput] = useState("");
  const [showRemote, setShowRemote] = useState(false);
  const [bunkerInput, setBunkerInput] = useState("");
  const [remoteQr, setRemoteQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Phone: the signer is usually on this device, so the QR code is opt-in.
  const [qrOnPhone, setQrOnPhone] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [pending, setPending] = useState<"nip07" | "nsec" | "remote" | null>(null);
  const [errorHidden, setErrorHidden] = useState(false);
  const lastErrorRef = useRef<string | null>(null);

  useEffect(() => {
    if (error !== lastErrorRef.current) {
      lastErrorRef.current = error;
      setErrorHidden(false);
    }
  }, [error]);

  const visibleError = errorHidden ? null : error;

  const termsAccepted = () => {
    try {
      return localStorage.getItem("holdbtc_terms") === "1";
    } catch {
      return false;
    }
  };

  const askTerms = (next: "nip07" | "nsec" | "remote") => {
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
    if (next === "remote") openRemote();
  };

  const remoteUri = remote.phase === "waiting" ? remote.uri : undefined;
  const remoteWaiting = remote.phase === "waiting";

  function openRemote() {
    setShowNsec(false);
    setShowRemote(true);
    setBunkerInput("");
    setQrOnPhone(false);
    onLoginRemote();
  }

  const closeRemote = () => {
    setShowRemote(false);
    onCancelRemote();
  };

  const submitBunker = () => {
    const value = bunkerInput.trim();
    if (!value) return;
    onLoginBunker(value);
  };

  const copyRemoteUri = async () => {
    if (!remoteUri) return;
    try {
      await navigator.clipboard.writeText(remoteUri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!remoteUri) {
      setRemoteQr(null);
      return;
    }
    let live = true;
    (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        const url = await QRCode.toDataURL(remoteUri, { width: 240, margin: 2, errorCorrectionLevel: "L" });
        if (live) setRemoteQr(url);
      } catch {
        if (live) setRemoteQr(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [remoteUri]);

  // Logged in: the panel is done.
  useEffect(() => {
    if (user) setShowRemote(false);
  }, [user]);

  // Escape cancels. A tap outside does not: on a phone the player leaves for
  // the signer app and comes back, and the session must still be waiting.
  useEffect(() => {
    if (!showRemote) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRemote();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showRemote]);

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
      <div className="relative flex items-center h-11 max-lg:h-9 rounded-full bg-alien-panel/80 border border-alien-border pl-1 pr-2">
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
        {remoteAuthUrl && (
          <a
            href={remoteAuthUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute top-[calc(100%+10px)] right-0 z-30 text-xs font-mono text-alien-cyan underline bg-alien-deep/95 border border-alien-cyan/30 rounded-xl px-3 py-2 whitespace-nowrap"
          >
            Approve in your signer
          </a>
        )}
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
          onClick={() => {
            if (visibleError) {
              setErrorHidden(true);
              onCancelNip07?.();
              return;
            }
            if (askTerms("nip07")) return;
            onLoginNip07();
          }}
          className="h-11 px-4 text-sm font-semibold rounded-full max-lg:h-9 max-lg:px-3 max-lg:text-xs whitespace-nowrap bg-alien-purple hover:bg-alien-purple/90 text-white transition disabled:opacity-50 tracking-wide border border-alien-purple/50 shadow-[0_0_12px_rgba(177,78,255,0.25)]"
        >
          {loading ? "..." : <>NOSTR<span className="max-sm:hidden"> EXTENSION</span></>}
        </button>

        <button
          onClick={() => {
            if (showRemote) { closeRemote(); return; }
            if (!askTerms("remote")) openRemote();
          }}
          aria-expanded={showRemote}
          title="Log in with the Primal app or another Nostr remote signer. Your key stays on your phone."
          className={`h-11 px-4 text-sm font-semibold rounded-full border transition tracking-wide whitespace-nowrap max-lg:h-9 max-lg:px-3 max-lg:text-xs ${
            showRemote
              ? "bg-alien-panel border-alien-cyan/60 text-white"
              : "bg-alien-panel border-alien-cyan/30 text-alien-cyan hover:text-white hover:border-alien-cyan/60"
          }`}
        >
          <span className="max-sm:hidden">LOGIN WITH </span>PRIMAL
        </button>

        <button
          onClick={() => {
            if (showNsec) { setShowNsec(false); return; }
            if (askTerms("nsec")) return;
            if (showRemote) closeRemote();
            setShowNsec(true);
          }}
          aria-expanded={showNsec}
          className={`h-11 px-4 text-sm font-mono rounded-full border transition tracking-wide max-lg:h-9 max-lg:px-3 max-lg:text-xs ${
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
              Private key is saved in this browser until you log out. It is
              never sent to the server. An extension is still safer.
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
            {visibleError && (
              <p className="mt-2 text-xs text-red-400 font-mono leading-relaxed">
                {visibleError}
              </p>
            )}
          </div>
        </div>
      )}

      {showRemote && (
        <div className="absolute top-[calc(100%+10px)] right-0 w-[min(20rem,calc(100vw-1.5rem))] z-50">
          <div className="alien-panel rounded-xl border border-alien-cyan/30 shadow-glow p-3.5">
            <p className="text-[10px] font-mono tracking-[0.18em] uppercase text-alien-cyan">
              Remote login
            </p>
            <p className="mt-1.5 text-xs text-alien-muted font-mono leading-relaxed">
              Approve in Primal or another Nostr signer app. Your key stays on your phone.
            </p>

            {remote.phase === "waiting" && remote.via === "connect" && (
              <>
                {/* Phone: the QR code is the main way in; Open Primal is the shortcut. */}
                <button
                  type="button"
                  onClick={() => setQrOnPhone((v) => !v)}
                  className="mt-3 h-10 w-full rounded-md bg-alien-cyan text-alien-void text-sm font-semibold lg:hidden"
                >
                  {qrOnPhone ? "Hide QR code" : "Show QR code"}
                </button>
                <div className={`mt-3 flex justify-center ${qrOnPhone ? "" : "max-lg:hidden"}`}>
                  <div className="w-[200px] h-[200px] rounded-lg bg-white p-1.5 flex items-center justify-center">
                    {remoteQr ? (
                      <img src={remoteQr} alt="Scan with your signer app" className="w-full h-full" />
                    ) : (
                      <span className="text-[10px] font-mono text-black/50">…</span>
                    )}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-1.5 lg:grid-cols-1">
                  <a
                    href={remoteUri}
                    className="h-10 flex items-center justify-center rounded-md border border-alien-cyan/40 text-alien-cyan text-sm font-mono lg:hidden"
                  >
                    Open Primal
                  </a>
                  <button
                    type="button"
                    onClick={copyRemoteUri}
                    className="h-10 rounded-md border border-alien-border text-sm font-mono text-alien-muted hover:text-white"
                  >
                    {copied ? "Copied" : "Copy link"}
                  </button>
                </div>
                <p className="mt-2 text-[11px] font-mono text-alien-muted leading-relaxed lg:hidden">
                  If Open Primal fails, use the QR.
                </p>
              </>
            )}

            {remote.phase === "waiting" && (
              <div className="mt-3 flex items-center gap-2 text-xs font-mono text-white" role="status">
                <span className="inline-block w-3 h-3 rounded-full border-2 border-alien-cyan border-t-transparent animate-spin" />
                Waiting for approval…
              </div>
            )}

            {remoteAuthUrl && (
              <a
                href={remoteAuthUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-block text-xs font-mono text-alien-cyan underline"
              >
                Your signer asks you to approve here
              </a>
            )}

            {remote.phase === "resume" && (
              <p className="mt-3 text-xs text-white font-mono leading-relaxed">
                Your signer already approved Hold BTC here, but that login did not finish.
              </p>
            )}

            {remote.phase === "error" && (
              <p className="mt-3 text-xs text-red-400 font-mono leading-relaxed" role="alert">
                {remote.message}
              </p>
            )}

            {(remote.phase === "resume" || (remote.phase === "error" && remote.canResume)) && (
              <div className="mt-2 grid gap-1.5">
                <button
                  type="button"
                  onClick={() => onResumeRemote()}
                  className="h-10 w-full rounded-md bg-alien-cyan text-alien-void text-sm font-semibold"
                >
                  Resume previous session
                </button>
                <button
                  type="button"
                  onClick={() => onStartOverRemote()}
                  className="h-10 w-full rounded-md border border-alien-border text-sm font-mono text-alien-muted hover:text-white"
                >
                  Start over
                </button>
              </div>
            )}

            {remote.phase === "error" && !remote.canResume && (
              <button
                type="button"
                onClick={() => onLoginRemote()}
                className="mt-2 h-10 w-full rounded-md bg-alien-cyan text-alien-void text-sm font-semibold"
              >
                Try again
              </button>
            )}

            <div className="mt-3 pt-3 border-t border-alien-border/70">
              <p className="text-[11px] font-mono text-alien-muted mb-1.5">Or paste a bunker:// link</p>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  placeholder="bunker://..."
                  value={bunkerInput}
                  onChange={(e) => setBunkerInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitBunker();
                  }}
                  className="flex-1 min-w-0 bg-black/50 border border-alien-border rounded-md px-3 h-10 text-sm font-mono text-white placeholder:text-white/25 focus:outline-none focus:border-alien-cyan/60"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={submitBunker}
                  className="h-10 px-3 text-sm rounded-md border border-alien-cyan/40 text-alien-cyan font-mono"
                >
                  GO
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={closeRemote}
              className="mt-3 h-9 w-full rounded-md border border-alien-border text-xs font-mono text-alien-muted hover:text-white"
            >
              {remoteWaiting ? "Cancel" : "Close"}
            </button>
          </div>
        </div>
      )}

      {!showNsec && !showRemote && visibleError && (
        <div className="pointer-events-none absolute top-[calc(100%+10px)] right-0 z-30 max-w-[16rem] text-xs text-red-400 font-mono leading-relaxed bg-alien-deep/95 border border-red-500/20 rounded-xl px-3 py-2">
          <p>{visibleError}</p>
        </div>
      )}
    </div>

      {termsOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-xl border border-alien-border bg-alien-deep p-5 text-left shadow-glow">
            <p className="text-[10px] font-mono tracking-[0.18em] uppercase text-alien-cyan">Terms of Service</p>
            <h2 className="mt-2 text-lg text-white">Before you connect</h2>
            <p className="mt-3 text-sm text-alien-muted leading-relaxed">
              Hold BTC is an experimental project. Its aim is a fun way to fly through Bitcoin history. Use it carefully.
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
