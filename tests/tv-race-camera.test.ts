import { test } from "node:test";
import assert from "node:assert/strict";
import { PerspectiveCamera, Vector3 } from "three";
import { raceCameraPose, raceCameraRadius, raceCameraSubjects, raceFocusCaption, RACE_CAMERA_FOV } from "../shared/tv-race-camera";
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
      const camera=new PerspectiveCamera(RACE_CAMERA_FOV,aspect,.3,400);
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
