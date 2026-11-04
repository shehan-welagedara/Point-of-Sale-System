import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEntitlements, fallback, generateLicenceKeys, hashPin, sha256Hex, signLicence, verifyLicence, verifyPin } from "../src/index.js";

const real = globalThis.crypto;
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const b64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64url"));

/** Simulates a phone opening the app over http://192.168.x.x (no crypto.subtle). */
function insecureContext() {
  vi.stubGlobal("crypto", { getRandomValues: real.getRandomValues.bind(real) });
}

afterEach(() => vi.unstubAllGlobals());

describe("crypto fallbacks match WebCrypto exactly", () => {
  it("SHA-256 and PBKDF2", async () => {
    const data = new TextEncoder().encode("Spice Lagoon · invoice 26NOV_W01_42");
    expect(hex(fallback.sha256(data))).toBe(hex(new Uint8Array(await real.subtle.digest("SHA-256", data))));
    const pin = new TextEncoder().encode("4821");
    const salt = Uint8Array.from({ length: 16 }, (_, i) => i * 7);
    const key = await real.subtle.importKey("raw", pin, "PBKDF2", false, ["deriveBits"]);
    const web = new Uint8Array(await real.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 50_000 }, key, 256));
    expect(hex(await fallback.pbkdf2Sha256(pin, salt, 50_000, 32))).toBe(hex(web));
  });

  it("verifies WebCrypto ECDSA signatures and rejects altered ones", async () => {
    const keys = await generateLicenceKeys();
    const priv = await real.subtle.importKey("pkcs8", b64(keys.privateKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    for (let i = 0; i < 20; i++) {
      const msg = new TextEncoder().encode(`licence body ${i}`);
      const sig = new Uint8Array(await real.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, priv, msg));
      expect(fallback.ecdsaP256Verify(b64(keys.publicKey), sig, msg)).toBe(true);
      expect(fallback.ecdsaP256Verify(b64(keys.publicKey), sig, new TextEncoder().encode(`licence body ${i}!`))).toBe(false);
    }
  });
});

describe("without crypto.subtle (insecure context such as a phone on the LAN)", () => {
  it("hashes, sets and checks PINs and verifies licences the same way", async () => {
    const secureHash = await sha256Hex("abc");
    const { hash, salt } = await hashPin("4821");
    const keys = await generateLicenceKeys();
    const token = await signLicence(
      { v: 1, licenceId: "LIC-T", licensee: { name: "T" }, edition: "starter", addOns: [], entitlements: buildEntitlements("starter"), projectId: "local", tenantId: "*", billing: "subscription", issuedAt: "2026-11-01T00:00:00Z", validFrom: "2026-11-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z", graceDays: 14 },
      keys.privateKey,
    );
    insecureContext();
    expect(globalThis.crypto.subtle).toBeUndefined();
    expect(await sha256Hex("abc")).toBe(secureHash);
    expect(await verifyPin("4821", hash, salt)).toBe(true);
    expect(await verifyPin("4822", hash, salt)).toBe(false);
    const again = await hashPin("1357");
    vi.unstubAllGlobals();
    expect(await verifyPin("1357", again.hash, again.salt)).toBe(true);
    insecureContext();
    expect((await verifyLicence(token, keys.publicKey, { projectId: "local", tenantId: "x" }, new Date("2027-01-01"))).payload.licenceId).toBe("LIC-T");
    await expect(generateLicenceKeys()).rejects.toThrow(/WebCrypto/);
  });
});
