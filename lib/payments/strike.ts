import { isSafeInvoiceId } from "@/lib/security/rankedToken";

const STRIKE_API_URL = (process.env.STRIKE_API_URL || "https://api.strike.me").replace(/\/$/, "");
const STRIKE_API_KEY = process.env.STRIKE_API_KEY;

export function strikeConfigured(): boolean {
  return !!STRIKE_API_KEY;
}

function headers(): HeadersInit {
  return {
    Authorization: `Bearer ${STRIKE_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export async function strikeCreateInvoice(amountSats: number, description: string) {
  if (!STRIKE_API_KEY) throw new Error("Strike is not configured");

  const btc = (amountSats / 100_000_000).toFixed(8);

  const invoiceRes = await fetch(`${STRIKE_API_URL}/v1/invoices`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      description,
      amount: { amount: btc, currency: "BTC" },
    }),
  });

  if (!invoiceRes.ok) {
    const text = await invoiceRes.text();
    console.error("Strike create invoice error:", text);
    throw new Error("Failed to create invoice");
  }

  const invoice = await invoiceRes.json();
  const invoiceId: string = invoice.invoiceId;
  if (!isSafeInvoiceId(invoiceId)) {
    throw new Error("Strike returned an invalid invoice id");
  }

  const quoteRes = await fetch(
    `${STRIKE_API_URL}/v1/invoices/${encodeURIComponent(invoiceId)}/quote`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIKE_API_KEY}`,
        Accept: "application/json",
        "Content-Length": "0",
      },
    }
  );

  if (!quoteRes.ok) {
    const text = await quoteRes.text();
    console.error("Strike quote error:", text);
    throw new Error("Failed to generate quote");
  }

  const quote = await quoteRes.json();

  return {
    invoiceId,
    payment_request: quote.lnInvoice as string,
    amountSats,
    state: invoice.state as string,
  };
}

export async function strikeGetInvoice(invoiceId: string): Promise<{
  paid: boolean;
  state: string;
  amountSats: number | null;
}> {
  if (!STRIKE_API_KEY) throw new Error("Strike is not configured");

  if (!isSafeInvoiceId(invoiceId)) {
    return { paid: false, state: "INVALID_ID", amountSats: null };
  }

  const res = await fetch(`${STRIKE_API_URL}/v1/invoices/${encodeURIComponent(invoiceId)}`, {
    headers: {
      Authorization: `Bearer ${STRIKE_API_KEY}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    return { paid: false, state: "UNKNOWN", amountSats: null };
  }

  const data = await res.json();
  const state = String(data.state || "").toUpperCase();
  const btc = parseFloat(data.amount?.amount || "0");
  const amountSats = Number.isFinite(btc) ? Math.round(btc * 100_000_000) : null;

  return {
    paid: state === "PAID",
    state,
    amountSats,
  };
}
