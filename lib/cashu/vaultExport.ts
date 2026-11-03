import "server-only";
import { getEncodedToken, normalizeProofAmounts, type Proof } from "@cashu/cashu-ts";
import { cashuConfigured, cashuMintUrl } from "@/lib/cashu/config";
import { mintWallet } from "@/lib/cashu/redeem";
import { storeGet, storeList } from "@/lib/cashu/store";
import { openProofs, type StoredProof } from "@/lib/cashu/vault";

/**
 * Read-only view of the Cashu vault for /admin/cashu. Same steps as
 * scripts/cashu-vault-export.mjs:
 *
 *   1. read every runId in cashu:vault:index and its sealed entry
 *   2. open each entry with CASHU_VAULT_KEY (AES-256-GCM, runId as associated data)
 *   3. ask the allowlisted mint (NUT-07 checkstate) which proofs are UNSPENT
 *   4. encode only the UNSPENT ones as one cashuB token
 *
 * Nothing is ever deleted or rewritten. Spent and pending proofs are skipped, so once
 * a token has been received in a wallet, the next export no longer includes those sats.
 */

export type VaultSummary = {
  runs: number;
  proofs: number;
  totalSats: number;
  unspentProofs: number;
  unspentSats: number;
  spentProofs: number;
  pendingProofs: number;
  /** Entries that are in the index but missing or could not be opened with this key. */
  unreadableRuns: number;
};

export class VaultError extends Error {
  constructor(
    message: string,
    readonly code: "not_configured" | "store_down" | "mint_down"
  ) {
    super(message);
  }
}

const amountOf = (p: StoredProof) => Number(p.amount) || 0;

async function loadVaultProofs(): Promise<{ runs: number; proofs: StoredProof[]; unreadableRuns: number }> {
  let ids: string[];
  try {
    ids = [...new Set(await storeList("cashu:vault:index"))];
  } catch (err) {
    console.error("cashu admin: vault index read failed:", err);
    throw new VaultError("Could not read the vault store.", "store_down");
  }

  const proofs: StoredProof[] = [];
  let runs = 0;
  let unreadableRuns = 0;
  const BATCH = 25;
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH);
    let sealed: (string | null)[];
    try {
      sealed = await Promise.all(chunk.map((id) => storeGet(`cashu:vault:${id}`)));
    } catch (err) {
      console.error("cashu admin: vault read failed:", err);
      throw new VaultError("Could not read the vault store.", "store_down");
    }
    chunk.forEach((runId, j) => {
      const blob = sealed[j];
      if (!blob) {
        unreadableRuns += 1;
        return;
      }
      try {
        proofs.push(...openProofs(blob, runId));
        runs += 1;
      } catch {
        // Wrong CASHU_VAULT_KEY, or a damaged entry. Counted, never touched.
        unreadableRuns += 1;
      }
    });
  }
  return { runs, proofs, unreadableRuns };
}

async function checkVault(): Promise<{ summary: VaultSummary; unspent: StoredProof[] }> {
  if (!cashuConfigured()) throw new VaultError("Cashu is not configured.", "not_configured");

  const { runs, proofs, unreadableRuns } = await loadVaultProofs();
  let states: string[] = [];
  if (proofs.length) {
    try {
      const wallet = await mintWallet();
      const res = await wallet.checkProofsStates(normalizeProofAmounts(proofs));
      states = res.map((s) => String(s.state));
    } catch (err) {
      console.error("cashu admin: checkstate failed:", err);
      throw new VaultError("The mint did not answer. Try again.", "mint_down");
    }
  }

  const unspent = proofs.filter((_, i) => states[i] === "UNSPENT");
  return {
    unspent,
    summary: {
      runs,
      proofs: proofs.length,
      totalSats: proofs.reduce((s, p) => s + amountOf(p), 0),
      unspentProofs: unspent.length,
      unspentSats: unspent.reduce((s, p) => s + amountOf(p), 0),
      spentProofs: states.filter((s) => s === "SPENT").length,
      pendingProofs: states.filter((s) => s === "PENDING").length,
      unreadableRuns,
    },
  };
}

export async function vaultSummary(): Promise<VaultSummary> {
  return (await checkVault()).summary;
}

/** One cashuB token with every UNSPENT vault proof, or null when there is nothing to export. */
export async function exportVaultToken(): Promise<{ token: string | null; summary: VaultSummary }> {
  const { summary, unspent } = await checkVault();
  const mint = cashuMintUrl();
  if (!unspent.length || !mint) return { token: null, summary };
  const proofs: Proof[] = normalizeProofAmounts(unspent);
  return { token: getEncodedToken({ mint, unit: "sat", proofs }), summary };
}
