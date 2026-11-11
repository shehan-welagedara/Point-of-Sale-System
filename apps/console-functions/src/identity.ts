/**
 * Who is checking in: a Google-signed identity token from the client project's own service account.
 * Verified here with Google's public keys (RS256), the expected audience (this console's check-in
 * address), issuer, expiry and a verified email. Nothing is shared with clients in advance.
 */
import { createPublicKey, verify as rsaVerify } from "node:crypto";

export interface Identity {
  email: string;
  sub: string;
}

export class IdentityError extends Error {}

type Jwk = { kid: string; kty: string; n: string; e: string; alg?: string };
export type KeySource = () => Promise<Record<string, Jwk>>;

const GOOGLE_CERTS = "https://www.googleapis.com/oauth2/v3/certs";
let cached: { keys: Record<string, Jwk>; until: number } | null = null;

/** Google's current signing keys, cached for as long as Google says. */
export async function googleKeys(): Promise<Record<string, Jwk>> {
  if (cached && cached.until > Date.now()) return cached.keys;
  const r = await fetch(GOOGLE_CERTS, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new IdentityError(`couldn't fetch Google's keys (HTTP ${r.status})`);
  const body = (await r.json()) as { keys: Jwk[] };
  const maxAge = Number(/max-age=(\d+)/.exec(r.headers.get("cache-control") ?? "")?.[1] ?? 3600);
  cached = { keys: Object.fromEntries(body.keys.map((k) => [k.kid, k])), until: Date.now() + Math.min(maxAge, 6 * 3600) * 1000 };
  return cached.keys;
}

const part = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as Record<string, unknown>;

export async function verifyGoogleIdToken(token: string, audiences: string[], now = Date.now(), keys: KeySource = googleKeys): Promise<Identity> {
  const [h, p, sig] = token.split(".");
  if (!h || !p || !sig) throw new IdentityError("malformed identity token");
  const header = part(h);
  const claims = part(p);
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new IdentityError("unexpected token algorithm");
  const jwk = (await keys())[header.kid];
  if (!jwk) throw new IdentityError("unknown signing key");
  const key = createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
  if (!rsaVerify("RSA-SHA256", Buffer.from(`${h}.${p}`), key, Buffer.from(sig, "base64url"))) throw new IdentityError("bad token signature");
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") throw new IdentityError("token not issued by Google");
  if (!audiences.includes(String(claims.aud))) throw new IdentityError(`token is for ${String(claims.aud)}, not this console`);
  const skew = 60_000;
  if (typeof claims.exp !== "number" || claims.exp * 1000 < now - skew) throw new IdentityError("token expired");
  if (typeof claims.iat === "number" && claims.iat * 1000 > now + skew) throw new IdentityError("token issued in the future");
  if (!(claims.email_verified === true || claims.email_verified === "true") || typeof claims.email !== "string") throw new IdentityError("token has no verified service account");
  return { email: claims.email, sub: String(claims.sub ?? "") };
}

/** The Firebase project a service account belongs to: by number (compute) or by id (App Engine). */
export function serviceAccountProject(email: string): { projectNumber?: string; projectId?: string } {
  const compute = /^(\d+)-compute@developer\.gserviceaccount\.com$/.exec(email);
  if (compute?.[1]) return { projectNumber: compute[1] };
  const appspot = /^([a-z][a-z0-9-]{4,28}[a-z0-9])@appspot\.gserviceaccount\.com$/.exec(email);
  if (appspot?.[1]) return { projectId: appspot[1] };
  return {};
}
