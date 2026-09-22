import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { raceSceneryClipPlane, RACE_SCENERY_CAR_MARGIN, type Point3 } from "../shared/tv-race-scenery";
import { raceCameraPose, raceCameraRadius, raceCameraSubjects } from "../shared/tv-race-camera";
import { planRaceTransition, interpolateRaceTransition } from "../shared/tv-race-transition";
import { raceTrackPoint } from "../shared/tv-race-grid";

const driver = (id: number, transfersToday: number) => ({ id, name: `Driver ${id}`, transfersToday });
const dot = (a: Point3, b: Point3) => a.x * b.x + a.y * b.y + a.z * b.z;
const signed = (point: Point3, plane: ReturnType<typeof raceSceneryClipPlane>) => dot(point, plane.normal) + plane.constant;

test("scenery clipping starts five metres behind the farthest car, not at the nearest rival", () => {
  const camera = { x: 0, y: 0, z: 100 }, target = { x: 0, y: 0, z: 0 };
  const racers = [{ x: 0, y: 0, z: 20 }, { x: 0, y: 0, z: -10 }];
  const plane = raceSceneryClipPlane(camera, target, racers);
  assert.deepEqual(plane, { normal: { x: 0, y: 0, z: -1 }, constant: -15 });
  assert.equal(signed(racers[1], plane), -RACE_SCENERY_CAR_MARGIN);
  assert.ok(signed(camera, plane) < 0, "decorative scenery beside the lens is clipped");
  assert.ok(signed({ x: 0, y: 0, z: 5 }, plane) < 0, "scenery between the two cars is also clipped");
  assert.ok(signed({ x: 0, y: 0, z: -30 }, plane) > 0, "distant scenery behind every car remains");
});

test("all car body corners remain in the scenery-free half-space for tie, pass and large-panorama shots", () => {
  const scenarios = [
    { before: [driver(1, 5), driver(2, 4.5)], after: [driver(1, 5), driver(2, 5)], focus: 2 },
    { before: [driver(1, 5), driver(2, 4), driver(3, 3)], after: [driver(1, 5), driver(2, 4), driver(3, 6)], focus: 3 },
    { before: null, after: Array.from({ length: 32 }, (_, i) => driver(i + 1, 31 - i)), focus: undefined },
  ];
  for (const scenario of scenarios) for (const aspect of [.5, 16 / 9, 2.4]) {
    const plans = planRaceTransition(scenario.before, scenario.after, scenario.focus);
    const subjects = raceCameraSubjects(plans, scenario.focus), radius = raceCameraRadius(subjects);
    for (const reduced of [false, true]) for (const t of [0, 2.8, 4.5, 7.2, 11.8]) {
      const elapsed = reduced ? 12 : t, lead = .06 + (reduced ? 4.6 * .115 : t * .575);
      const camera = raceCameraPose(subjects, elapsed, lead, aspect, radius);
      const positions = plans.map(row => {
        const sample = interpolateRaceTransition(row, elapsed), angle = lead - sample.distance / 42;
        return { ...raceTrackPoint(angle, sample.lane), angle };
      });
      const plane = raceSceneryClipPlane(camera.position, camera.target, positions);
      assert.ok(Math.abs(Math.hypot(plane.normal.x, plane.normal.y, plane.normal.z) - 1) < 1e-12);
      for (const point of positions) {
        assert.ok(signed(point, plane) <= -RACE_SCENERY_CAR_MARGIN + 1e-9);
        for (const x of [-1.6, 1.6]) for (const y of [-.12, 1.6]) for (const z of [-2.5, 3.1]) {
          const corner = {
            x: point.x + x * Math.cos(point.angle) - z * Math.sin(point.angle),
            y: point.y + y,
            z: point.z + x * Math.sin(point.angle) + z * Math.cos(point.angle),
          };
          assert.ok(signed(corner, plane) < 0, `scenery can obstruct bodywork: ${aspect}/${elapsed}/${reduced}`);
        }
      }
      const depth = -signed(camera.position, plane) + 25;
      const background = {
        x: camera.position.x + plane.normal.x * depth,
        y: camera.position.y + plane.normal.y * depth,
        z: camera.position.z + plane.normal.z * depth,
      };
      assert.ok(signed(background, plane) > 24.999, "far scenery is retained for every shot");
    }
  }
});

test("the plane is deterministic, world-space and does not mutate caller coordinates", () => {
  const camera = Object.freeze({ x: 65, y: 9, z: -24 }), target = Object.freeze({ x: 34, y: 1.8, z: -16 });
  const racers = Object.freeze([Object.freeze({ x: 36, y: 1, z: -14 }), Object.freeze({ x: 31, y: 1, z: -20 })]);
  const before = JSON.stringify({ camera, target, racers });
  assert.deepEqual(raceSceneryClipPlane(camera, target, racers), raceSceneryClipPlane(camera, target, [...racers].reverse()));
  assert.equal(JSON.stringify({ camera, target, racers }), before);
});

test("empty, singular and malformed previews return finite planes", () => {
  const origin = { x: 0, y: 0, z: 0 }, invalid = { x: NaN, y: Infinity, z: -Infinity };
  for (const [camera, target, racers] of [
    [origin, origin, []],
    [origin, { x: 0, y: 0, z: -10 }, []],
    [invalid, invalid, [invalid]],
    [origin, origin, [invalid, { x: 0, y: 0, z: -2 }]],
    [{ x: 1e308, y: 1e308, z: 1e308 }, { x: -1e308, y: -1e308, z: -1e308 }, []],
  ] as [Point3, Point3, Point3[]][]) {
    const plane = raceSceneryClipPlane(camera, target, racers);
    assert.ok([...Object.values(plane.normal), plane.constant].every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(plane.normal.x, plane.normal.y, plane.normal.z) - 1) < 1e-12);
  }
});

test("the renderer clips only opted-in decorations and updates from every actual car before drawing", () => {
  const scene = readFileSync(new URL("../client/src/components/tv/race-scene.ts", import.meta.url), "utf8");
  const model = readFileSync(new URL("../client/src/components/tv/car-model.ts", import.meta.url), "utf8");
  assert.match(scene, /renderer\.localClippingEnabled\s*=\s*true/);
  assert.doesNotMatch(scene, /renderer\.clippingPlanes\s*=/, "global clipping would also remove the track and cars");
  assert.match(scene, /mat\.clippingPlanes\s*=\s*\[sceneryPlane\];\s*mat\.clipShadows\s*=\s*true/);
  assert.equal((scene.match(/\.clippingPlanes\s*=/g) ?? []).length, 1, "only the explicit decorative-material helper assigns clipping");
  const optIns = scene.split(/\r?\n/).filter(line => line.includes("sceneryMaterial("));
  assert.equal(optIns.length, 8);
  for (const line of optIns) {
    assert.match(line.trim(), /^const (?:steel|wallWhite|standMat|crowdCount|heads|lampMat|cityMat|bannerMaterial)\b/,
      "only poles, separate walls, stands, people, lights, the city and banners opt in");
  }
  assert.match(scene, /const white\s*=\s*material\(/);
  assert.match(scene, /red\s*=\s*material\(/);
  assert.match(scene, /const wallWhite\s*=\s*sceneryMaterial\(/, "wall clipping does not leak into the shared curb colors");
  assert.doesNotMatch(scene, /(?:asphalt|grass|sand|skid)\s*=\s*sceneryMaterial\(/);
  assert.doesNotMatch(model, /clippingPlanes|sceneryMaterial/);
  assert.match(scene, /raceSceneryClipPlane\(shot\.position,shot\.target,racers\.map\(r=>r\.root\.position\)\)/);
  assert.match(scene, /sceneryPlane\.normal\.set\(sceneryClip\.normal\.x,sceneryClip\.normal\.y,sceneryClip\.normal\.z\);sceneryPlane\.constant=sceneryClip\.constant/);
  const update = scene.indexOf("const sceneryClip=");
  assert.ok(update > scene.indexOf("root.position.set(point.x,point.y,point.z)"), "use this frame's positions, not the prior frame");
  assert.ok(update < scene.indexOf("renderer.render(scene,camera)", update), "the plane updates before rendering the shot");
});

test("the fly-through has a safe peripheral fan cue and grass confined inside the road",()=>{
  const scene=readFileSync(new URL("../client/src/components/tv/race-scene.ts",import.meta.url),"utf8");
  assert.match(scene,/CircleGeometry\(27\.5,96\)/);
  assert.match(scene,/infield\.position\.y=-\.20/);
  assert.match(scene,/const a=i\*2\.3999632297,r=27\*Math\.sqrt/);
  assert.match(scene,/fanFrame\.visible=fanOpacity>0/);
  // The lens prop belongs to the transfer race's grandstand POV only: the
  // corner's three-minute broadcast never shows it, because fading it out
  // two seconds in read as the stand dissolving (owner, 16 Sep 2026).
  assert.match(scene,/const fanOpacity=options\.reduced\|\|options\.spotlight\|\|options\.stableCamera\?0:/);
  assert.match(scene,/camera\.rotateZ\(options\.reduced\?0:shot\.roll\)/);
  assert.match(scene,/side:THREE\.FrontSide/);
  assert.match(scene,/back\.rotation\.y=Math\.PI/,'infield banners have their own readable face instead of mirrored lettering');
});

// "Can you make the background look more real, like in NYC or something?" —
// Ethan, 16 Sep 2026. The ring of green cones is gone.
test("the horizon is a city, drawn once and lit from a baked window map", () => {
  const scene = readFileSync(new URL("../client/src/components/tv/race-scene.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.doesNotMatch(scene, /ConeGeometry\(22/, "the hills are gone");
  // Sixty-four towers in ONE draw call. A skyline of separate meshes on a
  // kiosk is how the wall starts dropping frames.
  assert.match(scene, /const city=keep\(new THREE\.InstancedMesh\(unitBox,cityMat,64\)\);/);
  assert.match(scene, /city\.castShadow=city\.receiveShadow=false;/, "the skyline never enters the shadow pass");
  // Lit windows are a baked canvas, not a network request: a TV that loses
  // its connection still has a city behind the cars.
  assert.match(scene, /const cityCanvas=document\.createElement\("canvas"\)/);
  assert.match(scene, /emissiveMap:cityMap/);
  assert.doesNotMatch(scene, /https?:\/\//, "nothing on the wall is fetched from anywhere");
  // Deterministic: the same city on every screen in the building.
  assert.match(scene, /let citySeed=4271;/);
  assert.match(scene, /let towerSeed=8461;/);
  assert.doesNotMatch(scene.slice(scene.indexOf("cityCanvas"), scene.indexOf("scene.add(city)")), /Math\.random/);
  // Two landmarks with setbacks and a spire, so it is a skyline rather than a
  // fence of equal blocks.
  assert.match(scene, /const spire=new THREE\.Mesh\(keep\(new THREE\.ConeGeometry\(2\.6\*size,28\*size,8\)\),steel\);/);
  // And the haze has to reach far enough to show it: at the old 230 the city
  // sat past the fog and came out as flat grey.
  assert.match(scene, /raceFog\.far=Math\.max\(340,raceFog\.near\+185\);/);
});

// "Also make the car look better." — Ethan, 16 Sep 2026.
test("the car has a lacquered finish, real bodywork detail and wheels that read as turning", () => {
  const model = readFileSync(new URL("../client/src/components/tv/car-model.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  // Clearcoat over the body colour: it is what picks up the sky and the stands
  // as the car turns, and it is most of why the old one read as plastic.
  assert.match(model, /const gloss = \(color: string, roughness = \.26\) => keep\(new THREE\.MeshPhysicalMaterial\(\{ color, roughness, metalness: \.42, clearcoat: 1/);
  assert.match(model, /const paint = gloss\(appearance\.bodyColor\)/);
  assert.match(model, /const bodyPaint = pictureVisible \? gloss\(appearance\.bodyColor, \.38\) : paint;/);
  // Silhouette: an engine cover and fin behind the driver rather than a slab.
  for (const part of ["engine-cover", "shark-fin", "mirror", "front-endplate", "rear-endplate", "diffuser", "exhaust", "visor"]) {
    assert.ok(model.includes(`"${part}"`), `the car is missing its ${part}`);
  }
  // A smooth cylinder looks stationary however fast it spins. The spokes are
  // inside the wheel PIVOT, so they turn with it.
  assert.match(model, /const spoke = new THREE\.Mesh\(unitBox, black\); spoke\.name = "wheel-spoke";/);
  assert.match(model, /spoke\.rotation\.x = turn; pivot\.add\(spoke\);/);
  assert.match(model, /CylinderGeometry\(\.43, \.43, \.34, 24\)/, "rounder tires");
  // None of it may touch the parts the track and the skin garage rely on.
  assert.equal((model.match(/rounded\("body-[^\n]*bodyPaint/g) ?? []).length, 3, "the three skinned body panels are unchanged");
  assert.match(model, /if \(child !== boost && child\.name !== "focus-halo" && !wheelMounts\.includes\(child as THREE\.Group\)\) chassis\.add\(child\);/,
    "new decoration rides the sprung chassis, not the track anchor");
});

