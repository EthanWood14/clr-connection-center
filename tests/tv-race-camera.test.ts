import { test } from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera, Vector3 } from "three";
import { raceBroadcastShot, raceCameraPose, raceCameraRadius, raceCameraSubjects, raceFocusCaption } from "../shared/tv-race-camera";
import { planRaceTransition, interpolateRaceTransition } from "../shared/tv-race-transition";
import { raceTrackPoint } from "../shared/tv-race-grid";

const driver=(id:number,transfersToday:number)=>({id,name:`Driver ${id}`,transfersToday});

test("the camera follows actual midfield rivals rather than the unrelated leader",()=>{
  const before=[driver(1,20),driver(2,8),driver(3,7),driver(4,2)];
  const after=[driver(1,20),driver(2,8),driver(3,9),driver(4,2)];
  const plans=planRaceTransition(before,after,3);
  assert.deepEqual(raceCameraSubjects(plans,3).map(row=>row.id).sort(),[2,3]);
});

test("a tie is filmed alongside while a score without a pass uses nearby racers",()=>{
  const before=[driver(1,12),driver(2,8),driver(3,7),driver(4,2)];
  const tied=planRaceTransition(before,[driver(1,12),driver(2,8),driver(3,8),driver(4,2)],3);
  const focus=tied.find(row=>row.id===3)!;
  assert.deepEqual(raceCameraSubjects(tied,3).map(row=>row.id).sort(),[2,3]);
  assert.equal(raceFocusCaption(focus,tied,12),"LEVEL ON TRANSFERS");
  const gain=planRaceTransition(before,[driver(1,12),driver(2,8),driver(3,7.5),driver(4,2)],3);
  assert.ok(raceCameraSubjects(gain,3).some(row=>row.id===3));
  assert.equal(raceFocusCaption(gain.find(row=>row.id===3),gain,12),"TRANSFER ADDED");
});

test("the scorer and every passed rival stay in frame for the whole high-speed pass",()=>{
  const cases=[
    {before:[driver(1,5),driver(2,4),driver(3,1)],after:[driver(1,5),driver(2,6),driver(3,1)],focus:2},
    {before:[driver(1,12),driver(2,8),driver(3,7),driver(4,6)],after:[driver(1,12),driver(2,8),driver(3,7),driver(4,9)],focus:4},
    {before:[driver(1,5),driver(2,4.5)],after:[driver(1,5),driver(2,5)],focus:2},
    {before:[driver(1,5),driver(2,5)],after:[driver(1,6),driver(2,5)],focus:1},
  ];
  for(const scenario of cases)for(const aspect of [.7,1.2,16/9,2.4]) {
    const plans=planRaceTransition(scenario.before,scenario.after,scenario.focus);
    const subjects=raceCameraSubjects(plans,scenario.focus),radius=raceCameraRadius(subjects);
    for(let t=0;t<=12;t+=.1) {
      const lead=.06+t*.575;
      const pose=raceCameraPose(subjects,t,lead,aspect,radius);
      const camera=new PerspectiveCamera(pose.fov,aspect,.3,400);
      camera.position.set(pose.position.x,pose.position.y,pose.position.z);
      camera.lookAt(pose.target.x,pose.target.y,pose.target.z);camera.updateMatrixWorld();
      for(const row of subjects) {
        const car=interpolateRaceTransition(row,t),point=raceTrackPoint(lead-car.distance/42,car.lane);
        const projected=new Vector3(point.x,point.y+1,point.z).project(camera);
        assert.ok(Math.abs(projected.x)<.88&&Math.abs(projected.y)<.75&&projected.z>-1&&projected.z<1,`car ${row.id} clipped at ${t}/${aspect}: ${projected.toArray()}`);
      }
    }
  }
});

test("pass captions reflect actual crossing and do not invent credit from previews",()=>{
  const plans=planRaceTransition([driver(1,5),driver(2,4)],[driver(1,5),driver(2,6)],2);
  const focus=plans.find(row=>row.id===2)!;
  assert.equal(raceFocusCaption(focus,plans,0),"WATCH THE MOVE");
  assert.equal(raceFocusCaption(focus,plans,4.5),"SIDE BY SIDE");
  assert.equal(raceFocusCaption(focus,plans,12),"PASS COMPLETE");
  assert.equal(raceFocusCaption(undefined,plans,12),"LIVE RUNNING ORDER");
  assert.equal(raceFocusCaption(plans.find(row=>row.id===1),plans,12),"LIVE RUNNING ORDER");
});

test("empty preview camera remains finite",()=>{
  assert.deepEqual(raceCameraSubjects([]),[]);
  const pose=raceCameraPose([],0,0,16/9);
  assert.ok(Object.values(pose.position).every(Number.isFinite));
  assert.ok(Object.values(pose.target).every(Number.isFinite));
});

test("an on-demand preview frames the full field, including a zero-transfer guest",()=>{
  const rows=[driver(2,12),driver(3,8),driver(4,1),driver(1,0)];
  const plans=planRaceTransition(null,rows);
  assert.deepEqual(raceCameraSubjects(plans).map(row=>row.id),plans.map(row=>row.id));
  assert.ok(raceCameraSubjects(plans).some(row=>row.id===1));
});

function projectionCamera(pose:ReturnType<typeof raceCameraPose>,aspect:number) {
  const camera=new PerspectiveCamera(pose.fov,aspect,.3,400);
  camera.position.set(pose.position.x,pose.position.y,pose.position.z);
  camera.lookAt(pose.target.x,pose.target.y,pose.target.z);camera.updateMatrixWorld();
  return camera;
}

function projectedCarBounds(row:ReturnType<typeof planRaceTransition>[number],t:number,lead:number,camera:PerspectiveCamera) {
  const car=interpolateRaceTransition(row,t),angle=lead-car.distance/42,point=raceTrackPoint(angle,car.lane);
  // A conservative box around all physical car bodywork, tires and wings.
  // The +2.2m point also reserves space for the nameplate anchor.
  return [-1.6,1.6].flatMap(x=>[0,1.6].flatMap(y=>[-2.5,3.1].map(z=>new Vector3(
    point.x+x*Math.cos(angle)-z*Math.sin(angle),point.y+y,
    point.z+x*Math.sin(angle)+z*Math.cos(angle),
  ).project(camera)))).concat([new Vector3(point.x,point.y+2.2,point.z).project(camera)]);
}

test("low broadcast shots frame entire two- and three-car battles, including wings and name anchors",()=>{
  const scenarios=[
    {before:[driver(1,5),driver(2,4)],after:[driver(1,5),driver(2,6)],focus:2},
    {before:[driver(1,5),driver(2,4),driver(3,3)],after:[driver(1,5),driver(2,4),driver(3,6)],focus:3},
    {before:[driver(1,5),driver(2,4.5)],after:[driver(1,5),driver(2,5)],focus:2},
  ];
  for(const scenario of scenarios)for(const aspect of [.5,.7,1.2,16/9,2.4]) {
    const subjects=raceCameraSubjects(planRaceTransition(scenario.before,scenario.after,scenario.focus),scenario.focus);
    const radius=raceCameraRadius(subjects);
    for(let t=0;t<=12;t+=.05) {
      const lead=.06+t*.575,pose=raceCameraPose(subjects,t,lead,aspect,radius),camera=projectionCamera(pose,aspect);
      assert.ok(pose.position.y>=8.5&&pose.position.y<=11,"camera stays at spectator height, not a field-size-dependent overhead height");
      const outward=(pose.position.x-pose.target.x)*pose.target.x+(pose.position.z-pose.target.z)*pose.target.z;
      assert.ok(outward>0,"every shot remains on the same outside edge of the track");
      for(const row of subjects)for(const corner of projectedCarBounds(row,t,lead,camera)) {
        assert.ok(Math.abs(corner.x)<.94&&Math.abs(corner.y)<.79&&corner.z>-1&&corner.z<1,
          `bodywork clipped: ${row.id}/${t}/${aspect}/${pose.shot.id}: ${corner.toArray()}`);
      }
    }
  }
});

test("broadcast shot sequence holds the decisive crossing uninterrupted and reduced motion stays static",()=>{
  assert.deepEqual([0,2.1,3.5,6,9].map(t=>raceBroadcastShot(t).id),["establishing","establishing","battle","battle","exit"]);
  for(const t of [2.8,3.4,4,4.5,5,5.6,6.9,7.19])assert.equal(raceBroadcastShot(t).id,"battle");
  for(const t of [0,4.5,12])assert.deepEqual(raceBroadcastShot(t,true),{id:"trackside",label:"TRACKSIDE VIEW"});
  assert.deepEqual(raceBroadcastShot(-10),raceBroadcastShot(0));
  assert.deepEqual(raceBroadcastShot(Infinity),raceBroadcastShot(0));
});

test("trackside stations pan slower than the cars and change perspective instead of freezing the action",()=>{
  const plans=planRaceTransition(null,[driver(1,5),driver(2,4)]),radius=raceCameraRadius(plans);
  const t1=3,t2=6.9,lead1=.06+t1*.575,lead2=.06+t2*.575;
  const first=raceCameraPose(plans,t1,lead1,16/9,radius),second=raceCameraPose(plans,t2,lead2,16/9,radius);
  const relative=(pose:typeof first,lead:number)=>new Vector3(
    pose.position.x*Math.cos(lead)+pose.position.z*Math.sin(lead),pose.position.y,
    -pose.position.x*Math.sin(lead)+pose.position.z*Math.cos(lead),
  );
  assert.ok(relative(first,lead1).distanceTo(relative(second,lead2))>15,"camera moves relative to the field rather than following at exactly car speed");
  const projected=(t:number,lead:number,pose:typeof first)=>{
    const sample=interpolateRaceTransition(plans[0],t),point=raceTrackPoint(lead-sample.distance/42,sample.lane);
    return new Vector3(point.x,point.y+1,point.z).project(projectionCamera(pose,16/9));
  };
  assert.ok(projected(t1,lead1,first).distanceTo(projected(t2,lead2,second))>.04,"cars visibly approach and leave the panning lens even without score movement");
});

test("a common two-car battle is large enough to read rather than a distant aerial speck",()=>{
  const subjects=raceCameraSubjects(planRaceTransition([driver(1,5),driver(2,4)],[driver(1,5),driver(2,6)],2),2);
  const radius=raceCameraRadius(subjects);
  for(let t=3.4;t<=5.6;t+=.1) {
    const lead=.06+t*.575,camera=projectionCamera(raceCameraPose(subjects,t,lead,16/9,radius),16/9);
    for(const row of subjects) {
      const bounds=projectedCarBounds(row,t,lead,camera).slice(0,8);
      const width=Math.max(...bounds.map(p=>p.x))-Math.min(...bounds.map(p=>p.x));
      const height=Math.max(...bounds.map(p=>p.y))-Math.min(...bounds.map(p=>p.y));
      assert.ok(width>.12&&height>.055,`battle car too small at ${t}: ${width}/${height}`);
    }
  }
});

test("wide fields and portrait displays use a deterministic low panoramic fallback",()=>{
  for(const count of [12,32])for(const aspect of [.5,.7,16/9]) {
    const plans=planRaceTransition(null,Array.from({length:count},(_,i)=>driver(i+1,count-i))),radius=raceCameraRadius(plans);
    for(const t of [0,2,4.5,7,11.8]) {
      const lead=.06+t*.575,pose=raceCameraPose(plans,t,lead,aspect,radius),camera=projectionCamera(pose,aspect);
      assert.equal(pose.shot.id,"panorama");assert.equal(pose.position.y,radius>25?18:10.5);
      assert.deepEqual(pose,raceCameraPose(plans,t,lead,aspect,radius));
      for(const row of plans)for(const corner of projectedCarBounds(row,t,lead,camera)) {
        assert.ok(Math.abs(corner.x)<.94&&Math.abs(corner.y)<.79&&corner.z>-1&&corner.z<1,`wide field clipped ${count}/${aspect}/${t}: ${corner.toArray()}`);
      }
    }
  }
});

test("landscape panoramas use the screen width so a full team remains readable",()=>{
  for(const count of [12,24,32])for(const aspect of [1.51,16/9,2.4]) {
    const plans=planRaceTransition(null,Array.from({length:count},(_,i)=>driver(i+1,count-i))),radius=raceCameraRadius(plans);
    for(const t of [0,4.5,11.8]) {
      const lead=.06+t*.575,pose=raceCameraPose(plans,t,lead,aspect,radius),camera=projectionCamera(pose,aspect);
      const bounds=plans.flatMap(row=>projectedCarBounds(row,t,lead,camera));
      const width=Math.max(...bounds.map(point=>point.x))-Math.min(...bounds.map(point=>point.x));
      const minimumWidth=aspect>2.2?.72:.83;
      assert.ok(width>minimumWidth,`full field remains readable on landscape displays: ${count}/${aspect}: ${width}`);
      assert.equal(pose.position.y,radius>25?18:10.5,"wide fields use a fixed low crane shot, never radius-proportional aerial height");
      for(const corner of bounds)assert.ok(Math.abs(corner.x)<.94&&Math.abs(corner.y)<.79&&corner.z>-1&&corner.z<1);
    }
  }
});

test("common two- and three-car battle cameras clear trackside boards down to the wheels",()=>{
  const scenarios=[
    {before:[driver(1,5),driver(2,4)],after:[driver(1,5),driver(2,6)],focus:2},
    {before:[driver(1,5),driver(2,4),driver(3,3)],after:[driver(1,5),driver(2,4),driver(3,6)],focus:3},
  ];
  for(const scenario of scenarios) {
    const subjects=raceCameraSubjects(planRaceTransition(scenario.before,scenario.after,scenario.focus),scenario.focus);
    const radius=raceCameraRadius(subjects);
    for(let t=0;t<=12;t+=.05) {
      const lead=.06+t*.575,pose=raceCameraPose(subjects,t,lead,16/9,radius);
      for(const row of subjects) {
        const sample=interpolateRaceTransition(row,t),angle=lead-sample.distance/42,point=raceTrackPoint(angle,sample.lane);
        for(const x of [-1.3,1.3])for(const z of [-1.55,1.55]) {
          const wheel={x:point.x+x*Math.cos(angle)-z*Math.sin(angle),y:point.y+.02+x*.075,z:point.z+x*Math.sin(angle)+z*Math.cos(angle)};
          const dx=pose.position.x-wheel.x,dz=pose.position.z-wheel.z;
          const a=dx*dx+dz*dz,b=2*(wheel.x*dx+wheel.z*dz),c=wheel.x*wheel.x+wheel.z*wheel.z-57.5*57.5;
          const hit=(-b+Math.sqrt(b*b-4*a*c))/(2*a);
          if(hit<=0||hit>=1)continue;
          const sightHeight=wheel.y+hit*(pose.position.y-wheel.y);
          assert.ok(sightHeight>3.125,`wheel hidden by sponsor board at ${t}/${row.id}: ray height ${sightHeight}`);
        }
      }
    }
  }
});
