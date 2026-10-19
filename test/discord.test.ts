import { describe, expect, it } from "vitest";
import { toMember } from "../src/discord";

const G = "1546419001041748068";
const ID = "175928847299117063";

describe("toMember", () => {
  it("prefers the server nickname and server avatar", () => {
    const m = toMember(G, { nick: "센둥", avatar: "a_abc", roles: ["1"], user: { id: ID, username: "u", global_name: "G", avatar: "def" } });
    expect(m).toEqual({ id: ID, name: "센둥", avatar: `https://cdn.discordapp.com/guilds/${G}/users/${ID}/avatars/a_abc.gif?size=128`, roles: ["1"] });
  });

  it("falls back to the global profile, then the default avatar", () => {
    expect(toMember(G, { nick: null, user: { id: ID, username: "u", global_name: "G", avatar: "def" } })).toMatchObject({
      name: "G",
      avatar: `https://cdn.discordapp.com/avatars/${ID}/def.png?size=128`
    });
    expect(toMember(G, { user: { id: ID, username: "u" } })).toMatchObject({
      name: "u",
      avatar: `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(ID) >> 22n) % 6n)}.png`,
      roles: []
    });
  });
});
