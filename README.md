# team-hub

`team.rescene-remine.com`: one Discord login for the 리센느 음원총공팀 tools. A Cloudflare Worker with D1. The tools themselves run on the home server behind `team-gate`, which only holds the public key. See [docs/PLAN.md](docs/PLAN.md) for the whole design.

## Routes

| Path | |
|---|---|
| `/` | Login, or the tool list with whether each tool answers |
| `/todo` | The Notion TODO board: add row, date rail, columns by team or by person, item window (`#<page id>` opens one) |
| `/todo/status` | `POST {"page", "from", "to"}` (JSON, same origin). Changes an item's status in Notion |
| `/todo/items` | `POST {"title", "assignees", "teams", "due"}`. Adds an item (시작 전) to Notion |
| `/todo/edit` | `POST {"page", "field", "from", "to"}`, field `title`, `assignees`, `teams` or `due` |
| `/todo/delete`, `/todo/restore` | `POST {"page"}`. Into Notion's trash and back (restore only for pages deleted from the hub) |
| `/todo/board` | The board as JSON, for a tab coming back after a minute |
| `/sming-list` | 슴리 계산기, open without signing in (no side menu then): saved streaming lists (name, songs, total, last edit). `POST` (form, optional `copy=<id>`) makes a new one |
| `/sming-list/<id>` | One list: Melon search, typed-in songs (before release) and linking them later, reorder, total and running time, text copy. `POST {"version", "name", "songs", "items"}` saves it; 409 with the newer list if someone saved first |
| `/sming-list/<id>/delete` | `POST`. Signed in as the maker, or the admin (a list made signed out: the admin only) |
| `/sming-list/search?q=` | Melon search with play times, as JSON |
| `/settings` | Dark or light theme, my teams |
| `/admin` | Tools (name, host, order, icon), users (last seen, role check, force logout), Notion sync status and assignee name matching. Only `ADMIN_DISCORD_ID` |
| `/login`, `/auth/callback` | Discord OAuth (`identify guilds.members.read`). Only members with the team role get a session |
| `/logout` | Revokes the hub session (GET or POST) |
| `/go?to=<host>&next=<path>&state=<state>` | Sends a signed ticket to `https://<host>/_auth/callback`. Only hosts in the `tools` table |
| `/api/me` | The signed-in user |
| `/chat/embed`, `/api/chat` | 별이 chat: the frame the widget opens, and its API (relayed to the home server's `team-chat` bridge). Signed-in only |
| `/api/gate/public-key` | Ed25519 public key (JWK) for verifying tickets and tool tokens |
| `/api/gate/sync?since=<cursor>` | For team-gate, `Authorization: Bearer <GATE_TOKEN>`. Revoked sids, changed profiles, tools |
| `/api/gate/logout` | For team-gate. `POST {"sid": "..."}` |

Static files in `public/` (styles, logos, `header.js`, `chat-widget.js`) are served before the Worker runs. `public/_headers` lets browsers keep scripts and styles for 5 minutes and images for a day. The to-do page loads its files with `?v=<hash>` (`ASSET_V`, set by `npm run deploy`), so a page never runs an older cached script than its data.

The to-do board reads a copy of the Notion data source (`NOTION_TODO_SOURCE`) kept in D1. A page view older than a minute refreshes it after the response; the first one waits for it. A failed refresh keeps the last copy and shows the reason on the admin page. A status change first reads the page from Notion and only writes if the status is still the one the person saw. It sets `상태`, fills `완료일` with today (KST) when moving to 완료 with no date, and writes `허브 변경` (`<nickname> 10/20 14:03 진행 중→완료`). Every change is also kept in `todo_changes`.

Adds, edits and deletes write `허브 변경` the same way (`추가`, `제목 변경`, `담당자→까엉, 리부`, `마감일→10/25`, `삭제`, `되돌림`). A title or due date is only written if Notion still has what the person saw; assignees and teams apply just what was added and removed to Notion's current list. Assignees to pick are Notion's options plus every hub user (by their matched Notion name, else nickname). A sync leaves alone pages the hub changed after the sync started, and rewrites only rows that differ. Every write answers with the whole copy (`clientData`). The page draws the board itself with the same `renderTodo` the Worker uses (bundled into `public/todo-view.js` by `npm run build`), so a change shows the moment it's made and Notion's answer catches up behind it; cards slide to their new places. The add row also takes `@이름` and `#팀` while typing.

A 슴리 keeps its songs inside the list (`slists.songs`, keyed `m<Melon id>` or `u…` for a typed-in song), so linking a typed-in song to its Melon release changes every row of it. Search uses Melon's keyword JSON (first 20 characters, double-encoded, as in bill-ji-maker), and play times come from `m2.melon.com/m6/v2/song/info.json` (`PLAYTIME`, seconds). The page saves half a second after each change, only over the version it last saw. An edit by someone signed in records their name; one signed out records only the time.

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

Once signed in, the header also loads the 별이 chat widget (`chat-widget.js`), which opens `/chat/embed` in a frame.

A tool with a CSP needs `team.rescene-remine.com` in `script-src`, `style-src`, `img-src` and `frame-src`, `cdn.discordapp.com` in `img-src`, and `cdn.jsdelivr.net` in `style-src` for the font.

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
npx wrangler secret put NOTION_TOKEN < ~/.config/team-hub/notion.token   # internal integration: read and update content
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
npm run dev   # builds public/todo-view.js; secrets in .dev.vars, plus HUB_ORIGIN=http://localhost:8787
```

`npm run deploy` applies new migrations to the remote D1 first, then deploys. A push to `main` does the same from GitHub Actions after the tests pass (`.github/workflows/ci.yml`, secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`).
