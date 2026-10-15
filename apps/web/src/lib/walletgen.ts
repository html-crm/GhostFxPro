/**
 * Client-side wallet generation.
 *
 * Keys are created in the browser and returned once for the user to back up.
 * They are never sent to the server: GhostFxPro stays non-custodial and stores
 * no key material. This module is pure (no imports from Node or Next), so it
 * runs in the browser and in tests.
 */

import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

export type Chain = "SOLANA" | "BNB";

export interface GeneratedWallet {
  chain: Chain;
  /** Public address (base58 for Solana, 0x-checksummed for BNB). */
  address: string;
  /**
   * Secret key — shown once, never stored. Base58 (Solana, Phantom-compatible
   * 64-byte form) or 0x-prefixed hex (BNB).
   */
  privateKey: string;
}

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58_ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  return "1".repeat(zeros) + out;
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** EIP-55 mixed-case checksum for an EVM address. */
export function evmChecksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(lower)) {
    throw new Error("invalid EVM address");
  }
  const hash = toHex(keccak_256(new TextEncoder().encode(lower)));
  let out = "0x";
  for (let i = 0; i < lower.length; i++) {
    out += parseInt(hash[i]!, 16) >= 8 ? lower[i]!.toUpperCase() : lower[i]!;
  }
  return out;
}

/** Solana keypair from a 32-byte seed (defaults to a fresh random one). */
export function generateSolanaWallet(seed?: Uint8Array): {
  address: string;
  privateKey: string;
} {
  const s = seed ?? randomBytes(32);
  if (s.length !== 32) throw new Error("solana seed must be 32 bytes");
  const pub = ed25519.getPublicKey(s);
  const secret = new Uint8Array(64);
  secret.set(s, 0);
  secret.set(pub, 32);
  return { address: base58Encode(pub), privateKey: base58Encode(secret) };
}

/** BNB (secp256k1) keypair from a 32-byte private key (defaults to random). */
export function generateEvmWallet(privateKey?: Uint8Array): {
  address: string;
  privateKey: string;
} {
  const pk = privateKey ?? randomBytes(32);
  if (pk.length !== 32) throw new Error("evm private key must be 32 bytes");
  const pub = secp256k1.getPublicKey(pk, false);
  const addressBytes = keccak_256(pub.slice(1)).slice(12);
  return {
    address: evmChecksumAddress(`0x${toHex(addressBytes)}`),
    privateKey: `0x${toHex(pk)}`,
  };
}

export function generateWallet(chain: Chain): GeneratedWallet {
  if (chain === "SOLANA") {
    const { address, privateKey } = generateSolanaWallet();
    return { chain, address, privateKey };
  }
  const { address, privateKey } = generateEvmWallet();
  return { chain, address, privateKey };
}
