import { generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEMO_LICENCE_PUBLIC_KEY, publicKeyFromPrivate, signDirective, suspensionInfo, verifyDirective } from "@pos/core";
import { describe, expect, it } from "vitest";
import { IdentityError, serviceAccountProject, verifyGoogleIdToken } from "../src/identity.js";
import { type ConsoleClient, can, dailyMetrics, healthState, monthlyLkr, noticeFor, subscriptionState, validateCheckin } from "../src/model.js";

const DEMO_PRIVATE = /^private=(.+)$/m.exec(readFileSync(resolve(__dirname, "../../../tools/licence/demo-key.txt"), "utf8"))![1]!.trim();

// A stand-in for Google's signing key.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
const keys = async () => ({ k1: { kid: "k1", kty: "RSA", n: jwk.n, e: jwk.e } });
const AUD = "https://polymath-console.web.app/api/checkin";
const NOW = Date.parse("2026-11-11T10:00:00Z");

function token(claims: Record<string, unknown>, kid = "k1", key = privateKey) {
  const h = Buffer.from(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })).toString("base64url");
  const p = Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: AUD, iat: NOW / 1000 - 10, exp: NOW / 1000 + 3600, email: "829462306217-compute@developer.gserviceaccount.com", email_verified: true, sub: "1", ...claims })).toString("base64url");
  return `${h}.${p}.${sign("RSA-SHA256", Buffer.from(`${h}.${p}`), key).toString("base64url")}`;
}

describe("check-in identity", () => {
  it("accepts a Google-signed token for this console", async () => {
    expect((await verifyGoogleIdToken(token({}), [AUD], NOW, keys)).email).toBe("829462306217-compute@developer.gserviceaccount.com");
  });
  it("refuses wrong audience, expiry, signature, issuer, key and unverified email", async () => {
    await expect(verifyGoogleIdToken(token({ aud: "https://elsewhere.example/api" }), [AUD], NOW, keys)).rejects.toThrow(IdentityError);
    await expect(verifyGoogleIdToken(token({ exp: NOW / 1000 - 3600 }), [AUD], NOW, keys)).rejects.toThrow(/expired/);
    await expect(verifyGoogleIdToken(token({}, "k1", generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey), [AUD], NOW, keys)).rejects.toThrow(/signature/);
    await expect(verifyGoogleIdToken(token({ iss: "https://evil.example" }), [AUD], NOW, keys)).rejects.toThrow(/Google/);
    await expect(verifyGoogleIdToken(token({}, "k9"), [AUD], NOW, keys)).rejects.toThrow(/unknown/);
    await expect(verifyGoogleIdToken(token({ email_verified: false }), [AUD], NOW, keys)).rejects.toThrow(/verified/);
    const t = token({});
    const [h, , s] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: AUD, exp: NOW / 1000 + 60, email: "1-compute@developer.gserviceaccount.com", email_verified: true })).toString("base64url");
    await expect(verifyGoogleIdToken(`${h}.${forged}.${s}`, [AUD], NOW, keys)).rejects.toThrow(/signature/);
  });
  it("reads the project from the service account", () => {
    expect(serviceAccountProject("829462306217-compute@developer.gserviceaccount.com")).toEqual({ projectNumber: "829462306217" });
    expect(serviceAccountProject("noura-kitchen-pos@appspot.gserviceaccount.com")).toEqual({ projectId: "noura-kitchen-pos" });
    expect(serviceAccountProject("someone@gmail.com")).toEqual({});
  });
});

describe("signed status directives", () => {
  it("round-trips with the vendor key and binds to the project", async () => {
    const t = await signDirective({ v: 1, type: "status", projectId: "noura-kitchen-pos", state: "suspended", since: "2026-11-11T00:00:00Z", graceUntil: "2026-11-18T00:00:00Z", message: "Please renew", issuedAt: "2026-11-11T00:00:00Z" }, DEMO_PRIVATE);
    expect((await verifyDirective(t, DEMO_LICENCE_PUBLIC_KEY, "noura-kitchen-pos")).state).toBe("suspended");
    await expect(verifyDirective(t, DEMO_LICENCE_PUBLIC_KEY, "another-project")).rejects.toThrow(/project/);
    const [p, body, sig] = t.split(".");
    const altered = Buffer.from(Buffer.from(body!, "base64url").toString().replace("suspended", "active")).toString("base64url");
    await expect(verifyDirective(`${p}.${altered}.${sig}`, DEMO_LICENCE_PUBLIC_KEY, "noura-kitchen-pos")).rejects.toThrow(/signature/);
  });
  it("derives the public key the console shows from the private key", async () => {
    expect(await publicKeyFromPrivate(DEMO_PRIVATE)).toBe(DEMO_LICENCE_PUBLIC_KEY);
  });
  it("suspension: warning during the grace period, then blocked", () => {
    const s = { suspension: { since: "2026-11-01T00:00:00Z", graceUntil: "2026-11-08T00:00:00Z", message: "x" } };
    expect(suspensionInfo(undefined, new Date(NOW)).state).toBe("none");
    expect(suspensionInfo(s, new Date("2026-11-05T00:00:00Z")).state).toBe("grace");
    expect(suspensionInfo(s, new Date("2026-11-09T00:00:00Z")).state).toBe("blocked");
  });
});

describe("console rules", () => {
  it("roles", () => {
    expect(can("sales", "licences")).toBe(true);
    expect(can("sales", "suspend")).toBe(false);
    expect(can("support", "clients")).toBe(false);
    expect(can("engineer", "deploy")).toBe(true);
    expect(can("admin", "staff")).toBe(true);
    expect(can(undefined, "read")).toBe(false);
    expect(can("owner-of-a-restaurant", "read")).toBe(false);
  });
  it("subscriptions and renewal notices", () => {
    const now = new Date("2026-11-11T06:00:00Z");
    expect(subscriptionState(undefined, now).state).toBe("none");
    expect(subscriptionState({ plan: "S", priceLkr: 60000, cycle: "annual", paidUntil: "2027-01-31" }, now).state).toBe("paid");
    expect(subscriptionState({ plan: "S", priceLkr: 60000, cycle: "annual", paidUntil: "2026-11-20" }, now)).toEqual({ state: "due", daysLeft: 9 });
    expect(subscriptionState({ plan: "S", priceLkr: 60000, cycle: "annual", paidUntil: "2026-11-01" }, now).state).toBe("overdue");
    expect(noticeFor({ subscription: { plan: "S", priceLkr: 60000, cycle: "annual", paidUntil: "2026-11-20" } }, "Polymath Tech", now)?.text).toMatch(/renews on 20 November 2026 \(Rs 60,000\)/);
    expect(noticeFor({ subscription: { plan: "S", priceLkr: 60000, cycle: "annual", paidUntil: "2026-11-01" } }, "Polymath Tech", now)?.level).toBe("warn");
    expect(noticeFor({ notice: { text: "Maintenance tonight 11 pm", level: "info" }, subscription: { plan: "S", priceLkr: 1, cycle: "annual", paidUntil: "2026-11-01" } }, "Polymath Tech", now)?.text).toBe("Maintenance tonight 11 pm");
  });
  it("health", () => {
    const now = new Date("2026-11-11T06:00:00Z");
    const health = { lastCheckinAt: "2026-11-11T01:00:00Z", appVersion: "1.6.0", reason: "scheduled", tenants: [{ id: "t", name: "N", plan: "starter", modules: [], devices: [{ id: "P01", appVersion: "1.5.8" }], errors24h: 0, counts: { workstations: 1, employees: 3, backOfficeUsers: 1 }, shareUsage: true }] };
    expect(healthState({ status: "active", health }, "1.6.0", now).state).toBe("attention");
    expect(healthState({ status: "active", health: { ...health, tenants: [{ ...health.tenants[0]!, devices: [] }] } }, "1.6.0", now).state).toBe("ok");
    expect(healthState({ status: "active", health: { ...health, lastCheckinAt: "2026-11-08T00:00:00Z" } }, "1.6.0", now).state).toBe("offline");
  });
  it("daily figures: health, subscriptions, monthly revenue and versions", () => {
    const now = new Date("2026-11-12T06:00:00Z");
    const base = { region: "asia-south1", wave: 1, enabled: true, createdAt: "", updatedAt: "" };
    const health = (at: string, v: string, errors = 0) => ({ lastCheckinAt: at, appVersion: v, reason: "scheduled", tenants: [{ id: "t", name: "T", plan: "standard", modules: [], devices: [], errors24h: errors, counts: { workstations: 1, employees: 1, backOfficeUsers: 1 }, shareUsage: true }] });
    const clients = [
      { ...base, id: "a", name: "A", projectId: "a-pos-1", status: "active", health: health("2026-11-12T03:00:00Z", "1.8.0"), subscription: { plan: "Standard", priceLkr: 120000, cycle: "annual", paidUntil: "2027-06-01" } },
      { ...base, id: "b", name: "B", projectId: "b-pos-1", status: "active", health: health("2026-11-12T03:00:00Z", "1.7.0", 2), subscription: { plan: "Premium", priceLkr: 15000, cycle: "monthly", paidUntil: "2026-11-20" } },
      { ...base, id: "c", name: "C", projectId: "c-pos-1", status: "suspended", health: health("2026-11-01T03:00:00Z", "1.7.0"), subscription: { plan: "Standard", priceLkr: 30000, cycle: "quarterly", paidUntil: "2026-10-01" } },
      { ...base, id: "d", name: "D", projectId: "d-pos-1", status: "active" },
      { ...base, id: "e", name: "E", projectId: "e-pos-1", status: "cancelled", subscription: { plan: "Standard", priceLkr: 99000, cycle: "annual", cancelled: true } },
    ] as ConsoleClient[];
    const m = dailyMetrics(clients, "1.8.0", now);
    expect(m).toMatchObject({ date: "2026-11-12", clients: 4, active: 3, suspended: 1, reporting: 2, healthy: 1, attention: 1, offline: 1, noCheckin: 1, paid: 1, due: 1, overdue: 1, mrrLkr: 35000, versions: { "1_8_0": 1, "1_7_0": 2 } });
    expect(monthlyLkr({ plan: "x", priceLkr: 120000, cycle: "perpetual" })).toBe(0);
    expect(monthlyLkr({ plan: "x", priceLkr: 120000, cycle: "annual", cancelled: true })).toBe(0);
  });
  it("check-in validation keeps reports bounded", () => {
    expect(() => validateCheckin({ v: 2 })).toThrow();
    expect(() => validateCheckin({ v: 1, projectId: "Bad_Project", appVersion: "1", tenants: [] })).toThrow();
    const r = validateCheckin({ v: 1, projectId: "noura-kitchen-pos", appVersion: "1.7.0", sentAt: "", reason: "manual", tenants: [{ id: "t", name: "x".repeat(500), devices: Array.from({ length: 300 }, (_, i) => ({ id: `D${i}` })), modules: [], errors24h: -5 }] });
    expect(r.tenants[0]!.name.length).toBe(120);
    expect(r.tenants[0]!.devices.length).toBe(100);
    expect(r.tenants[0]!.errors24h).toBe(0);
  });
});
