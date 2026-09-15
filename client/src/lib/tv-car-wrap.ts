import { TV_CAR_WRAP_MAX_BYTES, TV_CAR_WRAP_MAX_EDGE } from "@shared/tv-car";

export const TV_CAR_WRAP_INPUT_MAX_BYTES = 8 * 1024 * 1024;
const INPUT_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type PreparedTvCarWrap = { blob: Blob; previewUrl: string; name: string; width: number; height: number };

export function validateTvCarWrapFile(file: Pick<File, "type" | "size">): string | null {
  if (!INPUT_TYPES.has(file.type)) return "Choose a PNG, JPG, or WebP picture. SVG and animated formats are not supported.";
  if (!Number.isFinite(file.size) || file.size <= 0) return "This picture is empty. Choose another file.";
  if (file.size > TV_CAR_WRAP_INPUT_MAX_BYTES) return "Choose a picture under 8 MB.";
  return null;
}

export function fitTvCarWrapDimensions(width: number, height: number, maxEdge = TV_CAR_WRAP_MAX_EDGE) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width * height > 64_000_000) {
    throw new Error("This picture is too large to open. Choose a picture with fewer than 64 million pixels.");
  }
  const scale = Math.min(1, maxEdge / width, maxEdge / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Only decoded pixels leave the browser; originals, metadata and URLs are never uploaded. */
export async function prepareTvCarWrap(file: File): Promise<PreparedTvCarWrap> {
  const validation = validateTvCarWrapFile(file);
  if (validation) throw new Error(validation);
  const sourceUrl = URL.createObjectURL(file);
  try {
    const picture = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("This picture could not be opened. Try a different PNG, JPG, or WebP file."));
      img.src = sourceUrl;
    });
    let { width, height } = fitTvCarWrapDimensions(picture.naturalWidth, picture.naturalHeight);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Picture previews are not available in this browser. Please try another browser.");
    let blob: Blob;
    // Photo-like PNGs can exceed the storage limit even at 1024px; reduce both
    // dimensions together until the safe upload fits, keeping its proportions.
    for (;;) {
      canvas.width = width; canvas.height = height;
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
      context.drawImage(picture, 0, 0, width, height);
      blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value
        ? resolve(value) : reject(new Error("Could not prepare this picture. Please choose another file.")), "image/png"));
      if (blob.size <= TV_CAR_WRAP_MAX_BYTES) break;
      if (Math.max(width, height) <= 32) throw new Error("This picture could not be made small enough. Please choose another file.");
      width = Math.max(1, Math.floor(width * .8));
      height = Math.max(1, Math.floor(height * .8));
    }
    const previewUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not prepare a preview. Please choose the picture again."));
      reader.readAsDataURL(blob);
    });
    return { blob, previewUrl, name: file.name, width, height };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
