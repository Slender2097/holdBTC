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
const SESSION_SK_KEY = "holdbtc_nsec_sk";

function skToHex(sk: Uint8Array): string {
  return Array.from(sk)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToSk(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length !== 64) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function saveSessionSk(sk: Uint8Array) {
  try {
    sessionStorage.setItem(SESSION_SK_KEY, skToHex(sk));
  } catch {
    /* ignore */
  }
}

function loadSessionSk(): Uint8Array | null {
  try {
    const raw = sessionStorage.getItem(SESSION_SK_KEY);
    if (!raw) return null;
    return hexToSk(raw);
  } catch {
    return null;
  }
}

function clearSessionSk() {
  try {
    sessionStorage.removeItem(SESSION_SK_KEY);
  } catch {
    /* ignore */
  }
}

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
  clearSessionSk();
}

export function useNostr() {
  const [user, setUser] = useState<NostrUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const skRef = useRef<Uint8Array | null>(null);
  const nip07Attempt = useRef(0);

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
          const pk = await Promise.race([
        getNip07PublicKey(),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("Extension login was closed. Try again.")), 8000)
        ),
      ]);
          if (!pk || pk !== saved.pubkey) {
            clearUserStorage();
            return;
          }
          skRef.current = null;
          clearSessionSk();
        }

        if (saved.mode === "nsec" || saved.mode === "ephemeral") {
          const sk = loadSessionSk();
          if (!sk) {
            clearUserStorage();
            return;
          }
          const pk = getPublicKey(sk);
          if (pk !== saved.pubkey) {
            sk.fill(0);
            clearUserStorage();
            return;
          }
          skRef.current = sk;
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

  const cancelNip07 = useCallback(() => {
    nip07Attempt.current += 1;
    setLoading(false);
    setError(null);
  }, []);

  const loginWithNip07 = useCallback(async () => {
    const attempt = ++nip07Attempt.current;
    setError(null);
    setLoading(true);
    try {
      const pk = await getNip07PublicKey();
      if (attempt !== nip07Attempt.current) return;
      if (!pk) {
        throw new Error("Login cancelled in the extension");
      }
      skRef.current = null;
      clearSessionSk();
      const next: NostrUser = {
        pubkey: pk,
        npub: toNpub(pk),
        mode: "nip07",
      };
      setUser(next);
      saveUserToStorage(next);
      loadProfile(pk);
    } catch (e: any) {
      if (attempt !== nip07Attempt.current) return;
      const msg = String(e?.message || e || "");
      if (/reject|denied|cancel/i.test(msg)) {
        setError("Login cancelled in the extension");
      } else {
        setError(msg || "Login failed");
      }
    } finally {
      if (attempt === nip07Attempt.current) setLoading(false);
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
      saveSessionSk(sk);

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
    saveSessionSk(sk);
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
        throw new Error("Paste your nsec again to sign. This tab no longer has the key.");
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
    cancelNip07,
    loginWithNsec,
    loginEphemeral,
    logout,
    signEvent,
    publishScore,
    publishNote,
    isLoggedIn: !!user,
  };
}
