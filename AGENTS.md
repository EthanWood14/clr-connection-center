# AGENTS.md — CLR Connection Center (C3)

Internal tool for **West Capital Lending**'s CLR (Client Loan Representative) team:
call assignments, transfer tracking, comp requests, morning check-ins, LO/LOA
directory, reporting. This file is the source of truth for how to work in this
repo. (The `CLAUDE.md` in this repo is generic autonomous-subagent boilerplate —
ignore it for project conventions; use this file.)

- **Live:** https://www.westcapitallending.center  (apex 301s → `www.`)
- **Repo:** `github.com/EthanWood14/clr-connection-center` (private)
- **Host:** Railway (Docker), auto-deploys from `main`
- **Health:** `GET /api/health` → `{ ok, version, uptime, db }`

---

## Stack

| Layer | Tech |
|---|---|
| Client | React 18, Vite 7, **wouter (hash routing)**, TanStack Query v5, Tailwind 3, Radix / shadcn-style UI, lucide-react |
| Server | Express 5, **Drizzle ORM + better-sqlite3**, node-cron, passport-local sessions |
| Shared | TypeScript, Zod, `shared/schema.ts`, `shared/version.ts` |
| Runtime | **Node 20** (Docker `node:20-alpine`; `@types/node` pinned to 20.x) |

Client uses **hash routing** — real URLs look like `…/#/check-ins`,
`…/#/portal/<code>`. Deep links and the public portal depend on this.

---

## Commands

```bash
npm install            # first time (note: node_modules is committed — see below)
npm run dev            # tsx server/index.ts, serves client via Vite middleware
npm run build          # script/build.ts: vite → dist/public, esbuild → dist/index.cjs
npm start              # node dist/index.cjs  (production)
npm run check          # tsc (see "tsc is not the gate" below)
npm run db:push        # drizzle-kit push  (rarely used — see schema note)
```

`npm run dev` uses a POSIX `NODE_ENV=development …` prefix. On Linux/macOS (and
Codex cloud) it's fine. On Windows PowerShell use:
`$env:NODE_ENV='development'; npx tsx server/index.ts`.

**The build is the gate, not tsc.** `npm run check` reports ~40 *pre-existing*
type errors that do not block the build or deploy. Don't chase them. Ship only if
`npm run build` succeeds. After changing anything, run `npm run build` before
committing.

---

## Repo layout

```
client/src/
  pages/         one file per route (check-ins.tsx, portal.tsx, comp-requests.tsx, …)
  components/    app-sidebar.tsx = nav; splash-screen.tsx; ui/ = shadcn primitives
  lib/           queryClient.ts (apiRequest), auth.ts, business-day.ts
  App.tsx        route table (public routes sit BEFORE the authed app)
server/
  routes.ts      ★ ALL API endpoints + every cron job (~13k lines) — the big one
  storage.ts     ★ schema + data layer (~4.5k lines); DB opened here
  business-day.ts, push.ts, sms.ts, bonzo.ts, reminders.ts, nmls.ts, …
  index.ts       entry; vite.ts / static.ts serve the client
shared/
  schema.ts      Drizzle table defs + Zod insert schemas
  version.ts     APP_VERSION  ← bump on every deploy
script/build.ts  the build
```

`routes.ts` and `storage.ts` are large; use grep/symbol search, don't read whole.

---

## Database — important

- `better-sqlite3`, single file at `process.env.DATABASE_PATH ?? "clr.db"`.
  - **Prod:** `/data/clr.db` on a Railway volume.
  - **Local dev:** `./clr.db` (a real committed DB — treat as sample data).
- **Schema changes are done with raw SQL in `server/storage.ts`, not migrations.**
  The pattern is idempotent-on-boot:
  ```js
  try { sqlite.exec(`ALTER TABLE x ADD COLUMN y TEXT`); } catch {}
  sqlite.exec(`CREATE TABLE IF NOT EXISTS z (...)`);
  ```
  `drizzle.config.ts` points at a stale `./data.db`; `db:push` is effectively
  unused. Add columns/tables the raw-SQL way and mirror the type in `schema.ts`
  only if you need Drizzle query typing.
- Money is stored in **cents** (integer) — e.g. `transfer_comp_cents`.
- Dates: check-ins use the **plain local calendar date**, deliberately NOT the
  7pm business-day rollover (`server/business-day.ts` `ROLLOVER_HOUR`). Mixing the
  two has caused evening entries to file under "tomorrow." Keep them separate.

### Reading/patching the prod DB (Railway SSH)

```bash
railway ssh --service web
```
Gotchas learned the hard way:
- The DB is at `/data/clr.db`; `node_modules` resolves from **`/app`** (so run
  scripts from `/app`, and name them **`.cjs`** — `package.json` is `type:module`).
- **`/app` is NOT persistent across separate `railway ssh` calls.** Write the
  script AND run it in **one** invocation.
- For scripts more than a few KB, gzip+base64 them into the command (plain base64
  echo has silently truncated around ~8KB).

```bash
# one-shot pattern
B=$(gzip -c script.js | base64 -w0)
railway ssh --service web "sh -c 'echo $B | base64 -d | gunzip > /app/s.cjs && cd /app && node s.cjs'"
```

---

## Deploy

Railway builds from the **Dockerfile** (`npm ci` → `npm run build`) on every push
to `main`, so the normal flow is:

```bash
npm run build          # verify it's green
# bump APP_VERSION in shared/version.ts
git add -A && git commit -m "…"
git push origin main   # Railway auto-deploys
```

- `dist/` **and `node_modules/` are committed** in this repo (a Replit-export
  convention). Pushes are large; that's expected. Committing a fresh `dist/` is
  belt-and-suspenders — Railway rebuilds from source regardless.
- **Fallback if a git push is blocked:** `railway up --ci --service web` (builds
  from source; `.railwayignore` excludes `node_modules`, `dist`, `.git`, `*.db`).
- **Verify a deploy landed:** poll `https://www.westcapitallending.center/api/health`
  until `uptime` resets, then confirm `version` matches, and grep the served
  bundle for a *string literal* you added (identifiers are minified, strings are
  not):
  ```bash
  idx=$(curl -s https://www.westcapitallending.center/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | head -1)
  curl -s "https://www.westcapitallending.center/$idx" | grep -c "Your New String"
  ```

---

## Environment variables

Required in prod: `DATABASE_PATH=/data/clr.db`, `SESSION_SECRET`, `NODE_ENV=production`, `PORT=3000`.

Integrations (set as needed; features degrade gracefully if absent):
`RESEND_API_KEY` (email), `BONZO_API_TOKEN` / `BONZO_API_BASE` (Bonzo CRM),
`TRANSFER_API_TOKEN`, `CLR_SHARK_FEED_TOKEN`, `LEADVAULT_BASE_URL` /
`LEADVAULT_REPORTING_TOKEN`, `EMAIL_SEND_DELAY_MS` (default 30000),
`GIPHY_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`,
`BOOTSTRAP_TOKEN`. Web-push VAPID keys live in the DB, not env.

Never commit secrets. Real tokens (Bonzo JWT, etc.) are handled read-only and
must never be printed in output.

---

## Conventions

- **Auth:** most `/api/*` routes use `requireAuth`; managers/admins gate with
  `requireManagerOrAdmin` / `requireAdminSession`. Public routes (e.g.
  `/api/portal/*`) are explicitly whitelisted in the `/api` guard and must stay
  org-scoped and IDOR-safe (always filter by `orgId`; never trust a bare `:id`).
- **Emails** are queued through `sendEmail(payload, meta?)` with a
  `EMAIL_SEND_DELAY_MS` defer window (so an approval can cancel a pending send).
  Pass `{ immediate:true }` to bypass.
- **In-app notifications:** `storage.createNotification({ userId, type, title,
  message, isRead:false })` (`userId:null` = broadcast to everyone) + optional
  `sendPushToUser(userId, {...})`.
- **Comp/money** in cents; **audit** important mutations via `audit({...})`.
- Match the surrounding file's style; comments explain **why**, not what.
- Bump `shared/version.ts` on every user-facing change so the deploy is verifiable.

## Known external limits

- The **Bonzo API cannot set pipeline stages** (verified across many endpoint
  variants). Stage moves are decided in C3 and driven into Bonzo via a
  tag-triggered Bonzo automation (`tag clrmoveresponded → move to Responded`).
  `PUT /prospects` **replaces** the whole tag set — read-modify-write.
