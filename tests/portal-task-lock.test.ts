import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import express from "express";
import { migratePortalTaskLocks, portalTaskLockGuard, registerPortalTaskLockRoutes } from "../server/portal-task-lock";
import { migrateOtherWork, registerOtherWorkRoutes, otherWorkDays } from "../server/other-work";
import { loadScorecardSchedules } from "../server/scorecard-schedule";
import { paceHalfDayContext, approvedFullDayTimeOffUserIds } from "../server/half-day";
import { availableWeekdayPortions } from "../shared/half-day";

async function fixture(t: TestContext) {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,org_id INTEGER,name TEXT,role TEXT,is_manager INTEGER,super_admin INTEGER,is_active INTEGER,archived_at TEXT,portal TEXT);
    INSERT INTO users VALUES(1,1,'Manager','admin',1,0,1,NULL,NULL),(2,1,'Employee','assistant',0,0,1,NULL,'c3'),
      (3,2,'Other org','assistant',0,0,1,NULL,NULL),(4,1,'External','assistant',0,0,1,NULL,'lap'),
      (5,1,'Inactive','assistant',0,0,0,NULL,NULL);
    CREATE TABLE clr_tasks(id INTEGER PRIMARY KEY,org_id INTEGER,assigned_user_id INTEGER,title TEXT,description TEXT,due_at TEXT,status TEXT,comp_amount_cents INTEGER);
    INSERT INTO clr_tasks VALUES(10,1,2,'Review SOP','Finish the review','2026-09-22','active',NULL),(11,1,2,'Second task','','2026-09-22','active',NULL),
      (12,2,3,'Other org task','','2026-09-22','active',NULL),(13,1,1,'Manager task','','2026-09-22','active',NULL),
      (14,1,4,'External task','','2026-09-22','active',NULL),(15,1,5,'Inactive task','','2026-09-22','active',NULL);
    CREATE TABLE time_off_requests(id INTEGER PRIMARY KEY,org_id INTEGER,user_id INTEGER,start_date TEXT,end_date TEXT,status TEXT,day_portion TEXT,leave_kind TEXT);
    CREATE TABLE attendance_excuse_requests(org_id INTEGER,subject_id INTEGER,subject_type TEXT,kind TEXT,status TEXT,hide_from_digest INTEGER,attendance_date TEXT);`);
  migratePortalTaskLocks(db); migratePortalTaskLocks(db); migrateOtherWork(db);
  const app = express(); app.use(express.json());
  app.use((req: any, _res, next) => { const u: any = db.prepare('SELECT * FROM users WHERE id=?').get(Number(req.headers['x-user'] ?? 2)); if(u)req.session_user={userId:u.id,orgId:u.org_id,portal:u.portal}; next(); });
  app.use('/api',portalTaskLockGuard(()=>db));
  const auth: any=(req:any,res:any,next:any)=>req.session_user?next():res.status(401).json({error:'Unauthorized'});
  const audits: any[]=[];
  const deps={db:()=>db,requireAuth:auth,audit:(...args:any[])=>audits.push(args.slice(1))};
  registerPortalTaskLockRoutes(app,deps); registerOtherWorkRoutes(app,deps);
  app.get('/api/work',auth,(_req,res)=>res.json({ok:true}));
  app.post('/api/work',auth,(_req,res)=>res.json({ok:true}));
  app.post('/api/clr-tasks/:id/complete',auth,(req:any,res)=>{
    if(String(req.body?.note??'').length<10)return res.status(400).json({error:'Note required'});
    db.prepare("UPDATE clr_tasks SET status='completed' WHERE id=? AND assigned_user_id=? AND org_id=?").run(Number(req.params.id),req.session_user.userId,req.session_user.orgId);
    res.json({ok:true});
  });
  const server=app.listen(0,'127.0.0.1'); await new Promise<void>(resolve=>server.once('listening',resolve));
  t.after(()=>{server.close();db.close()});
  const address=server.address() as any;
  const request=async(path:string,method='GET',body?:any,user=2)=>{
    const response=await fetch(`http://127.0.0.1:${address.port}${path}`,{method,headers:{'Content-Type':'application/json','x-user':String(user)},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  return {db,request,audits};
}

test('manager pauses the portal; only its assigned completion unlocks it, including a fresh request/tab',async t=>{
  const {request,audits}=await fixture(t);
  assert.equal((await request('/api/portal-task-locks','POST',{taskId:10},1)).status,201);
  for(const method of ['GET','POST']) assert.equal((await request('/api/work',method)).status,423);
  assert.equal((await request('/api/portal-task-locks/me')).body.lock.taskId,10);
  assert.equal((await request('/api/clr-tasks/11/complete','POST',{note:'Other task done'})).status,423);
  assert.equal((await request('/api/clr-tasks/10/complete','POST',{note:'short'})).status,400);
  assert.equal((await request('/api/work')).status,423);
  assert.equal((await request('/api/clr-tasks/10/complete','POST',{note:'Reviewed the full SOP'})).status,200);
  assert.equal((await request('/api/portal-task-locks/me')).body.lock,null);
  assert.equal((await request('/api/work')).status,200);
  assert.equal(audits[0][0],'portal_task_lock');
});

test('lock creation rejects employee, foreign organization, external, inactive and privileged targets',async t=>{
  const {request}=await fixture(t);
  assert.equal((await request('/api/portal-task-locks','POST',{taskId:10})).status,403);
  assert.equal((await request('/api/portal-task-locks','POST',{taskId:12},1)).status,404);
  for(const taskId of [13,14,15]) assert.equal((await request('/api/portal-task-locks','POST',{taskId},1)).status,400);
  assert.equal((await request('/api/portal-task-locks','POST',{taskId:'10'},1)).status,400);
  assert.equal((await request('/api/portal-task-locks/me','GET',undefined,999)).status,401);
});

test('manager release does not complete the task; duplicate locks and cross-org release are refused',async t=>{
  const {db,request}=await fixture(t);
  const locked=await request('/api/portal-task-locks','POST',{taskId:10},1);
  assert.equal((await request('/api/portal-task-locks','POST',{taskId:11},1)).status,409);
  db.prepare("UPDATE users SET is_manager=1 WHERE id=3").run();
  assert.equal((await request(`/api/portal-task-locks/${locked.body.lock.id}`,'DELETE',undefined,3)).status,404);
  assert.equal((await request(`/api/portal-task-locks/${locked.body.lock.id}`,'DELETE',undefined,1)).status,200);
  assert.equal((await request('/api/work')).status,200);
  assert.equal((db.prepare('SELECT status FROM clr_tasks WHERE id=10').get() as any).status,'active');
});

test('archiving or reassigning a task cannot strand its old employee and a new lock can be set',async t=>{
  const {db,request}=await fixture(t);
  await request('/api/portal-task-locks','POST',{taskId:10},1);
  db.prepare("UPDATE clr_tasks SET status='archived' WHERE id=10").run();
  assert.equal((await request('/api/work')).status,200);
  assert.equal((await request('/api/portal-task-locks','POST',{taskId:11},1)).status,201);
  db.prepare('UPDATE clr_tasks SET assigned_user_id=1 WHERE id=11').run();
  assert.equal((await request('/api/work')).status,200);
});

test('other work excludes goal days, preserves credit and attendance, and approved PTO takes precedence',async t=>{
  const {db,request}=await fixture(t);
  const saved=await request('/api/clr-other-work','POST',{userId:2,startDate:'2026-09-22',endDate:'2026-09-22',reason:'Project work'},1);
  assert.equal(saved.status,200);
  assert.equal(loadScorecardSchedules(db,1,'2026-09-22').get(2)?.kind,'other_work');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM time_off_requests').get() as any).n,0);
  assert.equal(approvedFullDayTimeOffUserIds(db,'2026-09-22',1).has(2),false);
  const context=paceHalfDayContext(db,1,'2026-09-21','2026-09-23');
  assert.equal(availableWeekdayPortions(2,'2026-09-21','2026-09-23',context.availability),2);
  assert.equal(context.excludedDays.some(d=>d.userId===2),false,'actual transfer credit remains');
  assert.deepEqual(otherWorkDays(db,2,'2026-09-21','2026-09-23'),[]);
  db.exec("INSERT INTO time_off_requests VALUES(1,1,2,'2026-09-22','2026-09-22','approved','full','pto')");
  assert.equal(loadScorecardSchedules(db,1,'2026-09-22').get(2)?.label,'Day off');
  await request(`/api/clr-other-work/${saved.body.id}`,'DELETE',undefined,1);
  assert.deepEqual(otherWorkDays(db,1,'2026-09-21','2026-09-23'),[]);
});

test('other work dates and organization/role boundaries are enforced',async t=>{
  const {request}=await fixture(t);
  const body={userId:2,startDate:'2026-09-22',endDate:'2026-09-22'};
  assert.equal((await request('/api/clr-other-work','POST',body)).status,403);
  assert.equal((await request('/api/clr-other-work','POST',{...body,userId:3},1)).status,404);
  for(const startDate of ['2026-02-30','bad','2027-09-22']) assert.equal((await request('/api/clr-other-work','POST',{...body,startDate},1)).status,400);
});
