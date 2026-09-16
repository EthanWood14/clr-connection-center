import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { isSafeTvCarWrapUrl, type TvCarAppearance } from "@shared/tv-car";
import { CAR_SKIN_PANELS, PANEL_HEIGHT, PANEL_WIDTH, skinPanelRgba, type CarSkinPanel } from "@shared/tv-car-skin";

type Point = { x: number; y: number; z: number };
type Dimensions = { width: number; height: number; depth: number };
export const CAR_FACE_PANELS = ["right", "left", "top", null, "nose", "rear"] as const;

/** Front is +Z, roof +Y, left -X. Each panel reads upright from outside. */
export function carPanelUv(panel: CarSkinPanel, point: Point, size: Dimensions): [number, number] {
  const x = point.x / size.width, y = point.y / size.height, z = point.z / size.depth;
  const uv: [number, number] = panel === "top" || panel === "wings" ? [.5 - x, .5 + z]
    : panel === "left" ? [.5 + z, .5 + y]
    : panel === "right" ? [.5 - z, .5 + y]
    : panel === "nose" ? [.5 + x, .5 + y] : [.5 - x, .5 + y];
  return uv.map(value => Math.max(0, Math.min(1, value))) as [number, number];
}

/** Dominant triangle normals carry rounded corners onto the correct face. */
export function applyCarPanelUvs(geometry: THREE.BufferGeometry, size: Dimensions, offset: Point = { x: 0, y: 0, z: 0 }): THREE.BufferGeometry {
  const result = geometry.index ? geometry.toNonIndexed() : geometry;
  const positions = result.getAttribute("position"), normals = result.getAttribute("normal");
  const uvs = new Float32Array(positions.count * 2);
  result.clearGroups();
  let lastMaterial = -1, groupStart = 0;
  for (let vertex = 0; vertex < positions.count; vertex += 3) {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < 3; i++) { nx += normals.getX(vertex + i); ny += normals.getY(vertex + i); nz += normals.getZ(vertex + i); }
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const material = ay >= ax && ay >= az ? (ny >= 0 ? 2 : 3) : ax >= az ? (nx >= 0 ? 0 : 1) : (nz >= 0 ? 4 : 5);
    if (material !== lastMaterial) {
      if (lastMaterial >= 0) result.addGroup(groupStart, vertex - groupStart, lastMaterial);
      groupStart = vertex; lastMaterial = material;
    }
    const panel = CAR_FACE_PANELS[material] ?? "top";
    for (let i = 0; i < 3; i++) {
      const at = vertex + i;
      const [u, v] = carPanelUv(panel, { x: positions.getX(at) + offset.x, y: positions.getY(at) + offset.y, z: positions.getZ(at) + offset.z }, size);
      uvs[at * 2] = u; uvs[at * 2 + 1] = v;
    }
  }
  if (lastMaterial >= 0) result.addGroup(groupStart, positions.count - groupStart, lastMaterial);
  result.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  return result;
}

export type TvCarModel = { root: THREE.Group; wheels: THREE.Group[]; boost: THREE.Group; updateSkin: (appearance: TvCarAppearance) => boolean; dispose: () => void };
type CarModelOptions = {
  appearance: TvCarAppearance;
  rank?: number;
  focus?: boolean;
  maxAnisotropy?: number;
  onTextureReady?: () => void;
};

/** The one physical car used by both the live track and the skin garage. */
export function createTvCarModel(options: CarModelOptions): TvCarModel {
  const { appearance, focus = false } = options;
  const root = new THREE.Group(); root.name = "c3-race-car";
  const resources = new Set<{ dispose: () => void }>();
  const keep = <T extends { dispose: () => void }>(value: T) => { resources.add(value); return value; };
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true; root.removeFromParent(); root.clear();
    resources.forEach(resource => resource.dispose()); resources.clear();
  };
  try {
    const material = (color: string, roughness = .55, metalness = .1) => keep(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
    const paint = material(appearance.bodyColor, .25, .48), accent = material(appearance.accentColor, .34, .2);
    const black = material("#111720", .65), rubber = material("#111315", .95), steel = material("#647079", .32, .7);
    const glass = keep(new THREE.MeshPhysicalMaterial({ color: "#234353", roughness: .17, metalness: .5, clearcoat: 1 }));
    const unitBox = keep(new THREE.BoxGeometry(1, 1, 1));
    const box = (parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
      const mesh = new THREE.Mesh(unitBox, mat); mesh.scale.set(w, h, d); mesh.position.set(x, y, z);
      mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
    };
    const skinMaterials = new Map<CarSkinPanel, THREE.MeshStandardMaterial>();
    if (appearance.skin) {
      for (const { id } of CAR_SKIN_PANELS) {
        const rgba = skinPanelRgba(appearance.skin, id, appearance.bodyColor);
        const texture = keep(new THREE.DataTexture(new Uint8Array(rgba), PANEL_WIDTH, PANEL_HEIGHT, THREE.RGBAFormat));
        texture.name = `car-skin-${id}`; texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = texture.magFilter = THREE.NearestFilter; texture.generateMipmaps = false;
        texture.flipY = true; texture.needsUpdate = true;
        const surface = keep(new THREE.MeshStandardMaterial({ color: "#ffffff", map: texture, roughness: .42, metalness: .15 }));
        surface.name = `car-panel-${id}`; skinMaterials.set(id, surface);
      }
    }
    // A skin replaces the visible picture, never the saved picture itself.
    // Without a skin, transparent image pixels still flatten over body paint.
    const pictureVisible = !appearance.skin && isSafeTvCarWrapUrl(appearance.wrapUrl);
    const bodyPaint = pictureVisible ? material(appearance.bodyColor, .38, .18) : paint;
    if (pictureVisible && isSafeTvCarWrapUrl(appearance.wrapUrl)) {
      const wrapLoader = new THREE.ImageLoader();
      wrapLoader.load(appearance.wrapUrl, picture => {
        if (disposed) return;
        try {
          const canvas = document.createElement("canvas"); canvas.width = picture.width; canvas.height = picture.height;
          const context = canvas.getContext("2d"); if (!context) return;
          context.fillStyle = appearance.bodyColor; context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(picture, 0, 0);
          const texture = keep(new THREE.CanvasTexture(canvas)); texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = Math.max(1, Math.min(4, options.maxAnisotropy ?? 1));
          bodyPaint.map = texture; bodyPaint.color.set("#ffffff"); bodyPaint.needsUpdate = true;
          options.onTextureReady?.();
        } catch { /* A missing/revoked picture leaves normal paint visible. */ }
      }, undefined, () => {});
    }
    const bodyMaterials = CAR_FACE_PANELS.map(panel => panel ? skinMaterials.get(panel) ?? bodyPaint : paint);
    const rounded = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, radius = .15, body = false) => {
      let geometry: THREE.BufferGeometry = keep(new RoundedBoxGeometry(w, h, d, 2, radius));
      if (body && appearance.skin) geometry = keep(applyCarPanelUvs(geometry, { width: 2, height: .44, depth: 4.725 }, { x, y: y - .58, z: z - .5375 }));
      const mesh = new THREE.Mesh(geometry, body && appearance.skin ? bodyMaterials : mat);
      mesh.name = name; mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; root.add(mesh); return mesh;
    };
    rounded("body-center", 1.5, .4, 3.65, 0, .6, 0, bodyPaint, .16, true);
    rounded("body-nose", .58, .24, 1.7, 0, .5, 2.05, bodyPaint, .1, true);
    rounded("body-sidepods", 2, .24, 1.9, 0, .48, -.55, bodyPaint, .13, true);
    box(root, 2.15, .09, 4.4, 0, .27, .05, black);
    rounded("cockpit", .92, .4, 1.4, 0, .92, -.25, glass, .2);
    const helmet = new THREE.Mesh(keep(new THREE.SphereGeometry(.24, 12, 8)), accent); helmet.position.set(0, 1.16, -.13); root.add(helmet);
    const wing = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
      if (!appearance.skin) return box(root, w, h, d, x, y, z, mat);
      const original = keep(new THREE.BoxGeometry(w, h, d));
      const geometry = keep(applyCarPanelUvs(original, { width: w, height: h, depth: d }));
      const mesh = new THREE.Mesh(geometry, Array(6).fill(skinMaterials.get("wings")));
      mesh.name = "skin-wing"; mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; root.add(mesh); return mesh;
    };
    wing(2.45, .12, .56, 0, .42, 2.67, black); wing(2.5, .06, .24, 0, .57, 2.45, paint);
    wing(2.25, .15, .62, 0, 1.1, -2.05, paint); wing(2.25, .09, .42, 0, 1.34, -2.12, black);
    for (const x of [-.88, .88]) box(root, .09, .65, .24, x, .84, -2.05, black);
    for (const x of [-.38, .38]) box(root, .08, .34, .75, x, 1.11, -.22, black);
    box(root, .8, .09, .12, 0, 1.29, .16, black);
    const stripeOffsets = appearance.skin ? [] : appearance.livery === "double-stripe" ? [-.16, .16] : appearance.livery === "stripe" ? [0] : [];
    for (const x of stripeOffsets) {
      const width = appearance.livery === "double-stripe" ? .12 : .2;
      box(root, width, .015, 1.55, x, .812, 1, accent).name = "livery-stripe";
      box(root, width, .015, 1.05, x, .628, 2.3, accent).name = "livery-stripe";
    }
    const wheels: THREE.Group[] = [];
    const wheelGeometry = keep(new THREE.CylinderGeometry(.43, .43, .34, 16)), rimGeometry = keep(new THREE.CylinderGeometry(.25, .25, .36, 10));
    for (const x of [-1.03, 1.03]) for (const z of [-1.42, 1.6]) {
      const pivot = new THREE.Group(); pivot.position.set(x, .45, z); root.add(pivot);
      const tire = new THREE.Mesh(wheelGeometry, rubber); tire.rotation.z = Math.PI / 2; tire.castShadow = true; pivot.add(tire);
      const rim = new THREE.Mesh(rimGeometry, steel); rim.rotation.z = Math.PI / 2; pivot.add(rim); wheels.push(pivot);
      box(root, Math.abs(x), .055, .055, x / 2, .5, z, black);
    }
    if (options.rank != null && typeof document !== "undefined") {
      const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 64;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#14232a"; ctx.fillRect(0, 0, 128, 64); ctx.fillStyle = "#f5f6ef";
        ctx.font = "italic 900 48px Arial"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(options.rank), 64, 34, 120);
        const map = keep(new THREE.CanvasTexture(canvas)); map.colorSpace = THREE.SRGBColorSpace;
        const number = new THREE.Mesh(keep(new THREE.PlaneGeometry(.65, .25)), keep(new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide })));
        number.rotation.x = -Math.PI / 2; number.position.set(0, .845, 1.26); root.add(number);
      }
    }
    if (focus) {
      const halo = new THREE.Mesh(keep(new THREE.RingGeometry(2.65, 2.82, 48)), keep(new THREE.MeshBasicMaterial({ color: "#7cf5ee", transparent: true, opacity: .85, side: THREE.DoubleSide, depthWrite: false })));
      halo.rotation.x = -Math.PI / 2; halo.position.y = .1; root.add(halo);
    }
    const boost = new THREE.Group(); root.add(boost);
    if (focus) {
      const glow = keep(new THREE.MeshBasicMaterial({ color: "#86fff1", transparent: true, opacity: .65, depthWrite: false }));
      for (const x of [-1.25, 1.25]) box(boost, .08, .06, 5.2, x, .25, -4.7, glow);
    }
    const updateSkin = (next: TvCarAppearance): boolean => {
      if (disposed || !appearance.skin || !next.skin) return false;
      // Painting changes pixels, not geometry. Reuse the GPU allocations for
      // pointer strokes, undo/redo and palette changes in the garage.
      paint.color.set(next.bodyColor); accent.color.set(next.accentColor);
      for (const { id } of CAR_SKIN_PANELS) {
        const texture = skinMaterials.get(id)!.map as THREE.DataTexture;
        (texture.image.data as Uint8Array).set(skinPanelRgba(next.skin, id, next.bodyColor));
        texture.needsUpdate = true;
      }
      return true;
    };
    return { root, wheels, boost, updateSkin, dispose };
  } catch (error) { dispose(); throw error; }
}
