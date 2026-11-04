/**
 * Cryptography that works everywhere the app can be opened.
 *
 * Browsers expose WebCrypto (`crypto.subtle`) only in secure contexts: HTTPS, or `localhost`.
 * Opening the dev server from a phone on the local network (`http://192.168.x.x:5173`) is not
 * a secure context, so `crypto.subtle` is undefined there. These helpers use WebCrypto when it
 * exists and otherwise the audited pure-JavaScript @noble libraries. Both give byte-identical
 * results, which the tests check, so hashes made one way verify the other way.
 */
import { p256 } from "@noble/curves/nist";
import { pbkdf2Async } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha2";

const subtle = (): SubtleCrypto | undefined => (globalThis.crypto as Crypto | undefined)?.subtle;

/** Pure-JavaScript implementations (exported for tests and for insecure contexts). */
export const fallback = {
  sha256: (data: Uint8Array): Uint8Array => sha256(data),
  pbkdf2Sha256: (password: Uint8Array, salt: Uint8Array, iterations: number, bytes: number): Promise<Uint8Array> => pbkdf2Async(sha256, password, salt, { c: iterations, dkLen: bytes }),
  /** ECDSA P-256 / SHA-256 verification of a raw (r‖s, 64-byte) signature with an SPKI public key. */
  ecdsaP256Verify(spki: Uint8Array, signature: Uint8Array, message: Uint8Array): boolean {
    const point = spkiP256Point(spki);
    if (signature.length !== 64) return false;
    try {
      return p256.verify(signature, sha256(message), point, { prehash: false, lowS: false, format: "compact" });
    } catch {
      return false;
    }
  },
};

/** DER header of a P-256 SubjectPublicKeyInfo; the 65-byte uncompressed point follows it. */
const P256_SPKI_HEADER = [0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00];

function spkiP256Point(spki: Uint8Array): Uint8Array {
  if (spki.length !== P256_SPKI_HEADER.length + 65 || !P256_SPKI_HEADER.every((b, i) => spki[i] === b) || spki[P256_SPKI_HEADER.length] !== 0x04) {
    throw new Error("not a P-256 public key");
  }
  return spki.slice(P256_SPKI_HEADER.length);
}

export async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  const s = subtle();
  return s ? new Uint8Array(await s.digest("SHA-256", data as BufferSource)) : fallback.sha256(data);
}

export async function pbkdf2Sha256(password: Uint8Array, salt: Uint8Array, iterations: number, bytes: number): Promise<Uint8Array> {
  const s = subtle();
  if (!s) return fallback.pbkdf2Sha256(password, salt, iterations, bytes);
  const key = await s.importKey("raw", password as BufferSource, "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await s.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, bytes * 8));
}

export async function ecdsaP256Verify(spki: Uint8Array, signature: Uint8Array, message: Uint8Array): Promise<boolean> {
  const s = subtle();
  if (!s) return fallback.ecdsaP256Verify(spki, signature, message);
  const key = await s.importKey("spki", spki as BufferSource, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  return s.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature as BufferSource, message as BufferSource);
}

/** Random bytes: `getRandomValues` exists in every context, secure or not. */
export function randomBytes(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

/** Signing and key generation are vendor-side operations (Node.js), where WebCrypto always exists. */
export function requireSubtle(what: string): SubtleCrypto {
  const s = subtle();
  if (!s) throw new Error(`${what} needs WebCrypto: run it with Node.js or open the app over HTTPS`);
  return s;
}
