import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import express from "express";
import Database from "better-sqlite3";
import { registerTvCarRoutes } from "../server/tv-car-routes";
import { saveTvCarWrap, TvCarWrapError, TV_CAR_WRAP_ORG_MAX_BYTES, TV_CAR_WRAP_TOTAL_MAX_BYTES, validateTvCarWrapImage } from "../server/tv-car-wrap";
import { defaultTvCarAppearance, isSafeTvCarWrapUrl, normalizeTvCarAppearance, TV_CAR_WRAP_MAX_BYTES, TV_CAR_WRAP_MAX_EDGE, validateTvCarAppearance } from "../shared/tv-car";

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(kind: string, data: Buffer) {
  const payload = Buffer.concat([Buffer.from(kind), data]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, payload, checksum]);
}
function png(width = 2, height = 2, options: { metadata?: boolean; color?: number; pixels?: Buffer; depth?: number; interlace?: number; extra?: Buffer } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = options.depth ?? 8; header[9] = options.color ?? 6; header[12] = options.interlace ?? 0;
  const pixels = options.pixels ?? Buffer.alloc((width * (header[9] === 2 ? 3 : 4) + 1) * height);
  return Buffer.concat([signature, chunk("IHDR", header),
    ...(options.metadata ? [chunk("tEXt", Buffer.from("Private camera note: do not persist"))] : []),
    ...(options.extra ? [options.extra] : []), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

test("wrap validation accepts bounded RGB/RGBA PNG pixels and removes metadata", () => {
  for (const color of [2, 6]) {
    const image = validateTvCarWrapImage(png(2, 2, { color, metadata: true }), "image/png");
    assert.equal(image.width, 2);
    assert.equal(image.height, 2);
    assert.equal(image.sizeBytes, image.data.length);
    assert.match(image.version, /^[a-f0-9]{64}$/);
    assert.equal(image.data.includes(Buffer.from("Private camera note")), false);
    assert.deepEqual(image.data, png(2, 2, { color }));
    assert.equal(validateTvCarWrapImage(image.data, "image/png").version, image.version);
  }
});

test("wrap bytes, declared MIME and PNG structure must all agree", () => {
  const corruptCrc = png(); corruptCrc[30] ^= 1;
  const invalids: Array<[unknown, string]> = [
    [Buffer.from("<svg onload='bad()'></svg>"), "image/png"], [Buffer.from("not an image"), "image/png"],
    ["data:image/png;base64,AAAA", "image/png"], [png(), "image/jpeg"], [png(), "application/octet-stream"],
    [png().subarray(0, 20), "image/png"], [corruptCrc, "image/png"],
    [Buffer.concat([png(), Buffer.from("trailing payload")]), "image/png"],
    [png(2, 2, { color: 3 }), "image/png"], [png(2, 2, { depth: 16 }), "image/png"],
    [png(2, 2, { interlace: 1 }), "image/png"], [png(2, 2, { extra: chunk("acTL", Buffer.alloc(8)) }), "image/png"],
    [png(2, 2, { extra: chunk("FAKE", Buffer.alloc(0)) }), "image/png"],
    [png(2, 2, { pixels: Buffer.alloc(1) }), "image/png"],
    [png(2, 2, { pixels: Buffer.from([9, ...Array(17).fill(0)]) }), "image/png"],
  ];
  for (const [bytes, mime] of invalids) assert.throws(() => validateTvCarWrapImage(bytes, mime), TvCarWrapError);
});

test("oversized and decompression-bomb images are bounded before persistence", () => {
  assert.equal(TV_CAR_WRAP_MAX_BYTES, 1024 * 1024);
  assert.equal(TV_CAR_WRAP_MAX_EDGE, 1024);
  assert.throws(() => validateTvCarWrapImage(Buffer.alloc(TV_CAR_WRAP_MAX_BYTES + 1), "image/png"), (e: any) => e.status === 413);
  assert.throws(() => validateTvCarWrapImage(png(1025, 1), "image/png"), TvCarWrapError);
  assert.throws(() => validateTvCarWrapImage(png(2, 2, { pixels: Buffer.alloc(8 * 1024 * 1024) }), "image/png"), TvCarWrapError);
});

test("appearance texture URLs are server-local, versioned and never accepted by color PATCH", () => {
  const hash = "a".repeat(64);
  for (const url of [`/api/me/tv-car/wrap?v=${hash}`, `/api/tv/abcdefghijklmnop/cars/7/wrap?v=${hash}`]) {
    assert.equal(isSafeTvCarWrapUrl(url), true);
    assert.equal(normalizeTvCarAppearance({ wrapUrl: url }, 7).wrapUrl, url);
    assert.equal(validateTvCarAppearance({ ...defaultTvCarAppearance(7), wrapUrl: url }), null);
  }
  for (const url of ["https://example.invalid/picture.png", "//evil.invalid/a", "data:image/png;base64,AAAA", "javascript:alert(1)",
    `/api/me/tv-car/wrap?v=${hash}&userId=9`, `/api/tv/short/cars/7/wrap?v=${hash}`, `/api/tv/abcdefghijklmnop/cars/../wrap?v=${hash}`]) {
    assert.equal(isSafeTvCarWrapUrl(url), false);
    assert.equal(normalizeTvCarAppearance({ wrapUrl: url }, 7).wrapUrl, undefined);
  }
});

function database(t: TestContext) {
  const db = new Database(":memory:");
  t.after(() => db.close());
  db.exec("ATTACH DATABASE ':memory:' AS lapfiles");
  const source = read("server/storage.ts");
  for (const table of ["tv_car_preferences", "tv_car_wraps", "lapfiles.tv_car_wrap_blobs"]) {
    const match = source.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table.replace(".", "\\.")} \\([\\s\\S]*?\\)\\\``));
    assert.ok(match, `production DDL for ${table}`);
    db.exec(match[0].slice(0, -1)); db.exec(match[0].slice(0, -1));
  }
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, org_id INTEGER, name TEXT, role TEXT, is_clr INTEGER, is_active INTEGER, portal TEXT);
    INSERT INTO users VALUES (7,1,'Taylor','assistant',1,1,NULL),(8,1,'Sam','assistant',1,1,'c3'),
      (9,2,'Morgan','assistant',1,1,NULL),(10,1,'Manager','admin',0,1,NULL),
      (11,1,'Portal','assistant',1,1,'lap'),(12,1,'Inactive','assistant',1,0,NULL);`);
  return db;
}

async function httpHarness(t: TestContext) {
  const db = database(t);
  const tokens = new Map([["abcdefghijklmnop", 1], ["qrstuvwxyzabcdef", 2]]);
  const audits: any[] = [];
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use((req: any, _res, next) => {
    const id = Number(req.headers["x-test-user"]);
    if (id) req.session_user = { userId: id, orgId: Number(req.headers["x-test-org"] ?? 1), portal: req.headers["x-test-portal"] ?? null };
    next();
  });
  registerTvCarRoutes(app, {
    requireAuth: (req: any, res, next) => req.session_user ? next() : res.status(401).json({ error: "Unauthorized" }),
    db: () => db, sessionFor: (req: any) => req.session_user,
    displayOrgFor: token => tokens.get(token) ?? null, audit: entry => audits.push(entry),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  async function request(path: string, method = "GET", body?: Buffer | string, user = 7, org = 1, mime = "image/png") {
    return fetch(`${base}${path}`, { method, headers: {
      "x-test-user": String(user), "x-test-org": String(org), "content-type": mime, Connection: "close",
    }, body: body as any });
  }
  return { db, request, tokens, audits };
}

test("Ethan's race-only account can upload his own wrap without access to another car", async t => {
  const h = await httpHarness(t);
  h.db.exec("INSERT INTO users VALUES (1,1,'Ethan Wood','admin',0,1,NULL)");
  const uploaded = await h.request("/api/me/tv-car/wrap", "POST", png(), 1);
  assert.equal(uploaded.status, 201);
  const body = await uploaded.json() as any;
  assert.equal(isSafeTvCarWrapUrl(body.appearance.wrapUrl), true);
  assert.equal((await h.request(body.appearance.wrapUrl, "GET", undefined, 7)).status, 404);
  assert.equal((await h.request(body.appearance.wrapUrl, "GET", undefined, 1, 2)).status, 403);
  assert.deepEqual(h.db.prepare("SELECT role,is_clr FROM users WHERE id=1").get(), { role: "admin", is_clr: 0 });
  assert.equal((await h.request("/api/me/tv-car/wrap", "DELETE", undefined, 1)).status, 200);
});

test("upload persists one private sidecar wrap; color saves preserve it and deletion restores paint", async t => {
  const h = await httpHarness(t);
  const uploaded = await h.request("/api/me/tv-car/wrap", "POST", png(2, 2, { metadata: true }));
  assert.equal(uploaded.status, 201);
  const first = await uploaded.json() as any;
  assert.equal(isSafeTvCarWrapUrl(first.appearance.wrapUrl), true);
  const ownImage = await h.request(first.appearance.wrapUrl);
  assert.equal(ownImage.status, 200);
  assert.equal(ownImage.headers.get("content-type"), "image/png");
  assert.equal(ownImage.headers.get("x-content-type-options"), "nosniff");
  assert.match(ownImage.headers.get("cache-control") ?? "", /no-store/);
  assert.deepEqual(Buffer.from(await ownImage.arrayBuffer()), png());
  assert.equal((h.db.prepare("SELECT COUNT(*) AS n FROM lapfiles.tv_car_wrap_blobs").get() as any).n, 1);
  const schema = h.db.prepare("SELECT sql FROM sqlite_master WHERE name='tv_car_wraps'").get() as any;
  assert.doesNotMatch(schema.sql, /BLOB|data BLOB/i, "main DB contains metadata only");
  const body = { bodyColor: "#112233", accentColor: "#abcdef", livery: "solid" };
  const saved = await h.request("/api/me/tv-car", "PATCH", JSON.stringify(body), 7, 1, "application/json");
  assert.equal((await saved.json() as any).appearance.wrapUrl, first.appearance.wrapUrl);
  assert.equal(h.audits.at(-1).after.wrapUrl, first.appearance.wrapUrl);
  const other = await h.request("/api/me/tv-car", "GET", undefined, 8);
  assert.equal((await other.json() as any).appearance.wrapUrl, undefined);
  const replace = await h.request("/api/me/tv-car/wrap", "POST", png(3, 2));
  assert.equal(replace.status, 201);
  assert.notEqual((await replace.json() as any).appearance.wrapUrl, first.appearance.wrapUrl);
  assert.equal((h.db.prepare("SELECT COUNT(*) AS n FROM tv_car_wraps").get() as any).n, 1);
  const old = await h.request(first.appearance.wrapUrl); assert.equal(old.status, 404); await old.json();
  const removed = await h.request("/api/me/tv-car/wrap", "DELETE");
  assert.deepEqual((await removed.json() as any).appearance, body);
  assert.equal((h.db.prepare("SELECT COUNT(*) AS n FROM lapfiles.tv_car_wrap_blobs").get() as any).n, 0);
  assert.equal((h.db.prepare("SELECT COUNT(*) AS n FROM tv_car_wraps").get() as any).n, 0);
  assert.doesNotMatch(JSON.stringify(h.audits), /Private camera note|"data"|base64/);
});

test("wrap upload/remove/read require fresh active CLR ownership and matching organization", async t => {
  const h = await httpHarness(t);
  for (const user of [0, 9, 10, 11, 12]) {
    const result = await h.request("/api/me/tv-car/wrap", "POST", png(), user);
    assert.equal(result.status, user === 0 ? 401 : 403); await result.json();
    const removed = await h.request("/api/me/tv-car/wrap", "DELETE", undefined, user);
    assert.equal(removed.status, user === 0 ? 401 : 403); await removed.json();
  }
  const crossOrg = await h.request("/api/me/tv-car/wrap", "POST", png(), 7, 2);
  assert.equal(crossOrg.status, 403); await crossOrg.json();
  const foreignQuery = await h.request("/api/me/tv-car/wrap?userId=8&orgId=2", "POST", png());
  assert.equal(foreignQuery.status, 201); await foreignQuery.json();
  assert.deepEqual(h.db.prepare("SELECT user_id,org_id FROM tv_car_wraps").all(), [{ user_id: 7, org_id: 1 }]);
});

test("actual upload middleware rejects oversized bytes and spoofed image bodies", async t => {
  const h = await httpHarness(t);
  for (const [body, mime, code] of [[Buffer.alloc(TV_CAR_WRAP_MAX_BYTES + 1), "image/png", 413],
    [Buffer.from("<svg></svg>"), "image/png", 415], [png(), "image/jpeg", 415],
    [Buffer.from(JSON.stringify({ imageDataUrl: "https://evil.invalid/file" })), "application/json", 400]] as const) {
    const result = await h.request("/api/me/tv-car/wrap", "POST", body, 7, 1, mime);
    assert.equal(result.status, code); await result.json();
  }
  assert.equal((h.db.prepare("SELECT COUNT(*) AS n FROM tv_car_wraps").get() as any).n, 0);
});

test("TV image access uses its existing revocable token and never crosses organizations", async t => {
  const h = await httpHarness(t);
  const upload = await h.request("/api/me/tv-car/wrap", "POST", png());
  const { appearance } = await upload.json() as any;
  const version = appearance.wrapUrl.split("?v=")[1];
  const path = `/api/tv/abcdefghijklmnop/cars/7/wrap?v=${version}`;
  const image = await h.request(path, "GET", undefined, 0);
  assert.equal(image.status, 200); await image.arrayBuffer();
  for (const invalid of [path.replace("abcdefghijklmnop", "qrstuvwxyzabcdef"), path.replace("abcdefghijklmnop", "revokedinvalid00"), path.replace("/7/", "/8/")]) {
    const response = await h.request(invalid, "GET", undefined, 0);
    assert.equal(response.status, 404); await response.json();
  }
  h.db.prepare("UPDATE lapfiles.tv_car_wrap_blobs SET version=? WHERE user_id=7").run("f".repeat(64));
  const mismatched = await h.request(path, "GET", undefined, 0);
  assert.equal(mismatched.status, 404, "restoring main metadata cannot serve a different sidecar image under an old version");
  await mismatched.json();
  h.tokens.delete("abcdefghijklmnop");
  const revoked = await h.request(path, "GET", undefined, 0);
  assert.equal(revoked.status, 404); await revoked.json();
});

test("sidecar replacement is quota-bounded and cannot leave half-written metadata", t => {
  const db = database(t);
  const image = validateTvCarWrapImage(png(), "image/png");
  saveTvCarWrap(db, 1, 7, image);
  db.prepare("INSERT INTO tv_car_wraps VALUES (1,8,?, ?,1,1,'now')").run("f".repeat(64), TV_CAR_WRAP_ORG_MAX_BYTES - image.sizeBytes);
  saveTvCarWrap(db, 1, 7, image);
  assert.throws(() => saveTvCarWrap(db, 1, 7, { ...image, sizeBytes: image.sizeBytes + 1 }), (e: any) => e.status === 409);
  assert.equal((db.prepare("SELECT version FROM tv_car_wraps WHERE user_id=7").get() as any).version, image.version);
  db.prepare("INSERT INTO tv_car_wraps VALUES (2,9,?, ?,1,1,'now')").run("f".repeat(64), TV_CAR_WRAP_TOTAL_MAX_BYTES);
  assert.throws(() => saveTvCarWrap(db, 1, 7, image), (e: any) => e.status === 409);
  db.prepare("DELETE FROM tv_car_wraps WHERE user_id IN (8,9)").run();
  db.exec("DROP TABLE lapfiles.tv_car_wrap_blobs");
  assert.throws(() => saveTvCarWrap(db, 1, 8, image));
  assert.equal(db.prepare("SELECT 1 FROM tv_car_wraps WHERE user_id=8").get(), undefined, "metadata insert rolls back if blob storage fails");
});

test("TV feed generates token-scoped image URLs and preserves its org filter", () => {
  const routes = read("server/routes.ts");
  assert.match(routes, /displayOrgFor: \(token: string\) => \{\s*const link = tvLink\(token\)/);
  assert.match(routes, /SELECT user_id, version FROM tv_car_wraps WHERE org_id=\?/);
  assert.match(routes, /displayTvCarWrapUrl\(req\.params\.token, Number\(c\.id\), carWrapVersions\.get/);
});
