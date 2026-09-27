"use client";

import { useState } from "react";
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

  if (user) {
    const name =
      user.displayName ||
      user.profile?.display_name ||
      user.profile?.name ||
      null;
    const picture = safeHttpsImageUrl(user.profile?.picture);

    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2.5 bg-alien-panel/80 border border-alien-border rounded-full pl-1 pr-3 py-1">
          <div className="w-7 h-7 rounded-full overflow-hidden bg-alien-void border border-alien-cyan/30 shrink-0 flex items-center justify-center">
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
              <span className="text-[10px] font-bold text-alien-cyan">
                {(name || "H").charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0 hidden sm:block">
            <p className="text-xs font-medium text-white truncate max-w-[100px] leading-tight">
              {name || shortNpub(user.npub, 8)}
            </p>
          </div>
          <button
            onClick={onLogout}
            className="text-[10px] text-alien-muted hover:text-red-400 transition font-mono tracking-wide ml-1"
            title="Log out"
          >
            EXIT
          </button>
        </div>
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
    <div className="relative flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <button
          onClick={onLoginNip07}
          disabled={loading}
          className="px-3.5 py-1.5 text-xs font-semibold rounded-full bg-alien-purple hover:bg-alien-purple/90 text-white transition disabled:opacity-50 tracking-wide border border-alien-purple/50 shadow-[0_0_12px_rgba(177,78,255,0.25)]"
        >
          {loading ? "..." : "NOSTR EXTENSION"}
        </button>

        <button
          onClick={() => setShowNsec((v) => !v)}
          className="px-3 py-1.5 text-[11px] font-mono rounded-full bg-alien-panel border border-alien-border text-alien-muted hover:text-white hover:border-alien-cyan/40 transition tracking-wide"
        >
          NSEC
        </button>
      </div>

      {showNsec && (
        <div className="w-72 alien-panel rounded-xl border border-red-500/30 shadow-glow p-3 z-50">
          <p className="text-[10px] text-red-300/90 font-mono leading-relaxed mb-2">
            Private key stays in memory only. Prefer an extension.
          </p>
          <div className="flex gap-1.5">
            <input
              type="password"
              placeholder="nsec1..."
              value={nsecInput}
              onChange={(e) => setNsecInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleNsecSubmit();
              }}
              className="flex-1 bg-black/50 border border-red-500/30 rounded-md px-2.5 py-1.5 text-[11px] font-mono text-white placeholder:text-white/25 focus:outline-none focus:border-red-400/60"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              onClick={handleNsecSubmit}
              className="px-2.5 py-1.5 text-[11px] rounded-md bg-red-600 hover:bg-red-500 text-white font-mono transition"
            >
              GO
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-[11px] text-red-400 font-mono">{error}</p>
      )}
    </div>
  );
}
