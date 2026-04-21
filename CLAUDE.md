# CLAUDE.md — CLR Connection Center

Full context for any AI session working on this codebase. Read this before touching any code.

---

## App Overview

**CLR Connection Center** — an internal operations tool for West Capital Lending.
- CLRs (Client Lending Representatives) call leads and route qualified prospects to LOs (Loan Officers)
- Tracks calls, transfers, appointments, EOD reports, team stats, and LO assignments
- Built by Chris Redoble & Ethan Wood

**Live URL**: https://www.wlc.it.com
**Railway URL**: https://web-production-b6285.up.railway.app
**GitHub**: https://github.com/EthanWood14/clr-connection-center (private)

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React + TypeScript + Vite |
| Styling | Tailwind CSS + shadcn/ui |
| Routing | wouter with `useHashLocation` (hash-based: `/#/page`) |
| Backend | Express.js + TypeScript |
| ORM | Drizzle ORM |
| Database | SQLite at `/data/clr.db` (Railway persistent volume) |
| Email | Resend — `reports@wlc.it.com`, key `re_6yaHVd97_U3jABCg6Az64GCrkHCk2J24Q` |
| Hosting | Railway (port 3000) |
| Auth | Signed cookie `clr_session`, secret `clr-secret-2026` |

---

## Project Structure

```
clr-connection-center/
├── client/
│   └── src/
│       ├── pages/           # One file per route/tab
│       ├── components/      # Shared UI (app-sidebar, etc.)
│       ├── lib/
│       │   └── auth.ts      # Auth hook — import as @/lib/auth (NOT @/hooks/use-auth)
│       └── App.tsx          # Route definitions
├── server/
│   ├── routes.ts            # All API routes + sendReport function
│   └── storage.ts           # DB schema, migrations, storage helpers
├── shared/
│   └── schema.ts            # Drizzle schema + shared types
└── client/public/
    └── wcl-logo.png         # WCL logo
```

---

## Key Conventions

### Auth import
```ts
// CORRECT
import { useAuth } from "@/lib/auth";
// WRONG — will break build
import { useAuth } from "@/hooks/use-auth";
```

### SQLite migrations
Always use try/catch so migrations are idempotent:
```ts
try {
  sqlite.exec(`ALTER TABLE foo ADD COLUMN bar TEXT`);
} catch {}
```

### Raw SQL for non-Drizzle fields
Some fields aren't in the Drizzle schema — use raw SQLite:
```ts
import { getSqlite } from "./storage";
const sqlite = getSqlite();
const rows = sqlite.prepare(`SELECT * FROM foo WHERE id = ?`).all(id);
```

### weightRecentTransfers & transferPreference
NOT in Drizzle schema — always read/write via `sqlite.prepare()`.

### Hash routing
All routes are hash-based. Link to `/#/page`, not `/page`.

### Tab titles
Set `document.title = "Page Name · WCLCC"` at the top of each page component.

### Logo dark mode
```tsx
<img src="/wcl-logo.png" className="dark:brightness-0 dark:invert" />
```

### Footer
```
© 2026 West Capital Lending · Built by Chris Redoble & Ethan Wood
```

---

## User Roles

| Role | Description |
|------|-------------|
| `admin` + `is_clr=true` | Admin who is also a CLR — participates in LO assignments |
| `admin` + `is_clr=false` | Admin only — does not appear in LO assignment generation |
| `clr` | Standard CLR — logs calls, submits EOD reports |
| `viewer` | Read-only — can see dashboard/stats but cannot log or submit |

**First admin**: `ethan.anthony.wood@gmail.com` / `WCL2026!` (ID=1)

---

## Key Database Tables

| Table | Purpose |
|-------|---------|
| `users` | All accounts — CLRs, admins, viewers |
| `loan_officers` | The 12 active WCL LOs |
| `daily_assignments` | CLR → LO assignments per day |
| `lead_outcomes` | Every call outcome logged by CLRs |
| `eod_reports` | Daily EOD report submissions |
| `eod_reports.assigned_los_called` | JSON array of LO IDs called (assigned) |
| `eod_reports.additional_los_called` | JSON array of LO IDs called (unassigned) |
| `algorithm_settings` | LO assignment algorithm weights |
| `email_settings` | Manager emails (used for EOD + all scheduled reports) |
| `chat_messages` | In-app team chat |
| `call_scripts` | Decision tree scripts (owner_id=null = global default) |
| `script_nodes` | Nodes in call script trees |
| `script_responses` | Response options on each node |
| `nmls_checks` | NMLS compliance check schedule |

---

## Lead Outcome Types

| Value | Display | Color |
|-------|---------|-------|
| `transfer` | Transfer | Green |
| `appointment` | Appointment | Blue |
| `callback_requested` | Callback | Purple |
| `future_contact` | Future Contact | Blue |
| `fell_through` | Fell Through | Red |
| `no_answer` | No Answer | Gray |

Transfers also have `transfer_type`: `'direct'` or `'appointment'` (required when logging).

---

## Algorithm Weights

```
weightDaysSinceWorked: 0.30
weightFrequency: 0.25
weightAvailability: 0.20
weightBoost: 0.10
weightPriorityTier: 0.05
weightRecentTransfers: 0.10  ← raw SQL only, not in Drizzle
transferPreference: 'fewer' | 'more' | 'none'  ← raw SQL only
```

---

## 12 Active LOs (IDs 10–21, all Standard tier)

Bill Neessen (10), Khashi Tabrizi (11), Sean Murphy (12), Dan Baker (13), Aaron Salazar (14), Ian Militello (15), Cole Fairon (16), James McGowan (17), Derek Bullen (18), Gary Dawson (19), Kurt Christman (20), Sean Ripperger (21)

---

## Email System

- **Provider**: Resend (Railway blocks all SMTP)
- **From**: `CLR Connection Center <reports@wlc.it.com>`
- **Default API key**: `re_6yaHVd97_U3jABCg6Az64GCrkHCk2J24Q`
- **EOD recipients**: `email_settings.manager_emails` + CLR themselves
- **Scheduled reports (daily/weekly/monthly)**: `email_settings.manager_emails`
- **Default managers**: Scott Petrie (`scott.petrie@westcapitallending.com`), Chris Redoble (`chris.redoble@westcapitallending.com`)

### EOD Email Format
- 4-stat grid: Calls / Transfers / Appointments / Fell Through
- Green box: Transfer prospects with names + LO + transfer type + (Direct) or (Appt)
- Amber box: Notes
- LO Coverage section: assigned called / additional / not called

### Weekly Report Format
- Team summary cards at top
- Per-day breakdown (not leaderboard): for each date, table of CLR stats
- Notes section at bottom

---

## Deploy Pattern (CRITICAL)

```bash
# 1. Build
cd /home/user/workspace/clr-connection-center
npm run build

# 2. Push (requires api_credentials=["github"] in Computer)
git add -A
git commit -m "your message"
GIT_CONFIG_GLOBAL=/home/user/.gitconfig-proxy git push origin main

# 3. Trigger Railway deploy
curl -s -X POST https://backboard.railway.com/graphql/v2 \
  -H "Authorization: Bearer 82153315-ee29-4754-9405-1a5617892099" \
  -H "Content-Type: application/json" \
  -d '{"query":"mutation { serviceInstanceDeploy(serviceId: \"53411674-40fb-496d-b778-e1964c0f585b\", environmentId: \"a24ae53e-c0b6-4182-8d00-ca3c209bbbc9\", latestCommit: true) }"}'
```

Railway IDs:
- Token: `82153315-ee29-4754-9405-1a5617892099`
- Project: `06e30810-b43c-4bad-8fac-0093a269a917`
- Service: `53411674-40fb-496d-b778-e1964c0f585b`
- Environment: `a24ae53e-c0b6-4182-8d00-ca3c209bbbc9`
- Volume: `23ce2e17-b22d-446d-bbea-6828e3b28f45` (mounted at `/data`)

---

## WCL Brand

- **Primary color**: Dark Navy `#1A2B4A` / `#0F182D`
- **Logo**: `/home/user/workspace/clr-connection-center/client/public/wcl-logo.png`
- **Logo URL**: `https://westcapitallending.com/assets/WestCapitalLogo_dark-blue-f79872f0.png`

---

## Sidebar Structure (app-sidebar.tsx)

6 groups: Main, Tools, Reports, Support, Admin (admin-only), Settings

Active nav item must be **bold**.

---

## Important Rules (from product owner)

- **No DNQ category** — do not add it back
- **No Google Sheets sync** in MVP
- **LO assignment locks daily** — can only be generated once per day; admin override requires reason + triple confirmation
- **Past date blocking** — cannot generate assignments for previous days
- **CLR assignments cannot be changed** unless admin does triple-confirmation with virtual signature
- **Default status** for new LO and CLR accounts = active
- **All algorithm-related settings** are admin-only (no CLR editing)
- **NMLS check**: every 2 months, random CLR assigned, 7-day escalation
- **Missing LO info** (no NMLS, phone, or email): notify everyone every 3 days until fixed
- **PWA**: app is installable as a PWA
- **"Leaderboard" → "Team Stats"** everywhere
- **"Followups" → "Appointments"** everywhere
- **"DNQ"** removed entirely
- Bonzo notation reminder checkbox required when recording a transfer

---

## Pending / Under Construction Features

- Script flow chart (visual decision tree editor)
- Videos tab (training videos)
- Q&A tab
- SMS triggers
- Hubspot integration
- Lead purchase integration
- Phone notifications
- LO Vacation mode
- Elaine requirements (TBD)
- Multi-tenant / SaaS mode
