import { describe, expect, it } from "vitest";
import { publicJwk, seal, signJwt, unseal, verifyJwt } from "../src/crypto";
import { testEnv } from "./helpers";

describe("crypto", () => {
  it("signs tokens that verify with the public key only", async () => {
    const env = await testEnv();
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = await signJwt(env.SIGNING_KEY, { sub: "1", exp });
    expect(await verifyJwt(publicJwk(env.SIGNING_KEY), token)).toMatchObject({ sub: "1", exp });
    expect(JSON.stringify(publicJwk(env.SIGNING_KEY))).not.toContain('"d"');
  });

  it("rejects tampered, foreign and expired tokens", async () => {
    const env = await testEnv();
    const other = await testEnv();
    const pub = publicJwk(env.SIGNING_KEY);
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = await signJwt(env.SIGNING_KEY, { sub: "1", exp });
    const [h, , s] = token.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ sub: "2", exp })).toString("base64url")}.${s}`;
    expect(await verifyJwt(pub, forged)).toBeNull();
    expect(await verifyJwt(pub, await signJwt(other.SIGNING_KEY, { sub: "1", exp }))).toBeNull();
    expect(await verifyJwt(pub, token, (exp + 1) * 1000)).toBeNull();
  });

  it("seals values to one user", async () => {
    const env = await testEnv();
    const sealed = await seal(env.TOKEN_KEY, "secret", "user-1");
    expect(sealed).not.toContain("secret");
    expect(await unseal(env.TOKEN_KEY, sealed, "user-1")).toBe("secret");
    await expect(unseal(env.TOKEN_KEY, sealed, "user-2")).rejects.toThrow();
  });
});
