import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeStateCode, extractProspectId, buildBonzoManagerNotes, cleanBonzoSource } from "../server/shotgun-bonzo";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const routes = readFileSync(join(root, "server/routes.ts"), "utf8");
const storage = readFileSync(join(root, "server/storage.ts"), "utf8");
const bonzo = readFileSync(join(root, "server/bonzo.ts"), "utf8");
const page = readFileSync(join(root, "client/src/pages/shotgun.tsx"), "utf8");

test("bonzo state values normalize to shotgun state codes", () => {
  assert.equal(normalizeStateCode("CA"), "CA");
  assert.equal(normalizeStateCode("california"), "CA");
  assert.equal(normalizeStateCode(" New  York "), "NY");
  assert.equal(normalizeStateCode("washington d.c."), "DC");
  assert.equal(normalizeStateCode(""), "");
  assert.equal(normalizeStateCode(null), "");
  // Not a U.S. state: pass nothing through — the publish gate must complain,
  // not guess.
  assert.equal(normalizeStateCode("Ontario"), "");
  assert.equal(normalizeStateCode("ON"), "");
  assert.equal(normalizeStateCode("PR"), "");
});

test("technical bonzo sources fall back to plain Bonzo", () => {
  assert.equal(cleanBonzoSource("webhook"), "Bonzo");
  assert.equal(cleanBonzoSource(" API "), "Bonzo");
  assert.equal(cleanBonzoSource(""), "Bonzo");
  assert.equal(cleanBonzoSource("Meta"), "Meta");
  assert.equal(cleanBonzoSource("iLeads"), "iLeads");
  // and the route must actually use it
  assert.match(routes, /source: cleanBonzoSource\(detail\.source\)/);
});

test("prospect ids come from bare ids or any /prospects/{id} path", () => {
  assert.equal(extractProspectId(8351234), 8351234);
  assert.equal(extractProspectId("8351234"), 8351234);
  assert.equal(extractProspectId("https://app.getbonzo.com/anything/prospects/8351234?tab=notes"), 8351234);
  assert.equal(extractProspectId("https://app.getbonzo.com/dashboard"), null);
  assert.equal(extractProspectId(-5), null);
  assert.equal(extractProspectId(undefined), null);
});

test("bonzo manager notes carry publisher, pipeline context, and a safe link", () => {
  const detail = {
    id: 42, firstName: "Jane", lastName: "Doe", fullName: "Jane Doe",
    phone: "5551234567", email: "", state: "CA", city: "Fresno",
    source: "Meta", assignedUserName: "Chris Redoble",
    pipelineName: "Retail", stageName: "New Lead",
  };
  const notes = buildBonzoManagerNotes(detail, "Elleine", "https://app.getbonzo.com/x/prospects/42");
  assert.match(notes, /Elleine/);
  assert.match(notes, /Retail \/ New Lead/);
  assert.match(notes, /Chris Redoble/);
  assert.match(notes, /https:\/\/app\.getbonzo\.com\/x\/prospects\/42/);
  // A non-Bonzo URL is never echoed into notes — fall back to the id.
  const noUrl = buildBonzoManagerNotes(detail, "Elleine", "https://evil.example/prospects/42");
  assert.match(noUrl, /Bonzo prospect #42/);
  assert.doesNotMatch(noUrl, /evil\.example/);
});

test("one-click endpoint reuses the exact composer publish pipeline", () => {
  // Both routes must flow through the shared core — never a second insert path.
  assert.match(routes, /function createShotgunLeadFromFields\(/);
  const publish = routes.slice(routes.indexOf('app.post("/api/shotgun/publish"'), routes.indexOf("function shotgunExtensionAuth"));
  assert.match(publish, /createShotgunLeadFromFields\(orgId, userId, me, req\.body\)/);
  const fromBonzo = routes.slice(routes.indexOf('app.post("/api/shotgun/from-bonzo"'), routes.indexOf('app.post("/api/shotgun/:id/confirm"'));
  assert.match(fromBonzo, /createShotgunLeadFromFields\(orgId, userId, me, \{/);
  assert.match(fromBonzo, /"bonzo-extension"/);
  // Publish rights re-checked on this route too.
  assert.match(fromBonzo, /taskManager\(me\) \|\| !!\(me\?\.canPublishShotgun/);
  // The server, not the extension, fetches the prospect.
  assert.match(fromBonzo, /getProspectDetail\(prospectId\)/);
  // Phone leads still require a state — the calling-hours gate survives.
  assert.match(fromBonzo, /detail\.phone && !stateCode/);
  // A junk CRM email must not block a phone-only lead.
  assert.match(fromBonzo, /emailLooksValid/);
  // The global /api guard must let these two self-authenticating routes through.
  assert.match(routes, /req\.path === "\/shotgun\/extension-status" \|\| req\.path === "\/shotgun\/from-bonzo"/);
});

test("extension auth accepts the session cookie or a hashed per-user key", () => {
  const auth = routes.slice(routes.indexOf("function shotgunExtensionAuth"), routes.indexOf('app.get("/api/shotgun/extension-status"'));
  assert.match(auth, /freshSessionFromSignedCookie\(req\)/);
  assert.match(auth, /x-c3-extension-key/);
  // Only the SHA-256 is ever compared or stored; revoked/deactivated users drop out.
  assert.match(auth, /createHash\("sha256"\)/);
  assert.match(auth, /extension_key_hash=\? AND is_active=1/);
  // The key path enforces the boundaries the cookie path gets from the DB:
  // portal-confined accounts are refused, demo orgs stay read-only, and the
  // request re-enters the right org context for audits/notifications.
  assert.match(auth, /CONFINED_PORTALS\.has\(String\(user\.portal/);
  assert.match(auth, /isDemoOrg\(orgId\)/);
  assert.match(auth, /runWithOrg\(\{ orgId, superAdmin: false \}/);
  const mint = routes.slice(routes.indexOf('app.post("/api/shotgun/extension-key"'), routes.indexOf('app.post("/api/shotgun/from-bonzo"'));
  assert.match(mint, /taskManager\(me\) \|\| !!\(me\?\.canPublishShotgun/, "only publishers can mint keys");
  assert.match(mint, /UPDATE users SET extension_key_hash=\?/);
  assert.doesNotMatch(mint, /INSERT INTO users/);
  // Mass-assignment guard covers the credential column.
  assert.match(routes, /"extensionKeyHash", "extension_key_hash",/);
  assert.match(storage, /ALTER TABLE users ADD COLUMN extension_key_hash TEXT/);
});

test("bonzo detail fetch retries cross-team denials on the org token", () => {
  const detail = bonzo.slice(bonzo.indexOf("export async function getProspectDetail"), bonzo.indexOf("// Reassign a prospect"));
  assert.match(detail, /r\.status === 401 \|\| r\.status === 403/);
  assert.match(detail, /orgToken\(\)/);
  assert.match(detail, /custom_source \?\? d\.source/);
});

test("shotgun page offers the extension download and one-time key", () => {
  assert.match(page, /c3-shotgun-extension\.zip/);
  assert.match(page, /\/api\/shotgun\/extension-key/);
  assert.match(page, /shown only once/);
});

test("shipped extension files match hashes.json and the zip is current (run script/build-extension.py after edits)", () => {
  const hashes = JSON.parse(readFileSync(join(root, "chrome-extension/hashes.json"), "utf8")) as Record<string, string>;
  assert.ok(Object.keys(hashes).length >= 10);
  const zipHash = hashes["__zip_sha256"];
  delete hashes["__zip_sha256"];
  for (const [rel, expected] of Object.entries(hashes)) {
    const actual = createHash("sha256").update(readFileSync(join(root, "chrome-extension", rel))).digest("hex");
    assert.equal(actual, expected, `${rel} changed without re-running script/build-extension.py`);
  }
  // The zip is deterministic (fixed timestamps), so its bytes must match too —
  // catching a commit that staged sources but forgot the regenerated zip.
  const zip = readFileSync(join(root, "client/public/c3-shotgun-extension.zip"));
  assert.equal(createHash("sha256").update(zip).digest("hex"), zipHash, "client/public zip is stale — re-run script/build-extension.py");
});

test("extension manifest is MV3 with the traffic hook and C3 host access", () => {
  const manifest = JSON.parse(readFileSync(join(root, "chrome-extension/manifest.json"), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.host_permissions.includes("https://www.westcapitallending.center/*"));
  const hook = manifest.content_scripts.find((c: any) => c.world === "MAIN");
  assert.equal(hook.run_at, "document_start", "the fetch/XHR hook must land before Bonzo's app boots");
  const hookSrc = readFileSync(join(root, "chrome-extension/page-hook.js"), "utf8");
  // Any API version, and prospect-scoped sub-paths too. Pinning this to v3
  // exactly meant one Bonzo change left the button hidden with nothing said.
  assert.match(hookSrc, /\/api\(\?:\\\/v\\d\+\)\?\\\/prospects/);
  const content = readFileSync(join(root, "chrome-extension/content.js"), "utf8");
  assert.match(content, /c3shotgun\.publish/);
  // Wrong-prospect protection: announces must be checked against the URL id,
  // the URL seeds the button on direct loads, and the hook replays on ping.
  assert.match(content, /urlId && Number\(d\.id\) !== urlId\) return/);
  assert.match(content, /C3_SHOTGUN_PING/);
  assert.match(content, /fireSeq/);
  assert.match(hookSrc, /C3_SHOTGUN_PING/);
  const bg = readFileSync(join(root, "chrome-extension/background.js"), "utf8");
  assert.match(bg, /credentials: "include"/);
  assert.match(bg, /X-C3-Extension-Key/);
});
