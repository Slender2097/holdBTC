// Prints the ecash the server collected for Cashu ranked runs as one Cashu token,
// so the operator can receive it in any Cashu wallet (or melt it to Lightning).
// Read-only: it never deletes vault entries. Once you have received the token,
// those proofs are spent and the next export shows them as SPENT.
//
// Usage (reads .env.local, or the same vars from the environment):
//   node --env-file=.env.local scripts/cashu-vault-export.mjs
//
// Needs CASHU_VAULT_KEY and CASHU_MINT_URL. With UPSTASH_REDIS_REST_URL/TOKEN
// (or KV_REST_API_URL/TOKEN) it reads Redis; without them it reads the next dev
// store, data/cashu-dev-store.json.
import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { Wallet, getEncodedToken, normalizeProofAmounts } from "@cashu/cashu-ts";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function vaultKey() {
  const raw = (process.env.CASHU_VAULT_KEY || "").trim();
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("CASHU_VAULT_KEY must be 32 bytes (64 hex chars or base64)");
  return key;
}

function open(sealed, runId, key) {
  const [v, iv, ct, tag] = sealed.split(".");
  if (v !== "v1") throw new Error("Unknown vault format");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from(runId));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8"));
}

async function loadEntries() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    const call = async (cmd) => {
      const res = await fetch(url.replace(/\/+$/, ""), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(cmd),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(`Redis: ${data.error || res.status}`);
      return data.result;
    };
    const ids = [...new Set((await call(["LRANGE", "cashu:vault:index", "0", "-1"])) || [])];
    const out = [];
    for (const id of ids) {
      const sealed = await call(["GET", `cashu:vault:${id}`]);
      if (sealed) out.push([id, sealed]);
    }
    return out;
  }
  const file = path.join(ROOT, "data", "cashu-dev-store.json");
  const db = JSON.parse(readFileSync(file, "utf8"));
  return Object.entries(db)
    .filter(([k]) => k.startsWith("cashu:vault:") && k !== "cashu:vault:index")
    .map(([k, e]) => [k.slice("cashu:vault:".length), e.v]);
}

const key = vaultKey();
const mintUrl = process.env.CASHU_MINT_URL;
if (!mintUrl) throw new Error("CASHU_MINT_URL is not set");

const entries = await loadEntries();
const proofs = entries.flatMap(([runId, sealed]) => open(sealed, runId, key));
const wallet = new Wallet(mintUrl, { unit: "sat" });
await wallet.loadMint();
const states = proofs.length ? await wallet.checkProofsStates(proofs) : [];
const unspent = proofs.filter((_, i) => String(states[i]?.state) === "UNSPENT");
const total = unspent.reduce((s, p) => s + p.amount, 0);

console.error(`${entries.length} runs, ${proofs.length} proofs, ${unspent.length} unspent = ${total} sats`);
if (unspent.length) {
  console.log(getEncodedToken({ mint: mintUrl, unit: "sat", proofs: normalizeProofAmounts(unspent) }));
}
