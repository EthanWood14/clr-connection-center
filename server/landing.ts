export const LANDING_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>CLR Connection Center — The Command Center for Mortgage CLR Teams</title>
<meta name="description" content="Track calls, manage LO assignments, automate reports, and close more loans — all in one place." />
<style>
  :root { --navy:#0d1b2a; --navy2:#1a2b4a; --teal:#14b8a6; --teal2:#2dd4bf; --ink:#0f172a; --muted:#64748b; --bg:#f8fafc; --line:#e2e8f0; }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: var(--ink); background: #fff; line-height: 1.5; }
  a { color: var(--teal); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .container { max-width: 1120px; margin: 0 auto; padding: 0 24px; }

  nav { background: var(--navy); padding: 20px 0; position: sticky; top: 0; z-index: 10; }
  nav .container { display: flex; align-items: center; justify-content: space-between; }
  .logo { display: flex; align-items: center; gap: 10px; color: #fff; font-weight: 700; font-size: 17px; letter-spacing: -0.01em; }
  .logo-mark { width: 32px; height: 32px; background: var(--teal); border-radius: 8px; display: grid; place-items: center; color: var(--navy); font-weight: 800; font-size: 15px; }
  nav .links a { color: #cbd5e1; margin-left: 24px; font-size: 14px; font-weight: 500; }
  nav .links a:hover { color: #fff; text-decoration: none; }

  .hero { background: linear-gradient(180deg, var(--navy) 0%, var(--navy2) 100%); color: #fff; padding: 96px 0 112px; text-align: center; }
  .hero h1 { font-size: 52px; line-height: 1.1; margin: 0 0 20px; font-weight: 800; letter-spacing: -0.02em; }
  .hero .sub { font-size: 20px; color: #cbd5e1; max-width: 720px; margin: 0 auto 36px; }
  .hero .ctas { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
  .btn { display: inline-block; padding: 14px 28px; border-radius: 8px; font-weight: 600; font-size: 15px; border: none; cursor: pointer; transition: transform 0.1s, box-shadow 0.1s; text-decoration: none; }
  .btn-primary { background: var(--teal); color: var(--navy); }
  .btn-primary:hover { background: var(--teal2); text-decoration: none; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(20,184,166,0.3); }
  .btn-ghost { background: transparent; color: #fff; border: 1px solid #475569; }
  .btn-ghost[disabled], .btn-ghost.disabled { opacity: 0.5; cursor: not-allowed; }
  .demo-note { display: block; font-size: 11px; color: #94a3b8; margin-top: 8px; }

  section { padding: 88px 0; }
  section.alt { background: var(--bg); }
  section h2 { font-size: 36px; margin: 0 0 16px; text-align: center; font-weight: 800; letter-spacing: -0.02em; }
  section .kicker { text-align: center; color: var(--muted); max-width: 620px; margin: 0 auto 48px; font-size: 16px; }

  .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
  .feature { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 28px; }
  .feature .icon { width: 42px; height: 42px; background: rgba(20,184,166,0.1); color: var(--teal); border-radius: 10px; display: grid; place-items: center; font-size: 20px; margin-bottom: 16px; }
  .feature h3 { margin: 0 0 8px; font-size: 17px; font-weight: 700; }
  .feature p { margin: 0; color: var(--muted); font-size: 14px; }

  .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
  .step { text-align: center; padding: 16px; }
  .step-num { display: inline-grid; place-items: center; width: 48px; height: 48px; border-radius: 50%; background: var(--navy); color: #fff; font-weight: 700; font-size: 18px; margin-bottom: 16px; }
  .step h3 { margin: 0 0 8px; font-size: 17px; font-weight: 700; }
  .step p { margin: 0; color: var(--muted); font-size: 14px; }

  .built-for { text-align: center; }
  .built-for ul { list-style: none; padding: 0; margin: 0 auto 24px; color: var(--muted); max-width: 520px; }
  .built-for ul li { padding: 10px 0; border-bottom: 1px solid var(--line); }
  .built-for ul li:last-child { border-bottom: none; }
  .badge { display: inline-block; background: var(--navy); color: #fff; padding: 10px 20px; border-radius: 999px; font-size: 14px; font-weight: 600; margin-top: 8px; }

  .form-wrap { max-width: 560px; margin: 0 auto; background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 32px; }
  .form-row { margin-bottom: 18px; }
  .form-row label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--ink); }
  .form-row input, .form-row select, .form-row textarea { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; font-size: 14px; font-family: inherit; background: #fff; }
  .form-row textarea { min-height: 90px; resize: vertical; }
  .form-row input:focus, .form-row select:focus, .form-row textarea:focus { outline: none; border-color: var(--teal); box-shadow: 0 0 0 3px rgba(20,184,166,0.15); }
  .form-row .req { color: #dc2626; }
  #form-msg { margin-top: 16px; padding: 12px; border-radius: 8px; font-size: 14px; display: none; }
  #form-msg.success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; display: block; }
  #form-msg.error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; display: block; }
  .submit-row { display: flex; justify-content: flex-end; }

  footer { background: var(--navy); color: #94a3b8; padding: 32px 0; font-size: 13px; }
  footer .container { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
  footer a { color: #cbd5e1; margin-left: 18px; }
  footer a:first-of-type { margin-left: 0; }

  @media (max-width: 820px) {
    .grid-3, .steps { grid-template-columns: 1fr; }
    .hero h1 { font-size: 36px; }
    .hero .sub { font-size: 17px; }
    section h2 { font-size: 28px; }
    section { padding: 64px 0; }
    nav .links a { margin-left: 14px; font-size: 13px; }
    footer .container { flex-direction: column; text-align: center; }
    footer a { margin: 0 8px; }
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
      <a href="#features">Features</a>
      <a href="#how">How it works</a>
      <a href="#request">Request access</a>
      <a href="/">Login</a>
    </div>
  </div>
</nav>

<header class="hero">
  <div class="container">
    <h1>The Command Center for<br />Mortgage CLR Teams</h1>
    <p class="sub">Track calls, manage LO assignments, automate reports, and close more loans — all in one place.</p>
    <div class="ctas">
      <a href="#request" class="btn btn-primary">Request Access</a>
      <span style="display:inline-flex;flex-direction:column;align-items:center">
        <button type="button" class="btn btn-ghost disabled" disabled>See a Demo</button>
        <span class="demo-note">Demo mode coming soon</span>
      </span>
    </div>
  </div>
</header>

<section id="features">
  <div class="container">
    <h2>Everything your CLR team needs</h2>
    <p class="kicker">Built specifically for mortgage teams that live on the phones.</p>
    <div class="grid-3">
      <div class="feature"><div class="icon">&#9881;</div><h3>Intelligent LO Assignment Algorithm</h3><p>Weighted daily assignments that balance call volume, closings, and availability.</p></div>
      <div class="feature"><div class="icon">&#128222;</div><h3>Real-Time Call Outcome Tracking</h3><p>Log every call with transfers, appointments, fell-throughs, and notes — instantly.</p></div>
      <div class="feature"><div class="icon">&#128231;</div><h3>Automated Daily &amp; Weekly Reports</h3><p>Managers get polished HTML summaries delivered via Resend on your schedule.</p></div>
      <div class="feature"><div class="icon">&#128221;</div><h3>Cold Calling Script Builder</h3><p>Centralize your proven scripts and objection handlers so every CLR stays on-message.</p></div>
      <div class="feature"><div class="icon">&#127942;</div><h3>Team Leaderboard &amp; Stats</h3><p>Per-CLR goals, live scoreboards, and transfer-rate tracking to drive healthy competition.</p></div>
      <div class="feature"><div class="icon">&#128279;</div><h3>Bonzo + Mojo Integration</h3><p>Pulls lead activity directly from the tools your CLRs already use — no duplicate data entry.</p></div>
    </div>
  </div>
</section>

<section id="how" class="alt">
  <div class="container">
    <h2>How it works</h2>
    <p class="kicker">From logging in to closing loans — in three steps.</p>
    <div class="steps">
      <div class="step"><div class="step-num">1</div><h3>CLRs log in to their personalized dashboard</h3><p>Each CLR sees their daily assignments, goals, and shift recap form — tuned to them.</p></div>
      <div class="step"><div class="step-num">2</div><h3>Assignments are generated daily with smart weighting</h3><p>The algorithm balances LO workload, recent activity, and closing rates automatically.</p></div>
      <div class="step"><div class="step-num">3</div><h3>Managers receive automated reports with full call notes</h3><p>Daily, weekly, and monthly summaries land in their inbox — no manual compiling.</p></div>
    </div>
  </div>
</section>

<section id="built-for">
  <div class="container built-for">
    <h2>Built for</h2>
    <ul>
      <li>Mortgage companies with dedicated CLR teams</li>
      <li>Boutique brokerages scaling a phone-first sales motion</li>
      <li>Managers who want reports in their inbox, not their spreadsheets</li>
    </ul>
    <div class="badge">Used by West Capital Lending</div>
  </div>
</section>

<section id="request" class="alt">
  <div class="container">
    <h2>Request Access</h2>
    <p class="kicker">Tell us about your team. We'll be in touch within 1 business day.</p>
    <div class="form-wrap">
      <form id="access-form" novalidate>
        <div class="form-row">
          <label for="companyName">Company Name <span class="req">*</span></label>
          <input id="companyName" name="companyName" type="text" required />
        </div>
        <div class="form-row">
          <label for="yourName">Your Name <span class="req">*</span></label>
          <input id="yourName" name="yourName" type="text" required />
        </div>
        <div class="form-row">
          <label for="email">Email <span class="req">*</span></label>
          <input id="email" name="email" type="email" required />
        </div>
        <div class="form-row">
          <label for="teamSize">Team Size <span class="req">*</span></label>
          <select id="teamSize" name="teamSize" required>
            <option value="">Select a range…</option>
            <option value="1-5">1–5 CLRs</option>
            <option value="6-15">6–15 CLRs</option>
            <option value="16+">16+ CLRs</option>
          </select>
        </div>
        <div class="form-row">
          <label for="message">Message (optional)</label>
          <textarea id="message" name="message"></textarea>
        </div>
        <div class="submit-row">
          <button type="submit" class="btn btn-primary" id="submit-btn">Send Request</button>
        </div>
        <div id="form-msg"></div>
      </form>
    </div>
  </div>
</section>

<footer>
  <div class="container">
    <div>&copy; 2026 West Capital Lending &middot; Built by Chris Redoble &amp; Ethan Wood</div>
    <div>
      <a href="/">Login</a>
      <a href="#">Privacy Policy</a>
      <a href="#">Terms of Use</a>
    </div>
  </div>
</footer>

<script>
(function () {
  var form = document.getElementById("access-form");
  var msg = document.getElementById("form-msg");
  var btn = document.getElementById("submit-btn");
  if (!form) return;
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    msg.className = "";
    msg.textContent = "";
    btn.disabled = true;
    btn.textContent = "Sending…";
    var data = {
      companyName: form.companyName.value.trim(),
      yourName:    form.yourName.value.trim(),
      email:       form.email.value.trim(),
      teamSize:    form.teamSize.value,
      message:     form.message.value.trim(),
    };
    try {
      var res = await fetch("/api/request-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      var body = await res.json().catch(function () { return {}; });
      if (res.ok && body.success) {
        msg.className = "success";
        msg.textContent = "Thanks! We'll be in touch within 1 business day.";
        form.reset();
      } else {
        msg.className = "error";
        msg.textContent = body.error || ("Something went wrong (" + res.status + ").");
      }
    } catch (err) {
      msg.className = "error";
      msg.textContent = "Could not reach the server. Please try again or email ethan.anthony.wood@gmail.com.";
    } finally {
      btn.disabled = false;
      btn.textContent = "Send Request";
    }
  });
})();
</script>

</body>
</html>`;
