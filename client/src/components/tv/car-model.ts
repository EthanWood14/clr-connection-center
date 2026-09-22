import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { isSafeTvCarWrapUrl, type TvCarAppearance } from "@shared/tv-car";
import { SHOP_HAT_IDS, SHOP_PASSENGER_IDS, shopHatLook, shopPassengerLook } from "@shared/tv-car-shop";
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

export type TvCarModel = { root: THREE.Group; chassis: THREE.Group; frontSteering: THREE.Group[]; wheels: THREE.Group[]; boost: THREE.Group; updateSkin: (appearance: TvCarAppearance) => boolean; dispose: () => void };
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
    const upgrades = new Set(appearance.upgrades ?? []);
    const pickup = upgrades.has("body-pickup"), van = upgrades.has("body-van"), suv = upgrades.has("body-suv");
    const utility = pickup || van || suv;
    const stock = utility || upgrades.has("body-stock-80s") || upgrades.has("body-stock-modern");
    const classic = upgrades.has("body-f1-60s");
    const nineties = upgrades.has("body-f1-90s");
    const modern = upgrades.has("body-f1-modern");
    root.userData.bodyStyle = [...upgrades].find(id => id.startsWith("body-")) ?? "default";
    const material = (color: string, roughness = .55, metalness = .1) => keep(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
    // Race paint is lacquered, not plastic. A clearcoat over the body colour
    // is most of what makes the car read as a real one under track lights —
    // it picks up the sky, the stands and the lamps as it turns.
    const gloss = (color: string, roughness = .26) => keep(new THREE.MeshPhysicalMaterial({ color, roughness, metalness: .42, clearcoat: 1, clearcoatRoughness: .07 }));
    const paint = gloss(appearance.bodyColor), accent = material(appearance.accentColor, .34, .2);
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
    const bodyPaint = pictureVisible ? gloss(appearance.bodyColor, .38) : paint;
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
    if (utility) {
      rounded("utility-chassis",1.92,.5,4.7,0,.71,.2,bodyPaint,.08,true);
      const tint=upgrades.has("ion-cabin")?material("#8854ce"):upgrades.has("cabin-leds")?material("#259e96"):glass;
      if(pickup) {
        rounded("pickup-cab",2.02,.83,1.85,0,1.32,.56,bodyPaint,.07,true);
        box(root,1.77,.48,.035,0,1.44,1.505,tint).name="pickup-windshield";
        for(const x of [-1.025,1.025]) box(root,.025,.45,1.35,x,1.44,.55,tint);
        box(root,1.85,.05,1.55,0,1,-1.33,black).name="pickup-bed";
        for(const x of [-1.04,1.04]) box(root,.13,.5,1.75,x,1.2,-1.32,bodyPaint);
        box(root,2.15,.5,.12,0,1.2,-2.16,bodyPaint).name="pickup-tailgate";
      } else {
        rounded(van?"van-cargo-box":"suv-cabin",2.05,1.05,van?3.58:2.85,0,1.34,van?-.08:-.26,bodyPaint,.08,true);
        box(root,1.8,.52,.04,0,1.57,van?1.73:1.19,tint).name="utility-windshield";
        for(const x of [-1.04,1.04]) {
          box(root,.035,.48,van?1.0:2.2,x,1.55,van?1.05:-.08,tint).name="utility-side-window";
          if(suv) box(root,.07,.08,2.7,x*.82,1.96,-.24,black).name="suv-roof-rail";
        }
        if(van) {box(root,.04,.95,.04,0,1.32,-1.89,black).name="van-rear-doors";for(const x of [-.12,.12]) box(root,.05,.16,.06,x,1.3,-1.93,steel);}
        if(suv) {const spare=new THREE.Mesh(keep(new THREE.TorusGeometry(.29,.12,10,20)),rubber);spare.position.set(.48,1.19,-2.15);spare.name="suv-spare-tire";root.add(spare);}
      }
      for(const x of [-1.04,1.04]) {
        for(const z of [-1.42,1.6]) box(root,.26,.13,.99,x,.97,z,black).name="utility-fender";
        box(root,.22,.13,.2,x*1.11,1.38,1.02,upgrades.has("carbon-mirrors")?black:accent).name="mirror";
      }
      for(const z of [-2.23,2.58]) box(root,2.19,.19,.17,0,.55,z,steel).name="utility-bumper";
      box(root,1.3,.26,.05,0,.9,2.57,black).name="utility-grille";
      for(const x of [-.78,.78]) box(root,.36,.22,.06,x,1.04,2.57,material("#e5f4ff"));
      box(root,.22,.13,.06,0,.87,-2.3,upgrades.has("gold-rain-light")?material("#f1d552"):accent).name="rain-light";
      if(upgrades.has("trophy-fin")||upgrades.has("solar-fin")) box(root,.08,.3,.8,0,2,-.8,material("#f1d552")).name="shark-fin";
    } else if (stock) {
      const retro = upgrades.has("body-stock-80s");
      rounded("stock-body", 1.85, .46, 4.9, 0, .65, .25, bodyPaint, retro ? .04 : .22, true);
      rounded("stock-hood", 2.12, .16, 1.7, 0, .94, 1.6, bodyPaint, .08, true);
      const stockGlass = upgrades.has("ion-cabin") || upgrades.has("cabin-leds") ? keep(new THREE.MeshStandardMaterial({color:upgrades.has("ion-cabin")?"#8a5cec":"#38b8ad",emissive:upgrades.has("ion-cabin")?"#5326a9":"#125e57",emissiveIntensity:.5,roughness:.25})) : glass;
      rounded("stock-cabin", 1.8, retro ? .6 : .48, retro ? 1.75 : 1.95, 0, retro ? 1.17 : 1.12, -.12, stockGlass, retro ? .06 : .25);
      rounded("stock-roof", retro ? 1.78 : 1.6, .12, retro ? 1.35 : 1.12, 0, retro ? 1.51 : 1.42, -.23, bodyPaint, .07, true);
      if (SHOP_PASSENGER_IDS.some(id=>upgrades.has(id))) box(root,.65,.02,.7,.38,1.58,-.18,black).name="passenger-sunroof";
      for (const x of [-.92,.92]) {
        box(root,.1,.58,.1,x,1.22,.53,accent).rotation.x=-.25;
        box(root,.1,.56,.1,x,1.22,-.85,accent).rotation.x=.3;
        box(root,.22,.37,1.93,x*1.17,.67,.1,bodyPaint).name="stock-door";
        for(const z of [-1.42,1.6]) box(root,.28,.12,.95,x*1.17,.96,z,bodyPaint).name="stock-fender";
      }
      for(const x of [-1.04,1.04]) box(root,.22,.12,.17,x,1.06,.55,upgrades.has("carbon-mirrors")?material("#181818"):accent).name="mirror";
      if(upgrades.has("trophy-fin")||upgrades.has("solar-fin")) box(root,.08,.3,.85,0,1.33,-1.45,material("#f1d552")).name="shark-fin";
      box(root,.25,.1,.06,0,.8,-2.23,upgrades.has("gold-rain-light")?material("#f1d552"):accent).name="rain-light";
      if(upgrades.has("spark-exhaust")) box(root,.18,.14,.16,.4,.46,-2.25,material("#e07a3a")).name="exhaust";
      box(root,2.1,.2,.07,0,.68,2.73,black).name="stock-grille";
      for(const x of [-.75,.75]) box(root,.42,.13,.06,x,.94,2.7,material("#e7f6ff"));
      box(root,2.35,.08,.3,0,.37,2.67,black).name="stock-splitter";
      const lip=box(root,2.13,.25,.08,0,1.03,-2.05,accent);lip.rotation.x=-.25;lip.name="stock-spoiler";
    } else {
    rounded("body-center", classic ? .85 : 1.5, .4, 3.65, 0, .6, 0, bodyPaint, .16, true);
    rounded("body-nose", .58, .24, 1.7, 0, nineties ? .72 : .5, 2.05, bodyPaint, .1, true);
    if (!classic) rounded("body-sidepods", modern ? 2.2 : 2, modern ? .38 : .24, 1.9, 0, .48, -.55, bodyPaint, .13, true);
    box(root, 2.15, .09, 4.4, 0, .27, .05, black);
    const cabinGlass = (upgrades.has("cabin-leds") || upgrades.has("ion-cabin"))
      ? keep(new THREE.MeshPhysicalMaterial({ color: upgrades.has("ion-cabin") ? "#7c4ace" : "#1a5a58", roughness: .2, metalness: .35, clearcoat: 1, emissive: upgrades.has("ion-cabin") ? "#6633aa" : "#0a3d3a", emissiveIntensity: .45 }))
      : glass;
    rounded("cockpit", .92, .4, 1.4, 0, .92, -.25, cabinGlass, .2);
    const helmet = new THREE.Mesh(keep(new THREE.SphereGeometry(.24, 12, 8)), accent); helmet.position.set(0, 1.16, -.13); root.add(helmet);
    const wing = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
      if (!appearance.skin) return box(root, w, h, d, x, y, z, mat);
      const original = keep(new THREE.BoxGeometry(w, h, d));
      const geometry = keep(applyCarPanelUvs(original, { width: w, height: h, depth: d }));
      const mesh = new THREE.Mesh(geometry, Array(6).fill(skinMaterials.get("wings")));
      mesh.name = "skin-wing"; mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; root.add(mesh); return mesh;
    };
    if (!classic) {
    wing(2.45, .12, .56, 0, .42, 2.67, black); wing(2.5, .06, .24, 0, .57, 2.45, paint);
    wing(2.25, .15, .62, 0, 1.1, -2.05, paint); wing(2.25, .09, .42, 0, nineties ? 1.7 : 1.34, -2.12, black);
    for (const x of [-.88, .88]) box(root, .09, .65, .24, x, .84, -2.05, black);
    }
    for (const x of [-.38, .38]) box(root, .08, .34, .75, x, 1.11, -.22, black);
    box(root, .8, .09, .12, 0, 1.29, .16, black);
    // Detail that only shows up in a close-up, which is nearly every shot the
    // corner takes now (owner, 16 Sep 2026: "also make the car look better").
    // All of it is decoration: nothing here touches the wheels, the track
    // anchor or the skin panels.
    rounded("engine-cover", .62, .5, 1.25, 0, .96, -1.06, bodyPaint, .22);
    if (!classic && !nineties) box(root, .07, .36, 1.45, 0, 1.28, -1.45, (upgrades.has("trophy-fin") || upgrades.has("solar-fin")) ? material("#f1d552", .28, .55) : bodyPaint).name = "shark-fin";
    const mirrorMat = upgrades.has("carbon-mirrors") ? material("#1a1a1a", .85, .15) : black;
    for (const x of [-.58, .58]) {
      box(root, .2, .1, .08, x, 1, .42, mirrorMat).name = "mirror";
      box(root, .3, .04, .04, x * .74, .99, .42, upgrades.has("carbon-mirrors") ? mirrorMat : steel).name = "mirror-stalk";
    }
    if (!classic) for (const x of [-1.2, 1.2]) box(root, .05, .34, .62, x, .5, 2.67, accent).name = "front-endplate";
    if (!classic) for (const x of [-1.12, 1.12]) box(root, .05, .52, .68, x, 1.14, -2.06, accent).name = "rear-endplate";
    box(root, 1.85, .26, .62, 0, .26, -1.95, black).name = "diffuser";
    for (const x of [-.55, 0, .55]) box(root, .05, .3, .58, x, .3, -1.95, steel).name = "strake";
    const exhaust = new THREE.Mesh(keep(new THREE.CylinderGeometry(.09, .12, .3, 10)), upgrades.has("spark-exhaust") ? material("#e07a3a", .4, .55) : steel);
    exhaust.name = "exhaust"; exhaust.rotation.x = Math.PI / 2; exhaust.position.set(0, .74, -1.78);
    exhaust.castShadow = true; root.add(exhaust);
    box(root, .18, .07, .05, 0, .62, -2.02, upgrades.has("gold-rain-light") ? material("#f1d552", .3, .4) : accent).name = "rain-light";
    box(root, .22, .08, .06, 0, 1.19, .03, black).name = "visor";
    const stripeOffsets = appearance.skin ? [] : appearance.livery === "double-stripe" ? [-.16, .16] : appearance.livery === "stripe" ? [0] : [];
    for (const x of stripeOffsets) {
      const width = appearance.livery === "double-stripe" ? .12 : .2;
      box(root, width, .015, 1.55, x, .812, 1, accent).name = "livery-stripe";
      box(root, width, .015, 1.05, x, .628, 2.3, accent).name = "livery-stripe";
    }
    if (modern) {
      const halo = new THREE.Mesh(keep(new THREE.TorusGeometry(.43,.045,8,20,Math.PI)),black);
      halo.rotation.x=Math.PI/2;halo.position.set(0,1.37,-.05);halo.name="modern-halo";root.add(halo);
      box(root,.065,.32,.07,0,1.25,.37,black);
      for(const z of [2.35,2.53,2.72]) box(root,2.65,.05,.15,0,.61,z,accent).name="modern-front-aero";
    }
    }
    if (upgrades.has("matte-hood")) {
      box(root, .28, .02, 1.7, 0, stock ? 1.035 : .72, 1.55, material("#1a1a1a", .95, .05)).name = "matte-hood";
    }
    if (upgrades.has("ice-headlights") || upgrades.has("laser-headlights")) {
      for (const x of [-.22, .22]) {
        box(root, .14, .08, .06, x, stock ? .94 : .52, 2.85, keep(new THREE.MeshBasicMaterial({ color: upgrades.has("laser-headlights") ? "#ff58c8" : "#9ad8ff" }))).name = "ice-headlight";
      }
    }
    if (upgrades.has("champion-plate")) {
      box(root, .7, .02, .32, 0, stock ? 1.04 : .82, 1.26, material("#f1d552", .35, .5)).name = "champion-plate";
    }
    const wheels: THREE.Group[] = [], wheelMounts: THREE.Group[] = [], frontSteering: THREE.Group[] = [];
    // Rounder tires, a coloured rim, and two cross-spokes whose ends show past
    // the rim — without something asymmetric on the wheel, a spinning cylinder
    // looks like a stationary one however fast it is actually turning.
    const wheelGeometry = keep(new THREE.CylinderGeometry(.43, .43, .34, 24)), rimGeometry = keep(new THREE.CylinderGeometry(.27, .27, .36, 18));
    for (const x of (stock ? [-1.14, 1.14] : [-1.03, 1.03])) for (const z of [-1.42, 1.6]) {
      const mount = new THREE.Group(); mount.name = z > 0 ? "front-wheel-steering" : "rear-wheel-mount";
      mount.position.set(x, .45, z); root.add(mount); wheelMounts.push(mount);
      if (z > 0) frontSteering.push(mount);
      const pivot = new THREE.Group(); pivot.name = "wheel-spin"; mount.add(pivot);
      const tire = new THREE.Mesh(wheelGeometry, rubber); tire.rotation.z = Math.PI / 2; tire.castShadow = true; pivot.add(tire);
      const rim = new THREE.Mesh(rimGeometry, upgrades.has("chrome-rims") ? steel : accent); rim.rotation.z = Math.PI / 2; pivot.add(rim); wheels.push(pivot);
      if (upgrades.has("pulse-rims") || upgrades.has("prism-rims")) {
        for (const side of [-1, 1]) {
          const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(.29, .035, 8, 24)), keep(new THREE.MeshBasicMaterial({color: upgrades.has("prism-rims") && z < 0 ? "#ff69db" : "#38e8ff"})));
          ring.name = "shop-neon-rim"; ring.rotation.y = Math.PI / 2; ring.position.x = side * .19; pivot.add(ring);
        }
      }
      for (const turn of [0, Math.PI / 2]) {
        const spoke = new THREE.Mesh(unitBox, black); spoke.name = "wheel-spoke";
        spoke.scale.set(.4, .54, .055); spoke.rotation.x = turn; pivot.add(spoke);
      }
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
        number.rotation.x = -Math.PI / 2; number.position.set(0, stock ? 1.06 : .845, 1.26); root.add(number);
      }
    }
    if (focus) {
      const halo = new THREE.Mesh(keep(new THREE.RingGeometry(2.65, 2.82, 48)), keep(new THREE.MeshBasicMaterial({ color: "#7cf5ee", transparent: true, opacity: .85, side: THREE.DoubleSide, depthWrite: false })));
      halo.name = "focus-halo"; halo.rotation.x = -Math.PI / 2; halo.position.y = .1; root.add(halo);
    }
    if (upgrades.has("neon-underglow") || upgrades.has("plasma-underglow")) {
      const neon = keep(new THREE.MeshBasicMaterial({ color: upgrades.has("plasma-underglow") ? "#b67bff" : "#5cf0ff", transparent: true, opacity: .75, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      const under = new THREE.Mesh(keep(new THREE.RingGeometry(1.15, 1.55, 40)), neon);
      under.name = "neon-underglow"; under.rotation.x = -Math.PI / 2; under.scale.y = 1.85; under.position.y = .08; root.add(under);
    }
    if (upgrades.has("solar-fin")) {
      for (const z of [-1.8, -1.4, -1]) box(root, .1, .22, .12, 0, utility ? 2.2 : 1.55, utility ? z + .6 : z, keep(new THREE.MeshBasicMaterial({color:"#ffdc73"}))).name = "solar-crown";
    }
    if (upgrades.has("ion-cabin")) {
      for (const x of [-.3, .3]) box(root, .045, .045, .65, x, 1.08, .2, keep(new THREE.MeshBasicMaterial({color:"#a78bfa"}))).name = "ion-cabin";
    }
    if (upgrades.has("holo-wing")) {
      box(root, 2.35, .07, .48, 0, 1.46, -2.12, keep(new THREE.MeshBasicMaterial({color:"#51edff",transparent:true,opacity:.85,toneMapped:false}))).name = "holo-wing";
      for (const x of [-1.17, 1.17]) box(root, .05, .38, .7, x, 1.3, -2.12, keep(new THREE.MeshBasicMaterial({color:"#ff58c8",toneMapped:false})));
    }
    const aeroY = stock ? 1.5 : 1.65;
    if (upgrades.has("ducktail-spoiler")) {
      const lip=box(root,2.3,.28,.18,0,stock?1.1:1.48,-2.15,accent);lip.rotation.x=-.5;lip.name="ducktail-spoiler";
    }
    if (upgrades.has("double-decker-wing")) {
      for(const y of [aeroY,aeroY+.35]) box(root,2.65,.09,.52,0,y,-2.15,material("#d877ed",.3,.5)).name="double-decker-wing";
      for(const x of [-1.3,1.3]) box(root,.07,.75,.6,x,aeroY,-2.15,black);
    }
    if (upgrades.has("angel-wing")) {
      for(const side of [-1,1]) for(let i=0;i<5;i++) {
        const feather=rounded("angel-wing",.18,.12,.9+i*.1,side*(.4+i*.22),aeroY+i*.07,-1.95,material("#fff0ce",.3,.2),.06);
        feather.rotation.z=side*.25;feather.rotation.y=side*(.25+i*.09);
      }
    }
    // Who is riding along, and what is on their head. Both are read from the
    // look tables in shared/tv-car-shop.ts rather than a chain of id checks,
    // so a new character is a row of data and no new geometry code (owner, 22
    // Sep 2026: "add more characters that you can add, like a clown, hat,
    // panda, etc.").
    const rider = shopPassengerLook(SHOP_PASSENGER_IDS.find(id=>upgrades.has(id)));
    const hat = shopHatLook(SHOP_HAT_IDS.find(id=>upgrades.has(id)));
    if(rider || hat) {
      const buddy=new THREE.Group();
      buddy.name=rider?.id ?? hat!.id;
      // With a passenger the group is the passenger seat. With only a hat it
      // sits on the driver's own helmet, which is the point of the hat being
      // its own slot rather than part of a character.
      buddy.position.set(rider ? .38 : 0, utility ? 1.78 : rider ? (stock ? 1.5 : 1.13) : (stock ? 1.53 : 1.16), utility && pickup ? .5 : rider ? -.18 : -.13);
      root.add(buddy);
      const orb=(r:number,x:number,y:number,z:number,mat:THREE.Material,sx=1,sy=1,sz=1)=>{
        const m=new THREE.Mesh(keep(new THREE.SphereGeometry(r,16,12)),mat);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;buddy.add(m);return m;
      };
      const cone=(r:number,h:number,x:number,y:number,z:number,mat:THREE.Material)=>{
        const m=new THREE.Mesh(keep(new THREE.ConeGeometry(r,h,12)),mat);m.position.set(x,y,z);m.castShadow=true;buddy.add(m);return m;
      };
      let headY = 0, headR = .24;
      if(rider) {
        const skin=material(rider.body,.45), face=material(rider.head ?? rider.body,.45);
        headY = rider.neck ? .74 : .43; headR = .23;
        orb(.27,0,.12,0,skin,1,.8,1.2);
        if(rider.neck) box(buddy,.12,.48,.12,0,.44,.06,skin);
        orb(headR,0,headY,.11,face,1,rider.eyes==="big"?1.25:1,1);
        if(rider.beak) box(buddy,.24,.09,.24,0,headY-.05,.34,material(rider.beak));
        if(rider.nose) orb(.08,0,headY-.02,.33,material(rider.nose));
        if(rider.hair) for(const x of [-.22,.22]) orb(.12,x,headY+.04,.01,material(rider.hair));
        if(rider.ears) {
          const ear=material(rider.ears);
          for(const x of [-.16,.16]) rider.pointedEars ? cone(.09,.22,x,headY+.24,.03,ear) : orb(.09,x,headY+.19,.02,ear);
        }
        if(rider.patches) for(const x of [-.105,.105]) orb(.1,x,headY+.02,.16,material(rider.patches),1,1.15,.55);
        if(rider.fin) {
          const spine=material(rider.fin);
          for(let i=0;i<3;i++) cone(.07-i*.014,.2-i*.03,0,.3+i*.12,-.16-i*.04,spine);
        }
        if(rider.antenna) {
          box(buddy,.035,.2,.035,0,headY+.3,.02,material("#8d97a3"));
          orb(.06,0,headY+.42,.02,material(rider.antenna));
        }
        if(rider.eyes==="visor") box(buddy,.33,.13,.05,0,headY,.32,black);
        else for(const x of [-.095,.095]) orb(rider.eyes==="big"?.085:.035,x,headY+.025,.303,black,1,rider.eyes==="big"?1.35:1,.4);
        if(rider.wave) {
          const arm=box(buddy,.12,.43,.12,.31,.39,0,skin);arm.rotation.z=-.4;
          orb(.09,.4,.61,0,material("#ffd0aa"));
        }
      }
      if(hat) {
        const crown=material(hat.crown,.5), band=material(hat.band ?? hat.crown,.5);
        // Clear of the ears and the hair, and of the helmet when nobody is riding.
        const brimY=headY+(rider?headR*.82:.2);
        if(hat.shape==="stovepipe") {
          box(buddy,.52,.03,.52,0,brimY,.02,crown).name="hat-brim";
          box(buddy,.34,.36,.34,0,brimY+.2,.02,crown).name="hat-crown";
          box(buddy,.35,.07,.35,0,brimY+.09,.02,band).name="hat-band";
        } else if(hat.shape==="cone") {
          cone(.19,.46,0,brimY+.23,.02,crown).name="hat-crown";
          orb(.07,0,brimY+.48,.02,band).name="hat-pom";
        } else if(hat.shape==="wide") {
          const brim=new THREE.Mesh(keep(new THREE.CylinderGeometry(.42,.42,.03,16)),crown);
          brim.position.set(0,brimY,.02);brim.castShadow=true;brim.name="hat-brim";buddy.add(brim);
          orb(.2,0,brimY+.09,.02,crown,1,.85,1).name="hat-crown";
          box(buddy,.36,.05,.36,0,brimY+.07,.02,band).name="hat-band";
        } else {
          const ring=new THREE.Mesh(keep(new THREE.CylinderGeometry(.24,.24,.12,14)),crown);
          ring.position.set(0,brimY+.06,.02);ring.castShadow=true;ring.name="hat-crown";buddy.add(ring);
          for(let i=0;i<5;i++) {
            const a=i*Math.PI*2/5;
            cone(.05,.14,Math.cos(a)*.2,brimY+.18,.02+Math.sin(a)*.2,band).name="hat-point";
          }
        }
      }
    }
    if (upgrades.has("reactor-exhaust")) {
      for (const x of [-.28, .28]) {
        const port = new THREE.Mesh(keep(new THREE.TorusGeometry(.14,.045,8,20)),keep(new THREE.MeshBasicMaterial({color:"#976dff"})));
        port.name="reactor-exhaust"; port.position.set(x,.65,-2.4); root.add(port);
        box(root,.14,.14,.03,x,.65,-2.42,keep(new THREE.MeshBasicMaterial({color:"#64ffda"})));
      }
    }
    const boost = new THREE.Group(); root.add(boost);
    if (focus) {
      const plume = upgrades.has("hyperdrive-trail") ? "#64ffda" : upgrades.has("victory-plume") ? "#ffb347" : "#86fff1";
      const glow = keep(new THREE.MeshBasicMaterial({ color: plume, transparent: true, opacity: .65, depthWrite: false }));
      for (const x of (upgrades.has("hyperdrive-trail") ? [-1.25, -.7, .7, 1.25] : [-1.25, 1.25])) box(boost, .08, .06, 5.2, x, .25, -4.7, glow);
    }
    // Articulate the sprung body without moving the track anchor or tire contact
    // points. Identity transforms keep the garage's static model unchanged.
    const chassis = new THREE.Group(); chassis.name = "car-chassis";
    for (const child of [...root.children]) {
      if (child !== boost && child.name !== "focus-halo" && !wheelMounts.includes(child as THREE.Group)) chassis.add(child);
    }
    root.add(chassis);
    const updateSkin = (next: TvCarAppearance): boolean => {
      if (disposed || !appearance.skin || !next.skin) return false;
      // Equipment changes geometry. Repainting an existing skin cannot add/remove parts.
      if (Array.from(upgrades).sort().join("|") !== [...(next.upgrades ?? [])].sort().join("|")
        || appearance.livery !== next.livery || appearance.wrapUrl !== next.wrapUrl) return false;
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
    return { root, chassis, frontSteering, wheels, boost, updateSkin, dispose };
  } catch (error) { dispose(); throw error; }
}
