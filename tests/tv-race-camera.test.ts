import { test } from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera, Vector3 } from "three";
import { raceBroadcastShot, raceCameraPose, raceCameraRadius, raceCameraStartAngle, raceCameraSubjects, raceFocusCaption } from "../shared/tv-race-camera";
import { planRaceTransition, interpolateRaceTransition } from "../shared/tv-race-transition";
import { raceTrackPoint } from "../shared/tv-race-grid";

const driver=(id:number,transfersToday:number)=>({id,name:`Driver ${id}`,transfersToday});
const leadAt=(plans:ReturnType<typeof planRaceTransition>,time:number)=>raceCameraStartAngle(plans)+time*.575;
const radial=(point:{x:number;z:number})=>Math.hypot(point.x,point.z);
const distance=(a:{x:number;y:number;z:number},b:typeof a)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);

function projectionCamera(pose:ReturnType<typeof raceCameraPose>,aspect:number) {
  const camera=new PerspectiveCamera(pose.fov,aspect,.3,400);
  camera.position.set(pose.position.x,pose.position.y,pose.position.z);
  camera.lookAt(pose.target.x,pose.target.y,pose.target.z);
  camera.rotateZ(pose.roll);camera.updateMatrixWorld();
  return camera;
}

function projectedCarBounds(row:ReturnType<typeof planRaceTransition>[number],t:number,lead:number,camera:PerspectiveCamera) {
  const car=interpolateRaceTransition(row,t),angle=lead-car.distance/42,point=raceTrackPoint(angle,car.lane);
  return [-1.6,1.6].flatMap(x=>[0,1.6].flatMap(y=>[-2.5,3.1].map(z=>new Vector3(
    point.x+x*Math.cos(angle)-z*Math.sin(angle),point.y+y,
    point.z+x*Math.sin(angle)+z*Math.cos(angle),
  ).project(camera)))).concat([new Vector3(point.x,point.y+2.2,point.z).project(camera)]);
}

test("the camera follows actual midfield rivals rather than the unrelated leader",()=>{
  const before=[driver(1,20),driver(2,8),driver(3,7),driver(4,2)];
  const after=[driver(1,20),driver(2,8),driver(3,9),driver(4,2)];
  assert.deepEqual(raceCameraSubjects(planRaceTransition(before,after,3),3).map(row=>row.id).sort(),[2,3]);
});

test("a high-ID scorer cannot be displaced from the close pack by equal-score tie peers",()=>{
  const peers=Array.from({length:5},(_,i)=>driver(i+1,1));
  const plans=planRaceTransition([...peers,driver(900,.5)],[...peers,driver(900,1)],900);
  const subjects=raceCameraSubjects(plans,900),radius=raceCameraRadius(subjects),scorer=subjects.find(row=>row.id===900)!;
  const leadStart=raceCameraStartAngle(subjects);
  const opening=raceCameraPose(subjects,0,leadStart,.5,radius);
  const expectedPack=[900,1,2].map(id=>{
    const row=subjects.find(item=>item.id===id)!,sample=interpolateRaceTransition(row,0);
    return raceTrackPoint(leadStart-sample.distance/42,sample.lane);
  });
  assert.ok(Math.abs(opening.target.x-expectedPack.reduce((sum,p)=>sum+p.x,0)/3)<1e-9);
  assert.ok(Math.abs(opening.target.z-expectedPack.reduce((sum,p)=>sum+p.z,0)/3)<1e-9);
  for(const aspect of [.5,.7,1.51,16/9])for(const t of [1.6,1.65,1.7]) {
    const lead=leadStart+t*.575,pose=raceCameraPose(subjects,t,lead,aspect,radius),camera=projectionCamera(pose,aspect);
    const sample=interpolateRaceTransition(scorer,t),point=raceTrackPoint(lead-sample.distance/42,sample.lane);
    const projected=new Vector3(point.x,point.y+1,point.z).project(camera);
    assert.ok(Math.abs(projected.x)<.95&&Math.abs(projected.y)<.9&&projected.z>-1&&projected.z<1,
      `tie scorer left their own close shot: ${aspect}/${t}: ${projected.toArray()}`);
  }
});

test("ties and score-only changes preserve their actual race captions",()=>{
  const before=[driver(1,12),driver(2,8),driver(3,7),driver(4,2)];
  const tied=planRaceTransition(before,[driver(1,12),driver(2,8),driver(3,8),driver(4,2)],3);
  assert.deepEqual(raceCameraSubjects(tied,3).map(row=>row.id).sort(),[2,3]);
  assert.equal(raceFocusCaption(tied.find(row=>row.id===3),tied,12),"LEVEL ON TRANSFERS");
  const gain=planRaceTransition(before,[driver(1,12),driver(2,8),driver(3,7.5),driver(4,2)],3);
  assert.equal(raceFocusCaption(gain.find(row=>row.id===3),gain,12),"TRANSFER ADDED");
});

test("the continuous flight starts in the grandstand, goes over the track, then lands in the grass",()=>{
  const plans=planRaceTransition(null,[driver(1,5),driver(2,4)]),radius=raceCameraRadius(plans);
  const pose=(t:number)=>raceCameraPose(plans,t,leadAt(plans,t),16/9,radius);
  const opening=pose(0),launch=pose(3.4),apex=pose(5.6),grass=pose(12);
  assert.ok(radial(opening.position)>=65&&radial(opening.position)<=72);
  assert.ok(opening.position.y>=8&&opening.position.y<=11);
  assert.ok(radial(launch.position)<53&&radial(launch.position)>42,"camera physically crosses over the outside racing surface");
  assert.ok(launch.position.y>=32);
  assert.ok(apex.position.y>=36&&apex.position.y<=46,"a genuine elevated drone shot");
  assert.ok(radial(apex.position)<43&&radial(apex.position)>32);
  assert.ok(radial(grass.position)>=15&&radial(grass.position)<=22,"camera ends inside the track, not outside it");
  assert.ok(grass.position.y>=1.3&&grass.position.y<=2.2);
  assert.ok(radial(grass.target)>radial(grass.position)+12,"grass camera looks outward toward actual racers");
  assert.ok(distance(opening.position,grass.position)>40);
});

test("the opening angle starts inside the real grandstand even for midfield focus and wide previews",()=>{
  for(const count of [2,24]) {
    const rows=Array.from({length:count},(_,i)=>driver(i+1,count-i));
    const plans=planRaceTransition(null,rows);
    for(const subjects of [plans,raceCameraSubjects(plans,Math.max(1,count-2))]) {
      const pose=raceCameraPose(subjects,0,raceCameraStartAngle(subjects),16/9);
      const angle=Math.atan2(pose.position.z,pose.position.x);
      assert.ok(angle>=-2.15&&angle<=-.25,`opening missed the grandstand: ${angle}`);
      assert.ok(radial(pose.position)>=63&&radial(pose.position)<=82);
    }
  }
});

test("phase labels describe the actual grandstand-to-drone-to-grass journey",()=>{
  assert.deepEqual([0,2,5,8,11].map(t=>raceBroadcastShot(t).label),[
    "GRANDSTAND POV","OVER THE CARS","DRONE SWEEP","INTO THE INFIELD","GRASS-SIDE",
  ]);
  assert.deepEqual(raceBroadcastShot(-2),raceBroadcastShot(0));
  assert.deepEqual(raceBroadcastShot(Infinity),raceBroadcastShot(0));
});

// "It should be one continuous shot too, with like 30 different angles it
// moves from." — Ethan, 16 Sep 2026. The flight was eight waypoints, so most
// of it was one long glide; it is thirty-plus now, and still not a cut.
test("the flight is built from thirty-odd angles and keeps swinging round the subject",()=>{
  const plans=planRaceTransition(null,Array.from({length:6},(_,i)=>driver(i+1,6-i))),radius=raceCameraRadius(plans);
  const pose=(t:number)=>raceCameraPose(plans,t,leadAt(plans,t),16/9,radius);
  // Sample every third of a second and count the distinct directions the
  // camera is travelling in: a straight glide would register a handful.
  const headings=new Set<string>();
  for(let t=0;t<12;t+=1/3) {
    const a=pose(t),b=pose(Math.min(12,t+1/3));
    const dx=b.position.x-a.position.x,dy=b.position.y-a.position.y,dz=b.position.z-a.position.z;
    const length=Math.hypot(dx,dy,dz)||1;
    headings.add([dx/length,dy/length,dz/length].map(v=>v.toFixed(1)).join(","));
  }
  assert.ok(headings.size>=20,`one long glide, not a flight: ${headings.size} headings`);
});

test("camera position, target, FOV and banking stay continuous across every flight waypoint",()=>{
  for(const count of [3,24])for(const aspect of [.7,1.51,16/9]) {
    const plans=planRaceTransition(null,Array.from({length:count},(_,i)=>driver(i+1,count-i))),radius=raceCameraRadius(plans);
    const pose=(t:number)=>raceCameraPose(plans,t,leadAt(plans,t),aspect,radius);
    for(const boundary of [1.6,3.4,4.2,5.6,6.8,9.5]) {
      const a=pose(boundary-1e-6),b=pose(boundary+1e-6);
      assert.ok(distance(a.position,b.position)<.001,"no position cuts at shot annotations or keyframes");
      assert.ok(distance(a.target,b.target)<.001,"no look-target jumps");
      assert.ok(Math.abs(a.fov-b.fov)<.001);
      assert.ok(Math.abs(a.roll-b.roll)<.001);
    }
    for(let t=.02;t<=12;t+=.02) {
      const a=pose(t-.02),b=pose(t);
      assert.ok(distance(a.position,b.position)<3,"no hidden teleport between waypoints");
      assert.ok(distance(a.target,b.target)<2);
      assert.ok(Math.abs(a.fov-b.fov)<.5);
      assert.ok(Math.abs(b.roll)<.06,"gentle banking, never a wild roll");
    }
  }
});

test("actual Three camera orientation never flips as the flight passes overhead",()=>{
  const scenarios=[
    planRaceTransition([driver(1,5),driver(2,4)],[driver(1,5),driver(2,6)],2),
    planRaceTransition([driver(1,5),driver(2,4),driver(3,3)],[driver(1,5),driver(2,4),driver(3,6)],3),
    planRaceTransition(null,Array.from({length:24},(_,i)=>driver(i+1,24-i))),
  ];
  for(const plans of scenarios)for(const aspect of [.5,.7,1.51,16/9,2.4]) {
    const radius=raceCameraRadius(plans);
    let previous=projectionCamera(raceCameraPose(plans,0,leadAt(plans,0),aspect,radius),aspect).quaternion.clone();
    for(let step=1;step<=600;step++) {
      const t=step*.02;
      const current=projectionCamera(raceCameraPose(plans,t,leadAt(plans,t),aspect,radius),aspect).quaternion;
      const rotation=previous.angleTo(current);
      assert.ok(rotation<.15,`viewing orientation flipped: ${plans.length} cars, aspect ${aspect}, t=${t}, step=${rotation}rad`);
      previous=current.clone();
    }
  }
});

test("the scorer and real rivals remain fully visible during the decisive drone pass",()=>{
  const scenarios=[
    {before:[driver(1,5),driver(2,4),driver(3,1)],after:[driver(1,5),driver(2,6),driver(3,1)],focus:2},
    {before:[driver(1,12),driver(2,8),driver(3,7),driver(4,6)],after:[driver(1,12),driver(2,8),driver(3,7),driver(4,9)],focus:4},
    {before:[driver(1,5),driver(2,4.5)],after:[driver(1,5),driver(2,5)],focus:2},
    {before:[driver(1,5),driver(2,5)],after:[driver(1,6),driver(2,5)],focus:1},
  ];
  for(const scenario of scenarios)for(const aspect of [.5,.7,1.2,16/9,2.4]) {
    const subjects=raceCameraSubjects(planRaceTransition(scenario.before,scenario.after,scenario.focus),scenario.focus),radius=raceCameraRadius(subjects);
    for(let t=3.4;t<=5.6;t+=.04) {
      const lead=leadAt(subjects,t),pose=raceCameraPose(subjects,t,lead,aspect,radius),camera=projectionCamera(pose,aspect);
      for(const row of subjects)for(const corner of projectedCarBounds(row,t,lead,camera)) {
        assert.ok(Math.abs(corner.x)<.91&&Math.abs(corner.y)<.87&&corner.z>-1&&corner.z<1,
          `pass bodywork clipped: ${row.id}/${t}/${aspect}: ${corner.toArray()}`);
      }
    }
  }
});

test("wide previews use a local pack close up and reveal the complete field only at the drone apex",()=>{
  for(const count of [12,24,32])for(const aspect of [.7,1.51,16/9]) {
    const plans=planRaceTransition(null,Array.from({length:count},(_,i)=>driver(i+1,count-i))),radius=raceCameraRadius(plans);
    assert.equal(raceCameraSubjects(plans).length,count,"the wide camera retains the full real field as input");
    for(const t of [4.2,5.6,6.5]) {
      const lead=leadAt(plans,t),pose=raceCameraPose(plans,t,lead,aspect,radius),camera=projectionCamera(pose,aspect);
      for(const row of plans)for(const corner of projectedCarBounds(row,t,lead,camera)) {
        assert.ok(Math.abs(corner.x)<.94&&Math.abs(corner.y)<.9&&corner.z>-1&&corner.z<1,
          `drone missed full field: ${count}/${aspect}/${t}: ${corner.toArray()}`);
      }
    }
    const opening=raceCameraPose(plans,0,leadAt(plans,0),aspect,radius);
    const ending=raceCameraPose(plans,12,leadAt(plans,12),aspect,radius);
    assert.ok(radial(opening.target)>35,"close view aims at the local pack, not the full-field centroid");
    assert.ok(radial(ending.position)<22&&ending.position.y<2.3,"wide roster does not suppress the infield swoop");
  }
});

test("reduced motion gets one unbanked final-order spectator pose, never a flight",()=>{
  const plans=planRaceTransition([driver(1,5),driver(2,4)],[driver(1,5),driver(2,6)],2),radius=raceCameraRadius(plans);
  const fixed=raceCameraPose(plans,0,0,16/9,radius,true);
  for(const t of [0,1.6,3.4,5.6,9.5,12]) {
    assert.deepEqual(raceCameraPose(plans,t,t*100,16/9,radius,true),fixed);
  }
  assert.equal(fixed.roll,0);
  assert.deepEqual(fixed.shot,{id:"trackside",label:"TRACKSIDE VIEW"});
  assert.ok(radial(fixed.position)>63&&fixed.position.y===10.5);
});

test("empty and malformed preview timing remains finite and deterministic",()=>{
  assert.deepEqual(raceCameraSubjects([]),[]);
  for(const time of [0,4.5,12,NaN,Infinity,-100])for(const aspect of [.25,16/9,NaN,0]) {
    const pose=raceCameraPose([],time,NaN,aspect,NaN);
    assert.ok([...Object.values(pose.position),...Object.values(pose.target),pose.fov,pose.roll].every(Number.isFinite));
    assert.deepEqual(pose,raceCameraPose([],time,NaN,aspect,NaN));
  }
});

test("pass captions still reflect earned crossing rather than camera movement",()=>{
  const plans=planRaceTransition([driver(1,5),driver(2,4)],[driver(1,5),driver(2,6)],2),focus=plans.find(row=>row.id===2)!;
  assert.equal(raceFocusCaption(focus,plans,0),"WATCH THE MOVE");
  assert.equal(raceFocusCaption(focus,plans,4.5),"SIDE BY SIDE");
  assert.equal(raceFocusCaption(focus,plans,12),"PASS COMPLETE");
  assert.equal(raceFocusCaption(undefined,plans,12),"LIVE RUNNING ORDER");
  assert.equal(raceFocusCaption(plans.find(row=>row.id===1),plans,12),"LIVE RUNNING ORDER");
});
