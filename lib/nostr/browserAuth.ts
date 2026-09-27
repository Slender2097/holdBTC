"use client";

import type { Event, EventTemplate } from "nostr-tools";

const AUTH_KIND = 22242;

export type AuthSigner = (template: EventTemplate) => Promise<Event>;

export async function signRankedAuth(params: {
  pubkey: string;
  scope: "invoice" | "credit";
  invoiceId?: string;
  signEvent?: AuthSigner;
}): Promise<Event> {
  const qs = new URLSearchParams({
    pubkey: params.pubkey,
    scope: params.scope,
  });
  if (params.invoiceId) qs.set("invoiceId", params.invoiceId);

  const res = await fetch(`/api/challenge?${qs.toString()}`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok || !data.challenge) {
    throw new Error(data.error || "Could not get auth challenge");
  }

  const template: EventTemplate = {
    kind: AUTH_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["u", typeof window !== "undefined" ? window.location.origin : ""],
      ["scope", params.scope],
      ...(params.invoiceId ? [["invoice", params.invoiceId]] : []),
    ],
    content: data.challenge,
  };

  if (params.signEvent) {
    const signed = await params.signEvent(template);
    if (signed?.pubkey && signed.pubkey.toLowerCase() !== params.pubkey.toLowerCase()) {
      throw new Error("Signed key does not match the logged-in Nostr user");
    }
    return signed;
  }

  const nostr = (window as any).nostr;
  if (nostr?.signEvent) {
    const signed = await nostr.signEvent(template);
    if (signed?.pubkey && signed.pubkey.toLowerCase() !== params.pubkey.toLowerCase()) {
      throw new Error("Extension account does not match the logged-in Nostr user");
    }
    return signed as Event;
  }

  throw new Error("Use a Nostr extension, or login again with nsec.");
}
