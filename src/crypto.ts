const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Accepts both base64url and standard base64 (what `openssl rand -base64` prints).
export const fromB64 = (s: string) =>
  Uint8Array.from(atob(s.trim().replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export const randomId = (bytes = 24) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

export const sha256 = async (s: string) => b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));

// Compare via hashes so the time taken doesn't depend on where the strings differ.
export const safeEqual = async (a: string, b: string) => (await sha256(a)) === (await sha256(b));

export interface PublicJwk {
  kty: string;
  crv: string;
  x: string;
}

export const publicJwk = (privateJwk: string): PublicJwk => {
  const { kty, crv, x } = JSON.parse(privateJwk) as PublicJwk;
  return { kty, crv, x };
};

const keys = new Map<string, Promise<CryptoKey>>();
const cached = (id: string, make: () => Promise<CryptoKey>) => {
  let k = keys.get(id);
  if (!k) keys.set(id, (k = make()));
  return k;
};

const signingKey = (jwk: string) =>
  cached(`sign:${jwk}`, () => crypto.subtle.importKey("jwk", JSON.parse(jwk), { name: "Ed25519" }, false, ["sign"]));

export type Claims = Record<string, unknown>;

// Compact JWS (EdDSA), so team-gate can verify it with any JWT library and the public key.
export async function signJwt(privateJwk: string, claims: Claims): Promise<string> {
  const head = b64url(enc.encode(JSON.stringify({ alg: "EdDSA", typ: "JWT" })));
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign("Ed25519", await signingKey(privateJwk), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

export async function verifyJwt(pub: PublicJwk, token: string, now = Date.now()): Promise<Claims | null> {
  const [head, body, sig] = token.split(".");
  if (!head || !body || !sig) return null;
  const key = await crypto.subtle.importKey("jwk", pub, { name: "Ed25519" }, false, ["verify"]);
  if (!(await crypto.subtle.verify("Ed25519", key, fromB64(sig), enc.encode(`${head}.${body}`)))) return null;
  const claims = JSON.parse(dec.decode(fromB64(body))) as Claims;
  return typeof claims.exp === "number" && claims.exp * 1000 > now ? claims : null;
}

const aesKey = (b64: string) =>
  cached(`aes:${b64}`, () => crypto.subtle.importKey("raw", fromB64(b64), "AES-GCM", false, ["encrypt", "decrypt"]));

// `ad` binds the ciphertext to its row, so a sealed token can't be moved to another user.
export async function seal(keyB64: string, plain: string, ad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(ad) }, await aesKey(keyB64), enc.encode(plain));
  return `${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

export async function unseal(keyB64: string, sealed: string, ad: string): Promise<string> {
  const [iv, ct] = sealed.split(".");
  if (!iv || !ct) throw new Error("bad sealed value");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv), additionalData: enc.encode(ad) }, await aesKey(keyB64), fromB64(ct));
  return dec.decode(pt);
}
