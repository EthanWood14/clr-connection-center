import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import type { Response } from "express";
import { TV_CAR_WRAP_MAX_BYTES, TV_CAR_WRAP_MAX_EDGE } from "../shared/tv-car";
import { isTvCarParticipant } from "../shared/tv-race-participation";

export const TV_CAR_WRAP_ORG_MAX_BYTES = 32 * 1024 * 1024;
export const TV_CAR_WRAP_TOTAL_MAX_BYTES = 128 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const VERSION = /^[a-f0-9]{64}$/;

export class TvCarWrapError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * The browser rasterizes the selected photo to a small RGB/RGBA PNG first.
 * Validate its real structure and bounded decompressed scanlines, not just
 * a client MIME or eight-byte signature. Ancillary chunks (EXIF/text/etc.)
 * are discarded before persistence. SVG, remote URLs and animation stay out.
 */
export function validateTvCarWrapImage(input: unknown, contentType: unknown) {
  if (!Buffer.isBuffer(input) || !input.length) throw new TvCarWrapError(400, "Choose a picture to upload.");
  if (input.length > TV_CAR_WRAP_MAX_BYTES) throw new TvCarWrapError(413, "The prepared wrap must be 1 MB or smaller.");
  if (String(contentType ?? "").split(";")[0].trim().toLowerCase() !== "image/png") {
    throw new TvCarWrapError(415, "Upload the prepared PNG wrap from My TV Car.");
  }
  const invalid = () => new TvCarWrapError(415, "This wrap is not a valid supported PNG image.");
  if (!input.subarray(0, 8).equals(PNG_SIGNATURE)) throw invalid();
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  let ended = false;
  let idatEnded = false;
  const imageData: Buffer[] = [];
  const canonical: Buffer[] = [PNG_SIGNATURE];
  while (offset < input.length) {
    if (offset + 12 > input.length || ended) throw invalid();
    const length = input.readUInt32BE(offset);
    const end = offset + length + 12;
    if (end > input.length) throw invalid();
    const kind = input.toString("ascii", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(kind)) throw invalid();
    const contents = input.subarray(offset + 8, offset + 8 + length);
    if (crc32(input.subarray(offset + 4, end - 4)) !== input.readUInt32BE(end - 4)) throw invalid();
    if (offset === 8 && kind !== "IHDR") throw invalid();
    if (kind === "IHDR") {
      if (offset !== 8 || length !== 13) throw invalid();
      width = contents.readUInt32BE(0);
      height = contents.readUInt32BE(4);
      channels = contents[9] === 6 ? 4 : contents[9] === 2 ? 3 : 0;
      if (!width || !height || width > TV_CAR_WRAP_MAX_EDGE || height > TV_CAR_WRAP_MAX_EDGE
        || contents[8] !== 8 || !channels || contents[10] !== 0 || contents[11] !== 0 || contents[12] !== 0) throw invalid();
      canonical.push(input.subarray(offset, end));
    } else if (kind === "IDAT") {
      if (!width || idatEnded) throw invalid();
      imageData.push(contents);
      canonical.push(input.subarray(offset, end));
    } else if (kind === "IEND") {
      if (length !== 0 || !imageData.length || end !== input.length) throw invalid();
      ended = true;
      canonical.push(input.subarray(offset, end));
    } else {
      // Palette images and animation are not emitted by our canvas exporter.
      if (/^[A-Z]/.test(kind) || ["acTL", "fcTL", "fdAT"].includes(kind)) throw invalid();
      if (imageData.length) idatEnded = true;
    }
    offset = end;
  }
  if (!ended) throw invalid();
  const rowBytes = width * channels + 1;
  const expected = rowBytes * height;
  let pixels: Buffer;
  try { pixels = inflateSync(Buffer.concat(imageData), { maxOutputLength: expected }); }
  catch { throw invalid(); }
  if (pixels.length !== expected) throw invalid();
  for (let row = 0; row < height; row++) if (pixels[row * rowBytes] > 4) throw invalid();
  const data = Buffer.concat(canonical);
  return { data, width, height, sizeBytes: data.length, version: createHash("sha256").update(data).digest("hex") };
}

export function selfTvCarWrapUrl(version: string): string {
  return `/api/me/tv-car/wrap?v=${version}`;
}

export function displayTvCarWrapUrl(token: string, userId: number, version: string): string {
  return `/api/tv/${encodeURIComponent(token)}/cars/${userId}/wrap?v=${version}`;
}

export function saveTvCarWrap(db: any, orgId: number, userId: number, image: ReturnType<typeof validateTvCarWrapImage>) {
  db.transaction(() => {
    const prior = Number(db.prepare("SELECT size_bytes FROM tv_car_wraps WHERE org_id=? AND user_id=?").get(orgId, userId)?.size_bytes ?? 0);
    const organizationBytes = Number(db.prepare("SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM tv_car_wraps WHERE org_id=?").get(orgId)?.bytes ?? 0);
    const totalBytes = Number(db.prepare("SELECT COALESCE(SUM(size_bytes),0) AS bytes FROM tv_car_wraps").get()?.bytes ?? 0);
    if (organizationBytes - prior + image.sizeBytes > TV_CAR_WRAP_ORG_MAX_BYTES
      || totalBytes - prior + image.sizeBytes > TV_CAR_WRAP_TOTAL_MAX_BYTES) {
      throw new TvCarWrapError(409, "The car-wrap image allowance is full. Remove an unused wrap or choose a smaller picture.");
    }
    db.prepare(`INSERT INTO tv_car_wraps (org_id,user_id,version,size_bytes,width,height,updated_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(org_id,user_id) DO UPDATE SET version=excluded.version,
      size_bytes=excluded.size_bytes,width=excluded.width,height=excluded.height,updated_at=excluded.updated_at`)
      .run(orgId, userId, image.version, image.sizeBytes, image.width, image.height, new Date().toISOString());
    db.prepare(`INSERT INTO lapfiles.tv_car_wrap_blobs (org_id,user_id,version,data) VALUES (?,?,?,?)
      ON CONFLICT(org_id,user_id) DO UPDATE SET version=excluded.version,data=excluded.data`)
      .run(orgId, userId, image.version, image.data);
  })();
}

export function removeTvCarWrap(db: any, orgId: number, userId: number): void {
  db.transaction(() => {
    db.prepare("DELETE FROM lapfiles.tv_car_wrap_blobs WHERE org_id=? AND user_id=?").run(orgId, userId);
    db.prepare("DELETE FROM tv_car_wraps WHERE org_id=? AND user_id=?").run(orgId, userId);
  })();
}

/** Caller authenticates either the owner session or an existing TV display token. */
export function sendTvCarWrap(db: any, res: Response, orgId: number, userId: number, version: unknown): void {
  if (typeof version !== "string" || !VERSION.test(version) || !Number.isSafeInteger(userId) || userId <= 0) {
    res.status(404).json({ error: "Wrap not found." });
    return;
  }
  const row = db.prepare(`SELECT b.data, u.id, u.role, u.is_clr, u.portal FROM tv_car_wraps w
    JOIN lapfiles.tv_car_wrap_blobs b ON b.org_id=w.org_id AND b.user_id=w.user_id AND b.version=w.version
    JOIN users u ON u.id=w.user_id AND u.org_id=w.org_id
    WHERE w.org_id=? AND w.user_id=? AND w.version=? AND u.is_active=1
      AND (u.portal IS NULL OR u.portal='c3')`)
    .get(orgId, userId, version);
  if (!row?.data || !isTvCarParticipant(row)) { res.status(404).json({ error: "Wrap not found." }); return; }
  // Version is in the URL (?v=…), so browsers can keep the ~1MB PNG across
  // reloads instead of re-downloading it every time the board refreshes.
  res.set({
    "Content-Type": "image/png", "Content-Disposition": 'inline; filename="tv-car-wrap.png"',
    "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Surrogate-Control": "max-age=31536000",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
  res.send(row.data);
}
