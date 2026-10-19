# team-hub

`team.rescene-remine.com`: one Discord login for the 리센느 음원총공팀 tools. A Cloudflare Worker with D1. The tools themselves run on the home server behind `team-gate`, which only holds the public key. See [docs/PLAN.md](docs/PLAN.md) for the whole design.

## Routes

| Path | |
|---|---|
| `/` | Login, or your nickname and avatar |
| `/login`, `/auth/callback` | Discord OAuth (`identify guilds.members.read`). Only members with the team role get a session |
| `/logout` | Revokes the hub session (GET or POST) |
| `/go?to=<host>&next=<path>&state=<state>` | Sends a signed ticket to `https://<host>/_auth/callback`. Only hosts in the `tools` table |
| `/api/me` | The signed-in user |
| `/api/gate/public-key` | Ed25519 public key (JWK) for verifying tickets and tool tokens |
| `/api/gate/sync?since=<cursor>` | For team-gate, `Authorization: Bearer <GATE_TOKEN>`. Revoked sids, changed profiles, tools |
| `/api/gate/logout` | For team-gate. `POST {"sid": "..."}` |

The cron rechecks each signed-in person's role once a day with their own refresh token, a few people per run. Lost role, left the server or removed the app → all their sessions are revoked. If Discord doesn't answer, they're left alone until the next day.

## Tokens

Both are compact JWS (`alg: EdDSA`) signed with `SIGNING_KEY`, `iss: team.rescene-remine.com`, `aud: <tool host>`, `sub: <Discord id>`, `sid`.

- **ticket** (`kind: "ticket"`), 60 s: adds `jti` (single use, enforced by team-gate), `state`, `next` and `tok`.
- **tool token** (`kind: "tool"`, inside `tok`), 7 days or until the hub session ends: team-gate stores it as the tool's cookie.

## Secrets

```sh
npx wrangler secret put DISCORD_CLIENT_SECRET
npm run -s keygen | npx wrangler secret put SIGNING_KEY
openssl rand -base64 32 | npx wrangler secret put TOKEN_KEY
openssl rand -base64 32 | npx wrangler secret put GATE_TOKEN   # keep a copy for team-gate
npx wrangler secret put ADMIN_DISCORD_ID
```

Rotating `TOKEN_KEY` makes stored refresh tokens unreadable, so everyone is logged out at the next recheck.

## Development

```sh
npm install
npm test
npm run check
npx wrangler d1 migrations apply team-hub --local
npm run dev   # secrets in .dev.vars, plus HUB_ORIGIN=http://localhost:8787
```
