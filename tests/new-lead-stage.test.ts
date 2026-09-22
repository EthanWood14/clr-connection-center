import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import ts from "typescript";
import { hasPipelineStage } from "../shared/new-lead-stage";
import { losFromPayload, newestLeadsForLos, resetNewestLeadsCache, stageQualifiedFloorLeads, NEWEST_LEADS_STALE_MAX_MS } from "../server/leadvault-newest-leads";
import { recordNewLead, resetNewLeads, newLeadsSince } from "../server/tv-leads";
import * as freshness from "../shared/lo-new-leads";
import * as retail from "../shared/retail-bonzo-shotgun";

test("a pipeline or owner alone never qualifies; actual stage names and positive IDs do", () => {
  for (const lead of [null, [], {}, {pipeline:'Meta'}, {assignedUserId:5}, ...[null,undefined,'','  ','-','--','None','NULL','UNASSIGNED','no_stage','unknown',0,false,{},[]].map(stage=>({stage}))]) {
    assert.equal(hasPipelineStage(lead),false,JSON.stringify(lead));
  }
  for (const lead of [{stage:'New leads'},{stage:'  Follow-up  '},{stage:{name:'Contacted'}},{stage:{id:42}},{stage_id:'12'},{pipeline_stage_id:19}]) assert.equal(hasPipelineStage(lead),true);
  for (const stageId of [0,-1,true,'0','unknown',NaN,1.5]) assert.equal(hasPipelineStage({stageId}),false);
});

test("the feed retains LO rows but strips unstaged and malformed leads before consumers see them",()=>{
  const result=losFromPayload({los:[{email:'LO@EXAMPLE.COM',leads:[null,{externalId:'blank',pipeline:'Meta',stage:' '},{externalId:'ok',stage:'New leads'},{externalId:'no-stage'}]}]});
  assert.equal(result[0].email,'lo@example.com');
  assert.deepEqual(result[0].leads.map(l=>l.externalId),['ok']);
});

test("fresh callbacks and cached cards filter stages, and a lead becomes eligible when a stage arrives",async()=>{
  resetNewestLeadsCache(); const original=globalThis.fetch;
  let clock=Date.now(); let stage:any=null;
  const notices:string[][]=[];
  globalThis.fetch=async()=>({ok:true,json:async()=>({los:[{email:'lo@example.com',leads:[{externalId:'waiting',stage}]}]})}) as any;
  const deps={token:()=> 'test',baseUrl:()=> 'https://example.invalid',now:()=>clock,onFresh:(los:any[])=>notices.push(los.flatMap(row=>row.leads.map((l:any)=>l.externalId)))};
  try {
    const first=await newestLeadsForLos(['lo@example.com'],{hours:72,per:5},deps);
    assert.deepEqual(first.los[0].leads,[]); assert.deepEqual(notices,[[]]);
    assert.deepEqual((await newestLeadsForLos(['lo@example.com'],{hours:72,per:5},deps)).los[0].leads,[]);
    stage='New leads';clock+=NEWEST_LEADS_STALE_MAX_MS+1;
    assert.deepEqual((await newestLeadsForLos(['lo@example.com'],{hours:72,per:5},deps)).los[0].leads.map(l=>l.externalId),['waiting']);
    stage=null;clock+=NEWEST_LEADS_STALE_MAX_MS+1;
    assert.deepEqual((await newestLeadsForLos(['lo@example.com'],{hours:72,per:5},deps)).los[0].leads,[]);
    assert.deepEqual(notices,[[],['waiting'],[]]);
  } finally {globalThis.fetch=original;resetNewestLeadsCache()}
});

test("floor cards require fresh stage evidence for the owning LO, including other LOs",()=>{
  const rows = [{lo_email:'other@example.com',external_id:'good'}, {lo_email:'other@example.com',external_id:'blank'}, {lo_email:'wrong@example.com',external_id:'good'}];
  const los = losFromPayload({los:[{email:'other@example.com',leads:[{externalId:'good',stage:'New leads'},{externalId:'blank',stage:null}]}]});
  assert.deepEqual(stageQualifiedFloorLeads(rows,{stale:false,los}),[rows[0]]);
  assert.deepEqual(stageQualifiedFloorLeads(rows,{stale:true,los}),[]);
  assert.deepEqual(stageQualifiedFloorLeads(rows,{stale:false,los:[]}),[]);
});

test("TV notices reject unstaged arrivals without adding them to the buffer",()=>{
  resetNewLeads();const now=Date.now();
  assert.equal(recordNewLead({name:'Unstaged'},now),null);
  assert.equal(recordNewLead({name:'Blank',stage:' '},now),null);
  assert.ok(recordNewLead({name:'Eligible',stage:'New leads'},now));
  assert.deepEqual(newLeadsSince(new Date(now-1000).toISOString(),now).map(l=>l.name),['Eligible']);
  resetNewLeads();
});

function loadModule(path:string, requireMock:(id:string)=>any) {
  const source=readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports:any={};new Function('require','exports',js)(requireMock,exports);return exports;
}

test("retry only takes stage-verified leads in the current organization; unknown rows remain untouched",()=>{
  const db=new Database(':memory:');
  db.exec(`CREATE TABLE lo_new_leads(id INTEGER PRIMARY KEY,org_id INTEGER,external_id TEXT,status TEXT,first_seen_at TEXT,escalated_at TEXT,escalate_error TEXT,shotgun_lead_id INTEGER);
    INSERT INTO lo_new_leads VALUES(1,1,'unstaged','new','2026-09-22',NULL,NULL,NULL),(2,1,'staged','new','2026-09-22',NULL,NULL,NULL),(3,2,'staged','new','2026-09-22',NULL,NULL,NULL);`);
  try {
    const module=loadModule('server/lo-new-lead-escalation.ts',()=>({getRawSqlite:()=>db}));
    assert.deepEqual(module.loNewLeadsDueForShotgun(1,'2026-09-23'),[]);
    const taken=module.loNewLeadsDueForShotgun(1,'2026-09-23',new Set(['staged']));
    assert.deepEqual(taken.map((l:any)=>l.id),[2]);
    assert.deepEqual(db.prepare('SELECT id,status FROM lo_new_leads ORDER BY id').all(),[{id:1,status:'new'},{id:2,status:'escalated'},{id:3,status:'new'}]);
  } finally {db.close()}
});

test("the Retail publisher cannot bypass stage filtering when called directly",()=>{
  const recorded:string[]=[];
  const storageMock={storage:{getUsers:()=>[{id:1,role:'admin',isActive:true}]},
    recordLoNewLead:(input:any)=>{recorded.push(input.externalId);return{inserted:false,row:null}}};
  const module=loadModule('server/retail-bonzo-shotgun-watcher.ts',id=>{
    if(id==='./storage')return storageMock;
    if(id==='@shared/lo-new-leads')return freshness;
    if(id==='@shared/retail-bonzo-shotgun')return retail;
    if(id==='@shared/new-lead-stage')return {hasPipelineStage};
    return {};
  });
  module.publishRetailDeskShotgunLeads(1,[{email:retail.RETAIL_DESK_BONZO_EMAIL,name:'Retail',leads:[
    {externalId:'no-stage',landedAt:new Date().toISOString()},
    {externalId:'stage',stage:'New leads',landedAt:new Date().toISOString()},
  ]}]);
  assert.deepEqual(recorded,['stage']);
});
