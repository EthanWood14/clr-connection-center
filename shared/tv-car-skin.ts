export const PANEL_WIDTH = 32;
export const PANEL_HEIGHT = 16;
export const SKIN_ATLAS_WIDTH = 64;
export const SKIN_ATLAS_HEIGHT = 48;
export const CAR_SKIN_PANELS = [
  { id: "top", label: "Top" }, { id: "left", label: "Left side" },
  { id: "right", label: "Right side" }, { id: "nose", label: "Nose" },
  { id: "rear", label: "Rear" }, { id: "wings", label: "Wings" },
] as const;
export type CarSkinPanel = typeof CAR_SKIN_PANELS[number]["id"];
export type TvCarSkin = { version: 1; palette: string[]; panels: Record<CarSkinPanel, string> };
const CELLS = PANEL_WIDTH * PANEL_HEIGHT;
const HEX = /^#[0-9a-f]{6}$/i;
const PIXELS = /^[.0-9a-f]{512}$/;
const PANEL_KEYS = CAR_SKIN_PANELS.map(panel => panel.id).sort().join(",");
const DEFAULT_PALETTE = ["#49b8ec", "#f4f2e8", "#142332", "#ef6a35", "#f1d552", "#97d765", "#a993ff", "#ef5e84", "#56d4ba", "#e998ee", "#688bef", "#d6b571", "#ff3030", "#ffffff", "#777f8b", "#090d14"];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, expected: string) => Object.keys(value).sort().join(",") === expected;

/** Bounded, versioned pixel data only: no URLs, markup, identity or executable metadata. */
export function validateTvCarSkin(raw: unknown): TvCarSkin | null {
  if (!record(raw) || !exactKeys(raw, "palette,panels,version") || raw.version !== 1
    || !Array.isArray(raw.palette) || raw.palette.length !== 16
    || !Array.from(raw.palette).every(color => typeof color === "string" && color.length === 7 && HEX.test(color))
    || !record(raw.panels) || !exactKeys(raw.panels, PANEL_KEYS)) return null;
  const panels = {} as Record<CarSkinPanel, string>;
  for (const { id } of CAR_SKIN_PANELS) {
    const cells = raw.panels[id];
    if (typeof cells !== "string" || cells.length !== CELLS || !PIXELS.test(cells)) return null;
    panels[id] = cells;
  }
  return { version: 1, palette: raw.palette.map(color => color.toLowerCase()), panels };
}

export function createBlankCarSkin(): TvCarSkin {
  return { version: 1, palette: [...DEFAULT_PALETTE], panels: Object.fromEntries(CAR_SKIN_PANELS.map(({ id }) => [id, ".".repeat(CELLS)])) as Record<CarSkinPanel, string> };
}

function validCell(panel: CarSkinPanel, x: number, y: number): boolean {
  return CAR_SKIN_PANELS.some(item => item.id === panel) && Number.isInteger(x) && Number.isInteger(y)
    && x >= 0 && x < PANEL_WIDTH && y >= 0 && y < PANEL_HEIGHT;
}
const validInk = (color: string) => /^[.0-9a-f]$/.test(color);
export function sampleCarSkin(skin: TvCarSkin, panel: CarSkinPanel, x: number, y: number): string {
  return validCell(panel, x, y) ? skin.panels[panel][y * PANEL_WIDTH + x] : ".";
}

export function paintCarSkin(skin: TvCarSkin, panel: CarSkinPanel, x: number, y: number, color: string, brushSize = 1, mirror = false): TvCarSkin {
  if (!validCell(panel, x, y) || !validInk(color) || ![1, 2, 4].includes(brushSize)) return skin;
  const cells = skin.panels[panel].split("");
  for (let dy = 0; dy < brushSize; dy++) for (let dx = 0; dx < brushSize; dx++) {
    const px = x + dx, py = y + dy;
    if (!validCell(panel, px, py)) continue;
    cells[py * PANEL_WIDTH + px] = color;
    if (mirror) cells[py * PANEL_WIDTH + (PANEL_WIDTH - 1 - px)] = color;
  }
  const next = cells.join("");
  return next === skin.panels[panel] ? skin : { ...skin, panels: { ...skin.panels, [panel]: next } };
}

/** Flood fill is confined to the selected panel and never leaks into another surface. */
export function fillCarSkin(skin: TvCarSkin, panel: CarSkinPanel, x: number, y: number, color: string): TvCarSkin {
  if (!validCell(panel, x, y) || !validInk(color)) return skin;
  const target = sampleCarSkin(skin, panel, x, y);
  if (target === color) return skin;
  const cells = skin.panels[panel].split("");
  const stack = [y * PANEL_WIDTH + x];
  while (stack.length) {
    const cell = stack.pop()!;
    if (cells[cell] !== target) continue;
    cells[cell] = color;
    const cx = cell % PANEL_WIDTH, cy = Math.floor(cell / PANEL_WIDTH);
    if (cx > 0) stack.push(cell - 1);
    if (cx < PANEL_WIDTH - 1) stack.push(cell + 1);
    if (cy > 0) stack.push(cell - PANEL_WIDTH);
    if (cy < PANEL_HEIGHT - 1) stack.push(cell + PANEL_WIDTH);
  }
  return { ...skin, panels: { ...skin.panels, [panel]: cells.join("") } };
}

export function presetCarSkin(name: "racer" | "checker" | "flames", bodyColor = DEFAULT_PALETTE[0], accentColor = DEFAULT_PALETTE[1]): TvCarSkin {
  const skin = createBlankCarSkin();
  skin.palette[0] = HEX.test(bodyColor) ? bodyColor.toLowerCase() : DEFAULT_PALETTE[0];
  skin.palette[1] = HEX.test(accentColor) ? accentColor.toLowerCase() : DEFAULT_PALETTE[1];
  for (const { id } of CAR_SKIN_PANELS) {
    skin.panels[id] = Array.from({ length: CELLS }, (_, index) => {
      const x = index % PANEL_WIDTH, y = Math.floor(index / PANEL_WIDTH);
      if (name === "checker") return (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? "1" : "0";
      if (name === "flames") {
        const edge = 7 + Math.floor(5 * Math.sin(x * .65));
        return y > edge ? (y > edge + 3 ? "4" : "3") : "0";
      }
      return (id === "left" || id === "right" ? y >= 6 && y < 10 : x >= 13 && x < 19) ? "1" : "0";
    }).join("");
  }
  return skin;
}

function rgb(color: string): [number, number, number] {
  return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
}

/** Pixels are top-left row-major. Empty cells resolve to opaque underlying paint in 3D. */
export function skinPanelRgba(skin: TvCarSkin, panel: CarSkinPanel, baseColor: string): Uint8ClampedArray {
  const bytes = new Uint8ClampedArray(CELLS * 4);
  const base = rgb(HEX.test(baseColor) ? baseColor : DEFAULT_PALETTE[0]);
  const colors = skin.palette.map(rgb);
  for (let i = 0; i < CELLS; i++) {
    const cell = skin.panels[panel][i];
    bytes.set(cell === "." ? base : colors[parseInt(cell, 16)], i * 4);
    bytes[i * 4 + 3] = 255;
  }
  return bytes;
}

/** Portable car atlas: top/left, right/nose, rear/wings. Transparency is preserved. */
export function skinToRgba(skin: TvCarSkin): Uint8ClampedArray {
  const bytes = new Uint8ClampedArray(SKIN_ATLAS_WIDTH * SKIN_ATLAS_HEIGHT * 4);
  CAR_SKIN_PANELS.forEach(({ id }, panelIndex) => {
    const ox = (panelIndex % 2) * PANEL_WIDTH, oy = Math.floor(panelIndex / 2) * PANEL_HEIGHT;
    for (let i = 0; i < CELLS; i++) {
      const cell = skin.panels[id][i];
      if (cell === ".") continue;
      const offset = ((oy + Math.floor(i / PANEL_WIDTH)) * SKIN_ATLAS_WIDTH + ox + i % PANEL_WIDTH) * 4;
      bytes.set(rgb(skin.palette[parseInt(cell, 16)]), offset); bytes[offset + 3] = 255;
    }
  });
  return bytes;
}

export function skinFromRgba(bytes: Uint8ClampedArray, width: number, height: number): TvCarSkin {
  if (width !== SKIN_ATLAS_WIDTH || height !== SKIN_ATLAS_HEIGHT || bytes.length !== width * height * 4) {
    throw new Error("Choose a 64 × 48 WCL car skin PNG. Minecraft player skins use a different layout.");
  }
  const skin = createBlankCarSkin(), palette: string[] = [];
  for (let p = 0; p < CAR_SKIN_PANELS.length; p++) {
    const ox = (p % 2) * PANEL_WIDTH, oy = Math.floor(p / 2) * PANEL_HEIGHT;
    const cells: string[] = [];
    for (let i = 0; i < CELLS; i++) {
      const offset = ((oy + Math.floor(i / PANEL_WIDTH)) * width + ox + i % PANEL_WIDTH) * 4;
      if (bytes[offset + 3] < 128) { cells.push("."); continue; }
      const color = `#${Array.from(bytes.slice(offset, offset + 3), n => n.toString(16).padStart(2, "0")).join("")}`;
      let slot = palette.indexOf(color);
      if (slot < 0) { slot = palette.length; palette.push(color); }
      if (slot >= 16) throw new Error("Car skins support 16 colors. Reduce the PNG palette to 16 colors and try again.");
      cells.push(slot.toString(16));
    }
    skin.panels[CAR_SKIN_PANELS[p].id] = cells.join("");
  }
  skin.palette = [...palette, ...DEFAULT_PALETTE].slice(0, 16);
  return skin;
}
