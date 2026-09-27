import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export type InvoiceRecord = {
  invoiceId: string;
  pubkey: string;
  issuedAt: number;
  submittedAt: number | null;
};

const memory = new Map<string, InvoiceRecord>();

function filePath(): string {
  return process.env.INVOICE_STORE_PATH || join(process.cwd(), "data", "used-invoices.json");
}

function persistBestEffort() {
  try {
    const invoices: Record<string, InvoiceRecord> = {};
    for (const [id, rec] of memory) invoices[id] = rec;
    const path = filePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ invoices }, null, 2));
  } catch (err) {
    console.error("invoice store persist failed (memory still authoritative):", err);
  }
}

function hydrate() {
  if (memory.size > 0) return;
  try {
    const path = filePath();
    if (!existsSync(path)) return;
    const data = JSON.parse(readFileSync(path, "utf8")) as { invoices?: Record<string, InvoiceRecord> };
    for (const [id, rec] of Object.entries(data.invoices || {})) memory.set(id, rec);
  } catch (err) {
    console.error("invoice store load failed:", err);
  }
}

export function getInvoiceRecord(invoiceId: string): InvoiceRecord | null {
  hydrate();
  return memory.get(invoiceId) || null;
}

/** Atomic on this process. Returns true only for the first issuer. */
export function tryMarkIssued(invoiceId: string, pubkey: string): boolean {
  hydrate();
  if (memory.has(invoiceId)) return false;
  memory.set(invoiceId, {
    invoiceId,
    pubkey: pubkey.toLowerCase(),
    issuedAt: Date.now(),
    submittedAt: null,
  });
  persistBestEffort();
  return true;
}

/** Atomic on this process. Returns true only for the first submit of that invoice+pubkey. */
export function tryMarkSubmitted(invoiceId: string, pubkey: string): boolean {
  hydrate();
  const existing = memory.get(invoiceId);
  if (!existing) return false;
  if (existing.pubkey !== pubkey.toLowerCase()) return false;
  if (existing.submittedAt) return false;
  existing.submittedAt = Date.now();
  persistBestEffort();
  return true;
}
