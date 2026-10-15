import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base58Encode,
  evmChecksumAddress,
  generateEvmWallet,
  generateSolanaWallet,
  generateWallet,
} from "./walletgen.ts";

const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const SOL_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function base58Decode(s: string): Uint8Array {
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  let n = 0n;
  for (const ch of s) {
    const idx = B58_ALPHABET.indexOf(ch);
    assert.notEqual(idx, -1, `bad base58 char ${ch}`);
    n = n * 58n + BigInt(idx);
  }
  const out: number[] = [];
  while (n > 0n) {
    out.unshift(Number(n % 256n));
    n /= 256n;
  }
  return new Uint8Array([...new Array(zeros).fill(0), ...out]);
}

test("base58Encode handles leading zeros", () => {
  assert.equal(base58Encode(new Uint8Array([0])), "1");
  assert.equal(base58Encode(new Uint8Array([0, 0, 0])), "111");
  assert.equal(base58Encode(new Uint8Array(0)), "");
});

test("base58Encode round-trips through decode", () => {
  for (const bytes of [
    new Uint8Array([1, 2, 3, 4, 5]),
    new Uint8Array([0, 0, 255, 128, 0, 7]),
    new Uint8Array(32).fill(0xab),
  ]) {
    assert.deepEqual(Array.from(base58Decode(base58Encode(bytes))), Array.from(bytes));
  }
});

// Known-vector: 32 zero-except-one seed -> Solana keypair (verified independently).
const SOL_SEED = new Uint8Array(32).fill(1);
const SOL_ADDRESS = "AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9";

test("generateSolanaWallet derives a deterministic, valid address", () => {
  const { address, privateKey } = generateSolanaWallet(SOL_SEED);
  assert.equal(address, SOL_ADDRESS);
  assert.match(address, SOL_ADDRESS_RE);

  const secret = base58Decode(privateKey);
  assert.equal(secret.length, 64);
  assert.deepEqual(Array.from(secret.slice(0, 32)), Array.from(SOL_SEED));
  // Secret = seed || pubkey; pubkey must re-encode to the address.
  assert.equal(base58Encode(secret.slice(32)), address);
});

test("generateSolanaWallet rejects a wrong-length seed", () => {
  assert.throws(() => generateSolanaWallet(new Uint8Array(16)));
});

// Known-vector: 0x46 x 32 -> 0x9d8A62f656a8d1615C1294fd71e9CFb3E4855A4F (widely published).
const EVM_PRIV = new Uint8Array(32).fill(0x46);
const EVM_ADDRESS = "0x9d8A62f656a8d1615C1294fd71e9CFb3E4855A4F";

test("generateEvmWallet derives the published address", () => {
  const { address, privateKey } = generateEvmWallet(EVM_PRIV);
  assert.equal(address, EVM_ADDRESS);
  assert.match(address, EVM_ADDRESS_RE);
  assert.equal(privateKey, "0x" + "46".repeat(32));
});

test("generateEvmWallet rejects a wrong-length key", () => {
  assert.throws(() => generateEvmWallet(new Uint8Array(31)));
});

test("evmChecksumAddress matches the EIP-55 test vectors", () => {
  for (const v of [
    "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
    "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
    "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
    "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
  ]) {
    assert.equal(evmChecksumAddress(v.toLowerCase()), v);
  }
});

test("generateWallet returns fresh, chain-correct keypairs", () => {
  const sol = generateWallet("SOLANA");
  assert.equal(sol.chain, "SOLANA");
  assert.match(sol.address, SOL_ADDRESS_RE);

  const bnb = generateWallet("BNB");
  assert.equal(bnb.chain, "BNB");
  assert.match(bnb.address, EVM_ADDRESS_RE);

  // Two generates must not collide.
  assert.notEqual(generateWallet("BNB").address, generateWallet("BNB").address);
});
