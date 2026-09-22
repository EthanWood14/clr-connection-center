import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { createTvCarModel, carPanelUv, applyCarPanelUvs, CAR_FACE_PANELS } from "../client/src/components/tv/car-model";
import { createBlankCarSkin, CAR_SKIN_PANELS, PANEL_WIDTH, PANEL_HEIGHT } from "../shared/tv-car-skin";
import { defaultTvCarAppearance } from "../shared/tv-car";
import { CAR_SKIN_PREVIEW_VIEWS, setCarSkinPreviewCamera } from "../client/src/components/tv/car-skin-preview";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const skin = () => {
  const result = createBlankCarSkin();
  CAR_SKIN_PANELS.forEach(({ id }, index) => { result.panels[id] = index.toString(16).repeat(PANEL_WIDTH * PANEL_HEIGHT); });
  return result;
};

test("neon shop upgrades create visible geometry and higher variants take priority", () => {
  const car = createTvCarModel({ appearance: { ...defaultTvCarAppearance(7), upgrades: ["pulse-rims", "prism-rims", "plasma-underglow", "neon-underglow", "laser-headlights", "ice-headlights", "ion-cabin", "solar-fin", "holo-wing", "reactor-exhaust", "hyperdrive-trail"] }, focus: true });
  try {
    const names: string[] = [];
    car.root.traverse(node => names.push(node.name));
    for (const name of ["shop-neon-rim", "solar-crown", "ion-cabin", "holo-wing", "reactor-exhaust", "neon-underglow"]) assert.ok(names.includes(name),name);
    const light = car.root.getObjectByName('ice-headlight') as THREE.Mesh;
    assert.equal((light.material as THREE.MeshBasicMaterial).color.getHexString(),'ff58c8');
    const glow = car.root.getObjectByName('neon-underglow') as THREE.Mesh;
    assert.equal((glow.material as THREE.MeshBasicMaterial).color.getHexString(),'b67bff');
    assert.equal(car.boost.children.length,4);
  } finally {car.dispose();}
});

test("pixel repaint optimization cannot swallow equipped geometry changes", () => {
  const appearance={...defaultTvCarAppearance(7),skin:skin(),upgrades:['chrome-rims']};
  const car=createTvCarModel({appearance});
  try {
    assert.equal(car.updateSkin({...appearance,skin:skin()}),true);
    assert.equal(car.updateSkin({...appearance,upgrades:['neon-underglow']}),false);
    assert.equal(car.updateSkin({...appearance,upgrades:[]}),false);
    const replacement=createTvCarModel({appearance:{...appearance,upgrades:['neon-underglow']}});
    try {assert.ok(replacement.root.getObjectByName('neon-underglow'));} finally {replacement.dispose();}
  } finally {car.dispose();}
});

test("authored panels map to the physical roof, front, sides and back with upright UVs", () => {
  assert.deepEqual(CAR_FACE_PANELS, ["right", "left", "top", null, "nose", "rear"]);
  const size = { width: 2, height: 1, depth: 4 };
  assert.deepEqual(carPanelUv("top", { x: -1, y: .5, z: 2 }, size), [1, 1], "front of roof is the top texture row");
  assert.deepEqual(carPanelUv("left", { x: -1, y: .5, z: 2 }, size), [1, 1]);
  assert.deepEqual(carPanelUv("right", { x: 1, y: .5, z: 2 }, size), [0, 1]);
  assert.deepEqual(carPanelUv("nose", { x: 1, y: .5, z: 2 }, size), [1, 1]);
  assert.deepEqual(carPanelUv("rear", { x: 1, y: .5, z: -2 }, size), [0, 1]);
});

test("rounded body corners choose panel material by dominant triangle normal", () => {
  const original = new RoundedBoxGeometry(2, 1, 4, 2, .12);
  const geometry = applyCarPanelUvs(original, { width: 2, height: 1, depth: 4 });
  try {
    const normals = geometry.getAttribute("normal"), uv = geometry.getAttribute("uv");
    assert.equal(geometry.index, null);
    assert.equal(uv.count, geometry.getAttribute("position").count);
    assert.deepEqual(new Set(geometry.groups.map(group => group.materialIndex)), new Set([0, 1, 2, 3, 4, 5]));
    for (const group of geometry.groups) for (let start = group.start; start < group.start + group.count; start += 3) {
      const n = new THREE.Vector3();
      for (let i = 0; i < 3; i++) n.add(new THREE.Vector3().fromBufferAttribute(normals, start + i));
      const [x, y, z] = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
      const expected = y >= x && y >= z ? (n.y >= 0 ? 2 : 3) : x >= z ? (n.x >= 0 ? 0 : 1) : (n.z >= 0 ? 4 : 5);
      assert.equal(group.materialIndex, expected);
    }
    for (let i = 0; i < uv.count; i++) assert.ok(uv.getX(i) >= 0 && uv.getX(i) <= 1 && uv.getY(i) >= 0 && uv.getY(i) <= 1);
  } finally { geometry.dispose(); if (geometry !== original) original.dispose(); }
});

test("the actual car uses six distinct nearest-filtered pixel textures without livery stripes", () => {
  const appearance = { ...defaultTvCarAppearance(1), livery: "double-stripe" as const, skin: skin() };
  const model = createTvCarModel({ appearance, focus: true });
  try {
    const body = model.root.getObjectByName("body-center") as THREE.Mesh;
    const materials = body.material as THREE.MeshStandardMaterial[];
    assert.equal(materials.length, 6);
    for (const index of [0, 1, 2, 4, 5]) {
      const panel = CAR_FACE_PANELS[index]!;
      assert.equal(materials[index].name, `car-panel-${panel}`);
      const texture = materials[index].map as THREE.DataTexture;
      assert.equal(texture.name, `car-skin-${panel}`);
      assert.equal(texture.image.width, 32); assert.equal(texture.image.height, 16);
      assert.equal(texture.minFilter, THREE.NearestFilter); assert.equal(texture.magFilter, THREE.NearestFilter);
      assert.equal(texture.generateMipmaps, false); assert.equal(texture.flipY, true);
      assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
    }
    const wing = model.root.getObjectByName("skin-wing") as THREE.Mesh;
    const wingMaterials = wing.material as THREE.MeshStandardMaterial[];
    assert.ok(wingMaterials.every(material => material.name === "car-panel-wings"));
    assert.equal(model.root.getObjectByName("livery-stripe"), undefined);
    assert.equal(model.wheels.length, 4);
    assert.equal(model.boost.children.length, 2);
  } finally { model.dispose(); }
});

test("transparent skin cells become base paint rather than dark holes or photo pixels", () => {
  const appearance = { ...defaultTvCarAppearance(1), bodyColor: "#123456", skin: createBlankCarSkin(), wrapUrl: `/api/me/tv-car/wrap?v=${"a".repeat(64)}` };
  const untouched = JSON.stringify(appearance);
  const model = createTvCarModel({ appearance });
  try {
    const body = model.root.getObjectByName("body-nose") as THREE.Mesh;
    const texture = (body.material as THREE.MeshStandardMaterial[])[2].map as THREE.DataTexture;
    assert.deepEqual(Array.from(texture.image.data.slice(0, 4)), [0x12, 0x34, 0x56, 255]);
    assert.equal(JSON.stringify(appearance), untouched, "rendering a skin never removes the stored picture or paint");
  } finally { model.dispose(); }
});

test("cars without a skin retain their normal paint and stripe choices", () => {
  for (const [livery, stripeCount] of [["solid", 0], ["stripe", 2], ["double-stripe", 4]] as const) {
    const appearance = { ...defaultTvCarAppearance(1), bodyColor: "#12ab34", livery };
    const model = createTvCarModel({ appearance });
    try {
      const body = model.root.getObjectByName("body-center") as THREE.Mesh;
      assert.ok(!Array.isArray(body.material));
      assert.equal((body.material as THREE.MeshStandardMaterial).color.getHexString(), "12ab34");
      assert.equal(model.root.getObjectsByProperty("name", "livery-stripe").length, stripeCount);
      assert.equal(model.root.getObjectByName("skin-wing"), undefined);
    } finally { model.dispose(); }
  }
});

test("painting updates GPU pixel buffers in place instead of rebuilding the car", () => {
  const appearance = { ...defaultTvCarAppearance(1), skin: createBlankCarSkin() };
  const model = createTvCarModel({ appearance });
  const body = model.root.getObjectByName("body-center") as THREE.Mesh;
  const geometry = body.geometry, materials = body.material as THREE.MeshStandardMaterial[];
  const texture = materials[2].map as THREE.DataTexture, pixels = texture.image.data;
  const next = { ...appearance, bodyColor: "#445566", skin: createBlankCarSkin() };
  next.skin.palette[0] = "#ee1122"; next.skin.panels.top = `0${".".repeat(511)}`;
  assert.equal(model.updateSkin(next), true);
  assert.equal(body.geometry, geometry); assert.equal(materials[2].map, texture); assert.equal(texture.image.data, pixels);
  assert.deepEqual(Array.from(pixels.slice(0, 8)), [238, 17, 34, 255, 68, 85, 102, 255]);
  assert.equal(model.updateSkin(defaultTvCarAppearance(1)), false, "switching paint modes explicitly asks for a rebuild");
  model.dispose();
  assert.equal(model.updateSkin(next), false);
});

test("model geometry, materials and skin textures are disposed once even with shared faces", () => {
  const model = createTvCarModel({ appearance: { ...defaultTvCarAppearance(1), skin: skin() }, focus: true });
  const resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
  model.root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    resources.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      resources.add(material);
      const map = (material as THREE.MeshStandardMaterial).map; if (map) resources.add(map);
    }
  });
  const counts = new Map<object, number>();
  for (const resource of resources) resource.addEventListener("dispose", () => counts.set(resource, (counts.get(resource) ?? 0) + 1));
  model.dispose(); model.dispose();
  assert.equal(model.root.children.length, 0);
  for (const resource of resources) assert.equal(counts.get(resource), 1);
});

test("TV and garage use the exact same model and preview never auto-spins", () => {
  const race = source("../client/src/components/tv/race-scene.ts");
  const preview = source("../client/src/components/tv/car-skin-preview.tsx");
  assert.match(race, /createTvCarModel\(\{appearance:driver\.car/);
  assert.match(race, /const \{root,wheels,boost,chassis,frontSteering\}=model/);
  assert.match(race, /wheel\.rotation\.x=dynamics\.wheelAngle/);
  assert.match(preview, /import \{ createTvCarModel, type TvCarModel \} from "\.\/car-model"/);
  assert.doesNotMatch(preview, /import\("three"\)/, "do not retain Three's entire dynamic namespace");
  assert.match(source("../client/src/pages/tv-car.tsx"), /lazy\(\(\) => import\("@\/components\/tv\/car-skin-preview"\)\)/);
  assert.match(preview, /createTvCarModel\(\{ appearance: value/);
  assert.doesNotMatch(preview, /requestAnimationFrame|setInterval|autoRotate/);
  assert.match(preview, /onPointerMove=\{moveDrag\}/);
  for (const label of ["Front", "Left", "Right", "Rear", "Top"]) assert.ok(preview.includes(`label: "${label}"`));
});

test("every camera angle keeps the complete car framed with mobile margin", () => {
  const model = createTvCarModel({ appearance: { ...defaultTvCarAppearance(1), skin: skin() } });
  try {
    model.root.updateMatrixWorld(true);
    const vertices: THREE.Vector3[] = [];
    model.root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const positions = object.geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) vertices.push(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld));
    });
    for (const aspect of [.55, 230 / 300, 326 / 300, 1.5, 2]) {
      for (const { label, yaw, pitch } of CAR_SKIN_PREVIEW_VIEWS) {
        const camera = new THREE.PerspectiveCamera(38, aspect, .1, 100);
        setCarSkinPreviewCamera(camera, yaw, pitch); camera.updateMatrixWorld(true);
        for (const vertex of vertices) {
          const point = vertex.clone().project(camera);
          assert.ok(Math.abs(point.x) <= .9 && Math.abs(point.y) <= .9 && point.z > -1 && point.z < 1, `${label} at aspect ${aspect} crops ${point.toArray()}`);
        }
      }
    }
  } finally { model.dispose(); }
});

test("garage teardown covers resources, context loss and fallback uses actual authored pixels", () => {
  const preview = source("../client/src/components/tv/car-skin-preview.tsx");
  assert.match(preview, /if \(disposed\) return/);
  assert.match(preview, /observer\?\.disconnect\(\); removeContextListener\(\); model\?\.dispose\(\)/);
  assert.match(preview, /renderer\?\.dispose\(\); renderer\?\.forceContextLoss\(\); renderer\?\.domElement\.remove\(\)/);
  assert.match(preview, /removeEventListener\("webglcontextlost", contextLost\)/);
  assert.match(preview, /skinPanelRgba\(appearance\.skin, panel, appearance\.bodyColor\)/);
  assert.match(preview, /imageRendering: "pixelated"/);
  assert.match(preview, /cancelled = true; control\.current = null; cleanup\(\)/);
});


test("era bodies have different silhouettes and all new attachments survive skin rendering", () => {
  for(const body of ['body-f1-60s','body-f1-90s','body-f1-modern','body-stock-80s','body-stock-modern','body-pickup','body-van','body-suv']) {
    for(const passenger of ['rubber-duck','goose-copilot','alien-copilot','helmet-buddy']) {
      const model=createTvCarModel({appearance:{...defaultTvCarAppearance(7),skin:skin(),upgrades:[body,passenger,'double-decker-wing']}});
      try {
        assert.equal(model.root.userData.bodyStyle,body);
        assert.ok(model.root.getObjectByName(passenger));assert.ok(model.root.getObjectByName('double-decker-wing'));
        assert.equal(model.wheels.length,4);assert.equal(model.frontSteering.length,2);
        if(body.includes('stock')) {assert.ok(model.root.getObjectByName('stock-roof'));assert.ok(!model.root.getObjectByName('body-nose'));}
        else if(['body-pickup','body-van','body-suv'].includes(body)) assert.ok(model.root.getObjectByName('utility-chassis'));
        else assert.ok(model.root.getObjectByName('body-nose'));
        if(body==='body-f1-60s') assert.ok(!model.root.getObjectByName('body-sidepods'));
        if(body==='body-f1-modern') assert.ok(model.root.getObjectByName('modern-halo'));
        const bounds=new THREE.Box3().setFromObject(model.chassis);
        assert.ok(bounds.max.y<3.0);assert.ok(bounds.max.x<1.8);assert.ok(bounds.min.x> -1.8);
      } finally {model.dispose();}
    }
  }
});
