"use client";

import NostrLogin from "@/components/NostrLogin";
import type { NostrUser } from "@/hooks/useNostr";

interface HeaderProps {
  user: NostrUser | null;
  loading: boolean;
  error: string | null;
  onLoginNip07: () => void;
  onLoginNsec: (nsec: string) => boolean;
  onLogout: () => void;
}

export default function Header({
  user,
  loading,
  error,
  onLoginNip07,
  onLoginNsec,
  onLogout,
}: HeaderProps) {
  return (
    <header className="site-header sticky top-0 z-40 h-24 shrink-0">
      <div className="absolute inset-0 bg-alien-deep/90 backdrop-blur-xl" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-alien-cyan/35 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-alien-border/80" />

      <div className="relative h-full max-w-5xl mx-auto px-4 flex items-center justify-between gap-4">
        <a href="/" className="flex items-center gap-3.5 min-w-0">
          <div className="w-12 h-12 rounded-lg bg-alien-panel border border-alien-cyan/30 flex items-center justify-center shadow-glow">
            <span className="text-alien-cyan font-bold text-lg tracking-tight">
              HB
            </span>
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-2xl tracking-widest leading-none text-white">
              HOLD<span className="text-alien-cyan">BTC</span>
            </h1>
            <p className="text-xs text-alien-muted tracking-[0.22em] uppercase mt-1.5 truncate">
              holdbtc.io
            </p>
          </div>
        </a>

        <NostrLogin
          user={user}
          loading={loading}
          error={error}
          onLoginNip07={onLoginNip07}
          onLoginNsec={onLoginNsec}
          onLogout={onLogout}
        />
      </div>
    </header>
  );
}
