export const ENTRY_FEE_SATS = 1000;

export interface InvoiceData {
  payment_hash: string;
  payment_request: string;
  amount: number;
  invoiceId?: string;
  claimSecret?: string;
}

export interface PaymentResult {
  success: boolean;
  method: "strike" | "none";
  error?: string;
  invoice?: InvoiceData;
}

export async function createInvoice(pubkey?: string, authEvent?: unknown): Promise<PaymentResult> {
  try {
    const res = await fetch("/api/invoice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pubkey, authEvent }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, method: "none", error: data.error || "Failed to create invoice" };
    }
    return {
      success: true,
      method: "strike",
      invoice: {
        payment_hash: data.payment_hash,
        payment_request: data.payment_request,
        amount: data.amount || ENTRY_FEE_SATS,
        invoiceId: data.invoiceId || data.payment_hash,
        claimSecret: data.claimSecret,
      },
    };
  } catch (err: any) {
    return { success: false, method: "none", error: err?.message || "Network error creating invoice" };
  }
}

export async function checkPayment(paymentHash: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/check-payment?hash=${encodeURIComponent(paymentHash)}`, {
      cache: "no-store",
    });
    const data = await res.json();
    return data.paid === true;
  } catch {
    return false;
  }
}

export async function claimRankedCredit(params: {
  invoiceId: string;
  pubkey: string;
  claimSecret: string;
  authEvent?: unknown;
}): Promise<{ token: string } | { error: string }> {
  try {
    const res = await fetch("/api/ranked-credit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok || !data.token) {
      return { error: data.error || "Could not claim ranked credit" };
    }
    return { token: data.token };
  } catch (err: any) {
    return { error: err?.message || "Network error claiming credit" };
  }
}

export async function submitAttestedScore(params: {
  token: string;
  score: number;
  distance: number;
}): Promise<{ eventId: string } | { error: string }> {
  try {
    const res = await fetch("/api/submit-score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!res.ok || !data.eventId) {
      return { error: data.error || "Could not submit score" };
    }
    return { eventId: data.eventId };
  } catch (err: any) {
    return { error: err?.message || "Network error submitting score" };
  }
}
