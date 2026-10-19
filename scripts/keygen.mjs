// Prints a new Ed25519 private key (JWK) to stdout, meant to be piped straight into
//   npm run -s keygen | npx wrangler secret put SIGNING_KEY
// The public half goes to stderr; it can also be read later from /api/gate/public-key.
const { privateKey, publicKey } = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const { kty, crv, x, d } = await crypto.subtle.exportKey("jwk", privateKey);
process.stdout.write(JSON.stringify({ kty, crv, x, d }));
console.error(`public key: ${JSON.stringify(await crypto.subtle.exportKey("jwk", publicKey))}`);
