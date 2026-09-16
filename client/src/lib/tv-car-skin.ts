import {
  SKIN_ATLAS_WIDTH, SKIN_ATLAS_HEIGHT, skinFromRgba, skinToRgba, validateTvCarSkin,
  type TvCarSkin,
} from "@shared/tv-car-skin";

export const MAX_CAR_SKIN_IMPORT_BYTES = 128 * 1024;
export const CAR_SKIN_HISTORY_LIMIT = 40;
export type CarSkinHistory = { past: TvCarSkin[]; future: TvCarSkin[] };

export function rememberCarSkin(history: CarSkinHistory, previous: TvCarSkin): CarSkinHistory {
  return { past: [...history.past, previous].slice(-CAR_SKIN_HISTORY_LIMIT), future: [] };
}

export function stepCarSkinHistory(history: CarSkinHistory, current: TvCarSkin, direction: "undo" | "redo") {
  if (direction === "undo") {
    const previous = history.past.at(-1);
    if (!previous) return { skin: current, history };
    return { skin: previous, history: { past: history.past.slice(0, -1), future: [current, ...history.future].slice(0, CAR_SKIN_HISTORY_LIMIT) } };
  }
  const next = history.future[0];
  if (!next) return { skin: current, history };
  return { skin: next, history: { past: [...history.past, current].slice(-CAR_SKIN_HISTORY_LIMIT), future: history.future.slice(1) } };
}

export function parseTvCarSkinJson(text: string): TvCarSkin {
  if (new TextEncoder().encode(text).byteLength > MAX_CAR_SKIN_IMPORT_BYTES) throw new Error("Skin files must be smaller than 128 KB.");
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error("That JSON file is not readable. Export a C3 skin and try again."); }
  const skin = validateTvCarSkin(raw);
  if (!skin) throw new Error("That file is not a valid C3 car skin. It needs six 32 × 16 panels and a 16-color palette.");
  return skin;
}

/** Check dimensions before decoding, so a tiny compressed file cannot allocate a huge image. */
export function validateCarSkinPngHeader(bytes: Uint8Array): void {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || !signature.every((byte, index) => bytes[index] === byte)
    || String.fromCharCode(...Array.from(bytes.slice(12, 16))) !== "IHDR") throw new Error("Choose a PNG atlas exported from the skin editor.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(16) !== SKIN_ATLAS_WIDTH || view.getUint32(20) !== SKIN_ATLAS_HEIGHT) {
    throw new Error(`PNG skins must be exactly ${SKIN_ATLAS_WIDTH} × ${SKIN_ATLAS_HEIGHT} pixels. Use Export PNG for the template.`);
  }
}

export async function importTvCarSkinFile(file: File): Promise<TvCarSkin> {
  if (!file.size || file.size > MAX_CAR_SKIN_IMPORT_BYTES) throw new Error("Choose a nonempty PNG or JSON skin smaller than 128 KB.");
  const name = file.name.toLowerCase();
  if (name.endsWith(".json") && (!file.type || file.type === "application/json" || file.type === "text/plain")) return parseTvCarSkinJson(await file.text());
  if (!name.endsWith(".png") || (file.type && file.type !== "image/png")) throw new Error("Import a .png atlas or a .json C3 skin. Photos belong in Picture wrap.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  validateCarSkinPngHeader(bytes);
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" })); }
  catch { throw new Error("That PNG could not be opened. Try exporting the skin again."); }
  try {
    if (bitmap.width !== SKIN_ATLAS_WIDTH || bitmap.height !== SKIN_ATLAS_HEIGHT) throw new Error("PNG atlas dimensions do not match the C3 template.");
    const canvas = document.createElement("canvas");
    canvas.width = SKIN_ATLAS_WIDTH; canvas.height = SKIN_ATLAS_HEIGHT;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Your browser could not open the skin canvas.");
    context.drawImage(bitmap, 0, 0);
    return skinFromRgba(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  } finally { bitmap.close(); }
}

export function exportTvCarSkinJson(skin: TvCarSkin): Blob {
  const clean = validateTvCarSkin(skin);
  if (!clean) throw new Error("Fix the skin before exporting it.");
  return new Blob([JSON.stringify(clean, null, 2)], { type: "application/json" });
}

export async function exportTvCarSkinPng(skin: TvCarSkin): Promise<Blob> {
  const clean = validateTvCarSkin(skin);
  if (!clean) throw new Error("Fix the skin before exporting it.");
  const canvas = document.createElement("canvas");
  canvas.width = SKIN_ATLAS_WIDTH; canvas.height = SKIN_ATLAS_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not open the skin canvas.");
  const image = context.createImageData(SKIN_ATLAS_WIDTH, SKIN_ATLAS_HEIGHT);
  image.data.set(skinToRgba(clean));
  context.putImageData(image, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG export failed. Try JSON instead.")), "image/png"));
}

export async function downloadTvCarSkin(skin: TvCarSkin, format: "png" | "json"): Promise<void> {
  const blob = format === "png" ? await exportTvCarSkinPng(skin) : exportTvCarSkinJson(skin);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  try {
    link.href = url; link.download = `c3-car-skin.${format}`;
    document.body.appendChild(link); link.click();
  } finally {
    link.remove();
    // Let the browser start the local download before releasing its bytes.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
