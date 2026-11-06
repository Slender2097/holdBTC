"use client";

import NostrLogin from "@/components/NostrLogin";
import type { NostrUser, RemoteLoginState } from "@/hooks/useNostr";

interface HeaderProps {
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

export default function Header({
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
}: HeaderProps) {
  return (
    <header className="site-header sticky top-0 z-40 h-24 shrink-0">
      <div className="absolute inset-0 bg-alien-deep/90 backdrop-blur-xl" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-alien-cyan/35 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-alien-border/80" />

      <div className="relative h-full max-w-5xl mx-auto px-4 flex items-center justify-between gap-4 max-lg:px-3 max-lg:gap-2">
        <a href="/" className="flex items-center gap-3.5 min-w-0 max-lg:gap-2.5">
          <div className="w-12 h-12 max-lg:w-9 max-lg:h-9 shrink-0 rounded-lg bg-alien-panel border border-alien-cyan/30 flex items-center justify-center shadow-glow">
            <span className="text-alien-cyan font-bold text-lg tracking-tight max-lg:text-sm">
              HB
            </span>
          </div>
          {/* Logged out on a narrow phone, three login buttons need the room: the HB badge stays. */}
          <div className={user ? "min-w-0" : "min-w-0 max-[379px]:hidden"}>
            <h1 className="font-bold text-2xl tracking-widest leading-none text-white max-lg:text-lg">
              HOLD<span className="text-alien-cyan">BTC</span>
            </h1>
            <p className="text-xs text-alien-muted tracking-[0.22em] uppercase mt-1.5 truncate max-lg:hidden">
              holdbtc.io
            </p>
          </div>
        </a>
        <NostrLogin
          user={user}
          loading={loading}
          error={error}
          onLoginNip07={onLoginNip07}
          onCancelNip07={onCancelNip07}
          onLoginNsec={onLoginNsec}
          remote={remote}
          remoteAuthUrl={remoteAuthUrl}
          onLoginRemote={onLoginRemote}
          onResumeRemote={onResumeRemote}
          onStartOverRemote={onStartOverRemote}
          onLoginBunker={onLoginBunker}
          onCancelRemote={onCancelRemote}
          onLogout={onLogout}
        />
      </div>
    </header>
  );
}
