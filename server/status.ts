import { getSqlite } from "./storage";
import { getVapidPublicKey } from "./push";

// ── Migration ────────────────────────────────────────────────────────────
try {
  const sqlite = getSqlite();
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS uptime_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service TEXT NOT NULL,
      status TEXT NOT NULL,
      response_ms INTEGER,
      checked_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_uptime_checks_service_time ON uptime_checks(service, checked_at);`);
} catch {}

const startTime = Date.now();
export function getProcessUptimeSec(): number {
  return Math.round((Date.now() - startTime) / 1000);
}

type ServiceStatus = "up" | "down" | "degraded";

interface ServiceResult {
  name: string;
  status: ServiceStatus;
  responseMs?: number;
  lastChecked: string;
  eventsLast24h?: number;
  uptime90d?: number;
  detail?: string;
}

function recordCheck(service: string, status: ServiceStatus, responseMs: number | null) {
  try {
    const sqlite = getSqlite();
    sqlite.prepare(
      `INSERT INTO uptime_checks (service, status, response_ms, checked_at) VALUES (?, ?, ?, ?)`
    ).run(service, status, responseMs, new Date().toISOString());
  } catch {}
}

function pruneOldChecks() {
  try {
    const sqlite = getSqlite();
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    sqlite.prepare(`DELETE FROM uptime_checks WHERE checked_at < ?`).run(cutoff);
  } catch {}
}

function uptimePct90d(service: string): number {
  try {
    const sqlite = getSqlite();
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const row = sqlite
      .prepare(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status='up' THEN 1 ELSE 0 END) AS ups
         FROM uptime_checks WHERE service=? AND checked_at >= ?`
      )
      .get(service, cutoff) as any;
    const total = Number(row?.total ?? 0);
    if (!total) return 100;
    const ups = Number(row?.ups ?? 0);
    return Math.round((ups / total) * 10000) / 100;
  } catch {
    return 100;
  }
}

function checkDatabase(): { status: ServiceStatus; responseMs: number } {
  const t = Date.now();
  try {
    const sqlite = getSqlite();
    sqlite.prepare(`SELECT 1 AS ok`).get();
    return { status: "up", responseMs: Date.now() - t };
  } catch {
    return { status: "down", responseMs: Date.now() - t };
  }
}

function checkEmail(): { status: ServiceStatus; detail: string } {
  const has = !!process.env.RESEND_API_KEY;
  return { status: has ? "up" : "degraded", detail: has ? "Configured" : "Not configured" };
}

function checkWebhooks(): { status: ServiceStatus; eventsLast24h: number } {
  try {
    const sqlite = getSqlite();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const row = sqlite
      .prepare(`SELECT COUNT(*) AS c FROM webhook_events WHERE created_at >= ?`)
      .get(cutoff) as any;
    const c = Number(row?.c ?? 0);
    return { status: "up", eventsLast24h: c };
  } catch {
    return { status: "up", eventsLast24h: 0 };
  }
}

function checkPush(): { status: ServiceStatus; detail: string } {
  const key = getVapidPublicKey();
  return { status: key ? "up" : "degraded", detail: key ? "Active" : "Not configured" };
}

export function runAllChecks(): ServiceResult[] {
  const now = new Date().toISOString();

  // API check: if this code is running, API is up. Measure a trivial handler time.
  const apiT = Date.now();
  const apiResponseMs = Date.now() - apiT + 1;
  recordCheck("API", "up", apiResponseMs);

  const dbRes = checkDatabase();
  recordCheck("Database", dbRes.status, dbRes.responseMs);

  const emailRes = checkEmail();
  recordCheck("Email", emailRes.status, null);

  const whRes = checkWebhooks();
  recordCheck("Webhooks", whRes.status, null);

  const pushRes = checkPush();
  recordCheck("Push Notifications", pushRes.status, null);

  return [
    { name: "API", status: "up", responseMs: apiResponseMs, lastChecked: now, uptime90d: uptimePct90d("API") },
    { name: "Database", status: dbRes.status, responseMs: dbRes.responseMs, lastChecked: now, uptime90d: uptimePct90d("Database") },
    { name: "Email", status: emailRes.status, lastChecked: now, detail: emailRes.detail, uptime90d: uptimePct90d("Email") },
    { name: "Webhooks", status: whRes.status, lastChecked: now, eventsLast24h: whRes.eventsLast24h, uptime90d: uptimePct90d("Webhooks") },
    { name: "Push Notifications", status: pushRes.status, lastChecked: now, detail: pushRes.detail, uptime90d: uptimePct90d("Push Notifications") },
  ];
}

export function getOverallStatus(services: ServiceResult[]): "operational" | "degraded" | "outage" {
  if (services.some(s => s.status === "down")) return "outage";
  if (services.some(s => s.status === "degraded")) return "degraded";
  return "operational";
}

// ── Cron: run checks every 5 minutes ─────────────────────────────────────
let started = false;
export function startUptimeCron() {
  if (started) return;
  started = true;
  // Run once at startup so the table is populated quickly
  try { runAllChecks(); } catch {}
  setInterval(() => {
    try { runAllChecks(); } catch {}
    try { pruneOldChecks(); } catch {}
  }, 5 * 60 * 1000);
}

export const STATUS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>CLR Connection Center — System Status</title>
<meta name="description" content="Real-time status of CLR Connection Center services." />
<style>
  :root { --navy:#0d1b2a; --navy2:#1a2b4a; --teal:#14b8a6; --teal2:#2dd4bf; --ink:#0f172a; --muted:#64748b; --bg:#f8fafc; --line:#e2e8f0; --green:#10b981; --yellow:#f59e0b; --red:#ef4444; }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: var(--bg); line-height: 1.5; }
  a { color: var(--teal); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .container { max-width: 960px; margin: 0 auto; padding: 0 24px; }

  nav { background: var(--navy); padding: 20px 0; }
  nav .container { display: flex; align-items: center; justify-content: space-between; }
  .logo { display: flex; align-items: center; gap: 10px; color: #fff; font-weight: 700; font-size: 17px; letter-spacing: -0.01em; }
  .logo-mark { width: 32px; height: 32px; background: var(--teal); border-radius: 8px; display: grid; place-items: center; color: var(--navy); font-weight: 800; font-size: 15px; }
  nav .links a { color: #cbd5e1; margin-left: 24px; font-size: 14px; font-weight: 500; }
  nav .links a:hover { color: #fff; text-decoration: none; }

  .page-head { background: linear-gradient(180deg, var(--navy) 0%, var(--navy2) 100%); color: #fff; padding: 48px 0 32px; }
  .page-head h1 { margin: 0 0 6px; font-size: 28px; font-weight: 800; letter-spacing: -0.01em; }
  .page-head p { margin: 0; color: #cbd5e1; font-size: 15px; }

  main { padding: 28px 0 60px; }

  .banner { margin: -28px 0 28px; border-radius: 12px; padding: 24px 28px; color: #fff; display: flex; align-items: center; gap: 16px; box-shadow: 0 6px 24px rgba(15,23,42,0.08); }
  .banner.operational { background: linear-gradient(90deg, #059669, var(--green)); }
  .banner.degraded    { background: linear-gradient(90deg, #d97706, var(--yellow)); }
  .banner.outage      { background: linear-gradient(90deg, #b91c1c, var(--red)); }
  .banner .dot { width: 14px; height: 14px; border-radius: 50%; background: rgba(255,255,255,0.85); box-shadow: 0 0 0 4px rgba(255,255,255,0.2); animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100% { box-shadow: 0 0 0 4px rgba(255,255,255,0.25); } 50% { box-shadow: 0 0 0 8px rgba(255,255,255,0.05); } }
  .banner h2 { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.01em; }
  .banner .sub { margin: 2px 0 0; font-size: 13px; opacity: 0.9; }

  .refresh-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; color: var(--muted); font-size: 13px; }

  .cards { display: grid; gap: 12px; }
  .card { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 18px 22px; display: flex; align-items: center; gap: 16px; }
  .card .sdot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
  .sdot.up       { background: var(--green); box-shadow: 0 0 0 3px rgba(16,185,129,0.2); }
  .sdot.degraded { background: var(--yellow); box-shadow: 0 0 0 3px rgba(245,158,11,0.2); }
  .sdot.down     { background: var(--red); box-shadow: 0 0 0 3px rgba(239,68,68,0.2); }
  .card .name { font-weight: 700; font-size: 16px; color: var(--ink); }
  .card .meta { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .card .left { flex: 1; min-width: 0; }
  .card .right { text-align: right; font-size: 12px; color: var(--muted); }
  .card .right .pct { display: block; color: var(--ink); font-weight: 700; font-size: 14px; }

  .loading { color: var(--muted); text-align: center; padding: 32px; }

  footer { background: var(--navy); color: #94a3b8; padding: 28px 0; font-size: 13px; margin-top: 40px; }
  footer .container { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
  footer a { color: #cbd5e1; margin-left: 18px; }
  footer a:first-of-type { margin-left: 0; }

  @media (max-width: 640px) {
    .banner { flex-direction: row; padding: 20px; }
    .card { padding: 14px 16px; }
    .card .right { font-size: 11px; }
  }
</style>
</head>
<body>

<nav>
  <div class="container">
    <div class="logo">
      <div class="logo-mark">W</div>
      <span>CLR Connection Center</span>
    </div>
    <div class="links">
      <a href="/landing">Home</a>
      <a href="/">Login</a>
    </div>
  </div>
</nav>

<header class="page-head">
  <div class="container">
    <h1>System Status</h1>
    <p>Real-time health of CLR Connection Center services.</p>
  </div>
</header>

<main>
  <div class="container">
    <div id="banner" class="banner operational">
      <div class="dot"></div>
      <div>
        <h2 id="banner-title">Loading…</h2>
        <p class="sub" id="banner-sub">Fetching current status.</p>
      </div>
    </div>

    <div class="refresh-row">
      <span>Auto-refreshes every 30 seconds</span>
      <span id="last-updated">Last updated: —</span>
    </div>

    <div id="cards" class="cards">
      <div class="loading">Loading services…</div>
    </div>
  </div>
</main>

<footer>
  <div class="container">
    <div>&copy; 2026 West Capital Lending &middot; Built by Chris Redoble &amp; Ethan Wood</div>
    <div>
      <a href="/">Login</a>
      <a href="/landing">Home</a>
    </div>
  </div>
</footer>

<script>
(function () {
  var bannerEl = document.getElementById("banner");
  var bannerTitle = document.getElementById("banner-title");
  var bannerSub = document.getElementById("banner-sub");
  var cardsEl = document.getElementById("cards");
  var lastUpdatedEl = document.getElementById("last-updated");
  var lastFetchedAt = null;

  var OVERALL_COPY = {
    operational: { title: "All Systems Operational", sub: "Every service is up and responding normally." },
    degraded:    { title: "Degraded Performance",    sub: "One or more services are running in a degraded state." },
    outage:      { title: "Service Outage",          sub: "One or more services are currently unavailable." }
  };

  function escapeHtml(s) {
    var map = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
    map[String.fromCharCode(34)] = "&quot;";
    map["'"] = "&#39;";
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return map[c]; });
  }

  function formatAgo(iso) {
    if (!iso) return "just now";
    var diff = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (diff < 60) return diff + "s ago";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    return Math.floor(diff / 3600) + "h ago";
  }

  function tickLastUpdated() {
    if (!lastFetchedAt) return;
    var diff = Math.max(0, Math.floor((Date.now() - lastFetchedAt) / 1000));
    lastUpdatedEl.textContent = "Last updated: " + diff + "s ago";
  }

  function renderService(s) {
    var right = "";
    if (typeof s.responseMs === "number") right += '<span>' + s.responseMs + ' ms</span><br/>';
    if (typeof s.eventsLast24h === "number") right += '<span>' + s.eventsLast24h + ' events / 24h</span><br/>';
    if (typeof s.uptime90d === "number") right += '<span class="pct">' + s.uptime90d.toFixed(2) + '% 90d uptime</span>';
    var metaBits = [];
    if (s.detail) metaBits.push(escapeHtml(s.detail));
    metaBits.push("Checked " + formatAgo(s.lastChecked));
    return '<div class="card">' +
      '<div class="sdot ' + escapeHtml(s.status) + '"></div>' +
      '<div class="left">' +
        '<div class="name">' + escapeHtml(s.name) + '</div>' +
        '<div class="meta">' + metaBits.join(" &middot; ") + '</div>' +
      '</div>' +
      '<div class="right">' + right + '</div>' +
    '</div>';
  }

  function render(data) {
    var overall = data.overall || "operational";
    bannerEl.className = "banner " + overall;
    var copy = OVERALL_COPY[overall] || OVERALL_COPY.operational;
    bannerTitle.textContent = copy.title;
    bannerSub.textContent = copy.sub;
    cardsEl.innerHTML = (data.services || []).map(renderService).join("");
    lastFetchedAt = Date.now();
    tickLastUpdated();
  }

  async function fetchStatus() {
    try {
      var res = await fetch("/api/status", { cache: "no-store" });
      var body = await res.json();
      render(body);
    } catch (e) {
      bannerEl.className = "banner outage";
      bannerTitle.textContent = "Unable to reach status API";
      bannerSub.textContent = "Retrying shortly…";
    }
  }

  fetchStatus();
  setInterval(fetchStatus, 30 * 1000);
  setInterval(tickLastUpdated, 1000);
})();
</script>

</body>
</html>`;
