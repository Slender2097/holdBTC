"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createEphemeralKey,
  fetchProfiles,
  getNip07PublicKey,
  publishScore as publishScoreEvent,
  publishNote as publishNoteEvent,
  type NostrProfile,
} from "@/lib/nostr/client";
import { parseNsec, toNpub } from "@/lib/nostr/utils";
import { finalizeEvent, getPublicKey, type Event, type EventTemplate } from "nostr-tools";

export type AuthMode = "none" | "nip07" | "nsec" | "ephemeral";

export interface NostrUser {
  pubkey: string;
  npub: string;
  mode: AuthMode;
  profile?: NostrProfile;
  displayName?: string;
}

const STORAGE_KEY = "holdbtc_nostr_user";

function saveUserToStorage(user: NostrUser) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        pubkey: user.pubkey,
        npub: user.npub,
        mode: user.mode,
      })
    );
  } catch {
    /* ignore */
  }
}

function loadUserFromStorage(): Omit<NostrUser, "profile" | "displayName"> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.pubkey && data?.npub && data?.mode) {
      return {
        pubkey: data.pubkey,
        npub: data.npub,
        mode: data.mode as AuthMode,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function clearUserStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function useNostr() {
  const [user, setUser] = useState<NostrUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const skRef = useRef<Uint8Array | null>(null);

  const loadProfile = useCallback(async (pubkey: string) => {
    try {
      const profiles = await fetchProfiles([pubkey]);
      const profile = profiles.get(pubkey);
      if (profile) {
        setUser((prev) =>
          prev && prev.pubkey === pubkey
            ? {
                ...prev,
                profile,
                displayName: profile.display_name || profile.name || undefined,
              }
            : prev
        );
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const saved = loadUserFromStorage();
        if (!saved || cancelled) return;

        if (saved.mode === "nip07") {
          const pk = await getNip07PublicKey();
          if (!pk || pk !== saved.pubkey) {
            clearUserStorage();
            return;
          }
          skRef.current = null;
        }

        if (!cancelled) {
          setUser(saved);
          loadProfile(saved.pubkey);
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadProfile]);

  const loginWithNip07 = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const pk = await getNip07PublicKey();
      if (!pk) {
        throw new Error(
          "Extension login failed or was cancelled. Approve the popup to continue."
        );
      }
      skRef.current = null;
      const next: NostrUser = {
        pubkey: pk,
        npub: toNpub(pk),
        mode: "nip07",
      };
      setUser(next);
      saveUserToStorage(next);
      loadProfile(pk);
    } catch (e: any) {
      const msg = String(e?.message || e || "");
      if (/reject|denied|cancel/i.test(msg)) {
        setError("Login cancelled in the extension");
      } else {
        setError(msg || "Login failed");
      }
    } finally {
      setLoading(false);
    }
  }, [loadProfile]);

  const loginWithNsec = useCallback(
    (nsecOrHex: string) => {
      setError(null);
      const sk = parseNsec(nsecOrHex);
      if (!sk) {
        setError("Invalid nsec or hex private key");
        return false;
      }

      const pk = getPublicKey(sk);
      skRef.current = sk;

      const next: NostrUser = {
        pubkey: pk,
        npub: toNpub(pk),
        mode: "nsec",
      };
      setUser(next);
      saveUserToStorage(next);
      loadProfile(pk);
      return true;
    },
    [loadProfile]
  );

  const loginEphemeral = useCallback(() => {
    const { sk, pk, npub } = createEphemeralKey();
    skRef.current = sk;
    const next: NostrUser = { pubkey: pk, npub, mode: "ephemeral" };
    setUser(next);
    saveUserToStorage(next);
    setError(null);
  }, []);

  const logout = useCallback(() => {
    if (skRef.current) {
      skRef.current.fill(0);
      skRef.current = null;
    }
    setUser(null);
    setError(null);
    clearUserStorage();
  }, []);

  const signEvent = useCallback(
    async (template: EventTemplate): Promise<Event> => {
      if (skRef.current) {
        return finalizeEvent(template, skRef.current);
      }

      if (user?.mode === "nsec" || user?.mode === "ephemeral") {
        throw new Error("Paste your nsec again to pay. It is not kept after reload.");
      }

      const nostr = typeof window !== "undefined" ? (window as any).nostr : null;
      if (nostr?.signEvent) {
        return nostr.signEvent(template);
      }
      throw new Error("Use a Nostr extension, or login again with nsec.");
    },
    [user?.mode]
  );

  const publishScore = useCallback(
    async (score: number, distance: number) => {
      if (!user) return null;
      if (user.mode !== "nip07" && !skRef.current) {
        setError("Session key missing. Login again with nsec to publish.");
        return null;
      }
      return publishScoreEvent({
        score,
        distance,
        sk: user.mode === "nip07" ? null : skRef.current,
      });
    },
    [user]
  );

  const publishNote = useCallback(
    async (score: number, distance: number) => {
      if (!user) return null;
      if (user.mode !== "nip07" && !skRef.current) {
        setError("Session key missing. Login again with nsec to publish.");
        return null;
      }
      return publishNoteEvent({
        score,
        distance,
        sk: user.mode === "nip07" ? null : skRef.current,
      });
    },
    [user]
  );

  return {
    user,
    loading,
    error,
    loginWithNip07,
    loginWithNsec,
    loginEphemeral,
    logout,
    signEvent,
    publishScore,
    publishNote,
    isLoggedIn: !!user,
  };
}
