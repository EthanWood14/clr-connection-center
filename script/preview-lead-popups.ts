/** Local QA only: fictional fixtures, no database, credentials or outbound APIs. */
import express from "express";
import { createServer } from "vite";
import path from "node:path";

const app = express();
app.use(express.json());
let userId = 99001;
let seq = 100;
let offer: any = null;
let failConfirm = false;
let assigned = true;
const leads: any[] = [{ externalId: "old", borrowerName: "Historical example", landedAt: new Date(Date.now() - 24 * 60 * 60_000).toISOString() }];
const actions: string[] = [];
app.get("/api/auth/me", (_req, res) => res.json({ user: { id: userId, orgId: 990, name: "QA CLR", email: "qa@example.invalid", role: "clr", isClr: true, portal: "c3", hasSeenIntro: true, mustChangePassword: false, timezone: "America/Los_Angeles" } }));
app.get("/api/lo-newest-leads", (_req, res) => res.json({ configured: true, stale: false, fetchedAt: new Date().toISOString(), los: assigned ? [{ lo: { id: 7, name: "Sample Loan Officer" }, leads }] : [] }));
app.get("/api/shotgun", (_req, res) => res.json({ isClr: true, isReady: true, canManage: false, offerSeconds: 20, serverNow: new Date().toISOString(), leads: offer ? [offer] : [], readyUsers: [] }));
app.post("/api/shotgun/readiness", (_req, res) => res.json({ ok: true }));
app.post("/api/shotgun/:id/confirm", (req, res) => {
  if (failConfirm) { failConfirm = false; return res.status(409).json({ error: "QA: could not confirm; please retry" }); }
  actions.push(`confirm:${req.params.id}`);
  if (offer) offer.status = "claimed";
  res.json({ ok: true });
});
app.post("/api/shotgun/:id/deny", (req, res) => {
  actions.push(`deny:${req.params.id}`);
  offer = null;
  res.json({ ok: true });
});
app.get("/__fixture", (_req, res) => res.json({ actions, userId, leadCount: leads.length }));
app.post("/__fixture", (req, res) => {
  const action = req.body.action;
  if (action === "switch-user") userId++;
  if (action === "remove-assignment") assigned = false;
  if (action === "fail-confirm") failConfirm = true;
  if (action === "new-lo" || action === "burst") {
    for (let i = 0; i < (action === "burst" ? 3 : 1); i++) leads.push({ externalId: String(++seq), borrowerName: `Example Borrower ${seq}`, state: "CA", source: "Example source", landedAt: new Date().toISOString() });
  }
  if (action === "shotgun") offer = { id: ++seq, leadName: "Example Shotgun Borrower", phone: "555-0100", email: "borrower@example.invalid", stateCode: "CA", source: "Example source", managerNotes: "Fictional test — no customer contacted", status: "offered", currentAssigneeId: userId, offerExpiresAt: new Date(Date.now() + 20_000).toISOString() };
  if (action === "expire" && offer) offer.offerExpiresAt = new Date(Date.now() - 1000).toISOString();
  res.json({ ok: true });
});

const vite = await createServer({ appType: "custom", server: { middlewareMode: true } });
app.use(vite.middlewares);
app.get("/", async (_req, res) => {
  const entry = path.resolve("tests/fixtures/lead-popup-harness.tsx").replaceAll("\\", "/");
  const html = await vite.transformIndexHtml("/", `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Local lead popup QA</title></head><body><div id="root"></div><script type="module" src="/@fs/${entry}"></script></body></html>`);
  res.type("html").send(html);
});
app.listen(4319, "127.0.0.1", () => console.log("Local-only lead popup QA: http://127.0.0.1:4319"));
