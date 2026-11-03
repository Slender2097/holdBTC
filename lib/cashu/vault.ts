import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "crypto";
import { cashuVaultKey } from "@/lib/cashu/config";

/**
 * The proofs the server receives for a ranked run are bearer money, so they are
 * never stored in plaintext: AES-256-GCM with CASHU_VAULT_KEY, the runId as
 * associated data (a sealed blob cannot be moved to another run's key).
 *
 * Format: "v1.<iv>.<ciphertext>.<tag>", each part base64url.
 */

export type StoredProof = { id: string; amount: number; secret: string; C: string };

function key(): Buffer {
  const k = cashuVaultKey();
  if (!k) throw new Error("CASHU_VAULT_KEY is missing or not 32 bytes");
  return k;
}

export function sealProofs(proofs: StoredProof[], runId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(runId));
  const ct = Buffer.concat([cipher.update(JSON.stringify(proofs), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), ct.toString("base64url"), tag.toString("base64url")].join(".");
}

export function openProofs(sealed: string, runId: string): StoredProof[] {
  const [v, iv, ct, tag] = sealed.split(".");
  if (v !== "v1" || !iv || !ct || !tag) throw new Error("Unknown vault format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(runId));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as StoredProof[];
}

/**
 * 64-byte NUT-13 seed for the server's own outputs of one run. Deterministic, so if
 * the mint signs but its reply is lost, a retry rebuilds the same outputs and gets
 * the signatures back with NUT-09 restore. Never leaves the server.
 */
export function serverSeedForRun(runId: string): Uint8Array {
  return new Uint8Array(createHmac("sha512", key()).update(`holdbtc-cashu-seed:${runId}`).digest());
}
