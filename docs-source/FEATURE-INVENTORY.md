# CLR Connection Center — Feature Inventory (Current as of April 23, 2026)

This document is the source of truth for the three user-facing PDFs: **Why CLR Connection Center?**, **Standard Operating Procedures (SOP)**, and **Complete System Manual**.

---

## Organization & People

- **Company:** West Capital Lending (WCL), headquartered in Irvine, CA.
- **Primary product:** CLR Connection Center — an internal web and PWA application for the Client Loan Representative (CLR) team.
- **Product owner / developer:** Ethan Wood (CLR) — ethan.anthony.wood@gmail.com.
- **Live URL:** https://www.westcapitallending.center (branded "WCLCC").
- **Theme color:** #0F182D (navy).
- **Accent color:** Gold.

## Roles

- **CLR (Client Loan Representative):** Field-facing user. Makes outbound calls, logs outcomes, submits End-of-Day (EOD) reports.
- **Manager / Assistant:** Reviews team metrics, monitors submissions.
- **Admin:** All CLR/manager abilities plus settings, daily assignment generation, LO management, integrations, webhook config, audit log, NMLS license checks, super-admin organization management.
- **Super Admin:** Can see and manage multiple organizations.

---

## Sidebar Navigation (final structure)

Order of groups top-to-bottom:

1. **MAIN**
   - Dashboard — landing page with KPIs, daily targets, activity trend chart (with 1D / 1W / 1M / All Time range toggle)
   - Script — the calling script / dialer companion
   - Assignments — today's assigned LOs and borrowers
   - Directory — LO and borrower directory
   - Call History — log of all outcomes
   - EOD Report — end-of-day report entry and history
   - Appointments — upcoming scheduled follow-ups (badge counts active appointments in the next 3 days that aren't already transfers or overdue)

2. **TEAM**
   - Stats — leaderboard
   - Chat — team chat (unread badge)
   - Forum — long-form team forum

3. **TOOLS**
   - LO Stats — per-loan-officer performance
   - LO Vacation — mark LOs unavailable
   - Glossary — CLR terminology
   - State Lookup — regulatory/state info for borrowers
   - NMLS License — NMLS license status reference
   - NMLS — pending NMLS checks (badge)
   - Reports — admin reporting center

4. **ADMIN** (admin-only)
   - My Report — personal admin report
   - Settings — user profile, team goals, daily assignment generation, config

5. **SUPER ADMIN** (super-admin only)
   - Organizations — multi-org management

6. **INTEGRATIONS** (admin-only)
   - Integrations — unified integrations settings page
   - Contact Hub — unified contacts from all sources
   - Bonzo Prospects — Bonzo CRM prospects
   - Mojo Sessions — daily dialer session summaries per CLR
   - Mojo Import — CSV import tool for Mojo historical data

7. **HELP**
   - Help & Support — this support/help page
   - Help Videos — intro video and tutorials
   - Install App — PWA install guide
   - Integrations (admin-only shortcut)

---

## Key Features (shipped / current)

### EOD Report Export (new April 23, 2026)
- PDF export now produces a dedicated, polished print sheet instead of a screenshot of the form.
- Includes: CLR identity (name, email, role), submission timestamp, report date, daily summary, outcome breakdown (6 types: transfer, appointment, fell through, callback requested, future contact, no answer), transfer prospects (name, LO assigned, type — direct or appointment), LO coverage rollup (assigned called / assigned not called / additional called / other notes), notes, activity log, and CLR + Manager signature lines.
- Print-only CSS with bordered tables, tabular-nums, page-break protection.
- Available only for past submitted reports (not today's draft) — ensures the day is closed out before printing.

### Activity Trend Chart Time-Range Toggle (new April 23, 2026)
- 1D / 1W / 1M / All Time toggle on Dashboard, Leaderboard, and Team Stats.
- Default is 1M; selection persists via localStorage.
- 1D = 24 hourly points, 1W = 7 daily, 1M = 6 half-month buckets, All = monthly or quarterly depending on range.

### Full PWA Support (new April 23, 2026)
- Installable on iPhone, Android, and desktop.
- Favicons regenerated at 16, 32, 48, 64, 96, 128, 180, 192, 256, 384, 512px from the in-app W-mark.
- Maskable and monochrome variants.
- Manifest with theme color #0F182D, PWA shortcuts (Dashboard, Script, EOD).
- Service worker `wclcc-v2` pre-caches all icons and critical assets.

### Intro Video (new April 23, 2026)
- Replaced prior placeholder with finished 5-minute-56-second walkthrough.
- Accessible from Help & Support page and /intro-video route.

### Appointment Badge (fixed April 23, 2026)
- Sidebar Appointments badge now counts only active appointment-type outcomes (appointment, callback requested, deferral, future contact) with a follow-up date in the next 3 days (today through today+3).
- Excludes outcomes already converted to transfers and overdue items (followUpDate < today).

### Outcome Tracking
- Six outcome types: transfer, appointment, fell_through, callback_requested, future_contact, no_answer.
- Transfer sub-types: direct transfer vs appointment transfer.
- Follow-up dates, LO assignment, borrower name, notes.
- Appointments page shows overdue, today, and upcoming lists.

### End-of-Day (EOD) Workflow
- Calls made, transfers, appointments counters.
- Notes free-text.
- Assigned LOs called (JSON-tracked).
- Additional LOs called + other notes.
- One report per day; editable today, read-only once submitted.
- History viewable by admins.

### LO Vacation / Coverage
- Admins mark LOs unavailable during vacation, and the assignment engine skips them.

### NMLS License Tracking
- Pending NMLS license check queue (badge count on sidebar).
- License status reference lookup.

### Daily Assignment Generation
- Admin action in Settings; generates one assignment per CLR per day. Locked once generated; admin can unlock with a reason (audited).

### Chat & Forum
- Real-time team chat with unread badge.
- Long-form forum for team discussions.

### Directory & Contact Hub
- Full directory of LOs and borrowers.
- Contact Hub unifies contacts across Mojo, Bonzo, and direct imports.

### Integrations
- **Mojo:** Webhook ingestion of dialer session data (call volume, contacts, DNC hits, transfers, appointments). CSV import tool for historical backfill. Public API sync stub (ready when Mojo's public API launches).
- **Bonzo:** Prospect sync via webhook.
- **Webhook settings:** Secrets per integration (Mojo, Bonzo, API tokens) managed from the Integrations page.

### Audit Log
- Tracks admin actions (assignment unlocks, user role changes, LO archive, etc.).

### Authentication
- Email + password.
- Forgot / reset password flow.
- Invite links.
- Role-based route guards.

### Notifications
- Web Push (enabled on PWA).
- Email notifications configurable per user in Settings.

---

## Technical Architecture

- **Frontend:** React 19 + Vite 7, TypeScript, Tailwind CSS, shadcn/ui components, Wouter for routing.
- **Backend:** Node.js + Express, TypeScript, SQLite with prepared statements, `better-sqlite3`.
- **Auth:** Session-based with secure cookies.
- **Hosting:** Railway (Dockerfile builder) on US East region, bound to `www.westcapitallending.center` (legacy alias `www.wlc.it.com`).
- **CI/CD:** Push to `main` on GitHub → Railway auto-deploy via GitHub App (branch-to-environment binding required).
- **Database:** SQLite at `/data/app.db` on Railway mounted volume (500 MB, ~52 MB used).
- **Health check:** `GET /api/health` returns `{status:"ok",uptime:<sec>,db:true}`.
- **184 API endpoints** under `/api/*`.
- **PWA:** Manifest + service worker, installable on iOS / Android / desktop.

## Repository

- **GitHub:** https://github.com/EthanWood14/clr-connection-center (private)
- **Deploy config:** `railway.json`, `railway.toml`, `Dockerfile`, `DEPLOY.md`
- **Branch:** `main` is the only deploy branch.
- **Cache bust file:** `.railway-cache-bust` — bump timestamp in this file to force Railway to rebuild.

---

## Recent Changelog (April 22 – April 23, 2026)

| Date | Commit | Summary |
|---|---|---|
| Apr 23 | `4a1f3c3c` | Appointment badge filters out transfers and overdue items |
| Apr 23 | `2f2003e8` | Integrations item restored in the Integrations section |
| Apr 23 | `68c52549` | Auto-deploy test |
| Apr 23 | `100f6210` | Bump Railway cache bust |
| Apr 23 | `6b22849c` | Integrations → Help + 3-day appointment window |
| Apr 23 | `f2f3d485` | Remove duplicate Integrations link inside the Integrations section |
| Apr 23 | `aaa737f3` | Complete EOD PDF export with dedicated print sheet |
| Apr 23 | `116eacdc` | Full PWA setup with proper W-mark icons |
| Apr 23 | `c1cfd307` | 1D/1W/1M/All Time toggle on activity trend charts |
| Apr 23 | `2e09b79e` | Replace intro video with final 5:56 version |
| Apr 23 | `76b04cb9` | Remove duplicate Integrations nav item from TOOLS section |

---

## Support Contact

- Primary: Ethan Wood — ethan.anthony.wood@gmail.com
- Secondary: Chris Redoble

---

## Styling Guidance for Documents

- **Primary navy:** #0F182D
- **Accent gold:** #C9A24A (approximate — use the GOLD constant from support.tsx)
- **Body typography:** DM Sans for headings, Inter or IBM Plex Sans for body.
- **Code/mono:** JetBrains Mono or Geist Mono.
- Cover each PDF with the WCL navy header and gold accent bar.
- Use the W-mark from `client/public/wcl-logo.png` on the cover.
- Page numbers in footer. Section heads in navy. Callout tips in gold-tinted boxes.
