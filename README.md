# team-hub

`team.rescene-remine.com`: one Discord login for the 리센느 음원총공팀 tools. A Cloudflare Worker with D1. The tools themselves run on the home server behind `team-gate`, which only holds the public key. See [docs/PLAN.md](docs/PLAN.md) for the whole design.

## Routes

| Path | |
|---|---|
| `/` | Login, or the tool list with whether each tool answers |
| `/settings` | Dark or light theme |
| `/admin` | Tools (name, host, order, icon) and users (last seen, role check, force logout). Only `ADMIN_DISCORD_ID` |
| `/login`, `/auth/callback` | Discord OAuth (`identify guilds.members.read`). Only members with the team role get a session |
| `/logout` | Revokes the hub session (GET or POST) |
| `/go?to=<host>&next=<path>&state=<state>` | Sends a signed ticket to `https://<host>/_auth/callback`. Only hosts in the `tools` table |
| `/api/me` | The signed-in user |
| `/api/gate/public-key` | Ed25519 public key (JWK) for verifying tickets and tool tokens |
| `/api/gate/sync?since=<cursor>` | For team-gate, `Authorization: Bearer <GATE_TOKEN>`. Revoked sids, changed profiles, tools |
| `/api/gate/logout` | For team-gate. `POST {"sid": "..."}` |

Static files in `public/` (styles, logos, `header.js`) are served before the Worker runs. `public/_headers` lets browsers keep scripts and styles for 5 minutes and images for a day.

A tool counts as up when `https://<host>/_auth/health` answers with 2xx. The last result is kept in D1 and pages use it as is; a result older than a minute is rechecked after the response, so a dead home server doesn't slow the hub down.

## Header for tools

```html
<team-header></team-header>
<script src="https://team.rescene-remine.com/header.js" defer></script>
```

A charcoal bar with the logo, a tool menu and the user's menu (settings, logout), in a shadow root so the tool's CSS doesn't touch it. It needs two things from team-gate on the tool's own host:

- `GET /_auth/me` → `{ "id", "name", "avatar", "theme": "dark" | "light" | null, "tools": [{ "host", "name" }] }`, or 401. Without it only the logo shows.
- `POST /_auth/logout` from the user menu.

Theme: the header sets `<html data-theme="dark|light">` from the user's hub setting (no setting = dark) and stores it in `localStorage["team-theme"]`. Tools style both themes off that attribute and apply the stored value before first paint, so the page doesn't flash:

```html
<script>try { document.documentElement.dataset.theme = localStorage.getItem("team-theme") === "light" ? "light" : "dark"; } catch (e) {}</script>
```

A tool with a CSP needs `team.rescene-remine.com` in `script-src` and `img-src`, `cdn.discordapp.com` in `img-src`, and `cdn.jsdelivr.net` in `style-src` for the font.

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

### Rotating SIGNING_KEY

team-gate trusts every key in its public key file, so tools keep accepting cookies signed with the old key during the switch and nobody is logged out.

```sh
umask 077; npm run -s keygen > ~/signing-next.jwk   # prints the new public key
# team-gate: public-key.json → {"keys": [<current public key>, <new public key>]}, restart, look for "공개키 2개" in its log
npx wrangler secret put SIGNING_KEY < ~/signing-next.jwk && shred -u ~/signing-next.jwk
# 7 days later (tool token lifetime): public-key.json → the new public key alone, restart team-gate
```

## Development

```sh
npm install
npm test
npm run check
npx wrangler d1 migrations apply team-hub --local
npm run dev   # secrets in .dev.vars, plus HUB_ORIGIN=http://localhost:8787
```

`npm run deploy` applies new migrations to the remote D1 first, then deploys. A push to `main` does the same from GitHub Actions after the tests pass (`.github/workflows/ci.yml`, secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`).
