import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {migrateTransferPrioritySnapshots} from "../server/transfer-priority-snapshot";
import {scoreTransferPriority, type RecipientRow} from "../server/transfer-priority";

function fixture(){const db=new Database(':memory:');db.exec(`
CREATE TABLE loan_officers(id INTEGER,org_id INTEGER,full_name TEXT,needs_transfers INTEGER);
CREATE TABLE lead_outcomes(id INTEGER PRIMARY KEY,org_id INTEGER,lo_id INTEGER,outcome_type TEXT,created_at TEXT,notes TEXT);
CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,org_id INTEGER,entity_type TEXT,entity_id INTEGER,entity_label TEXT,details TEXT,created_at TEXT);
INSERT INTO loan_officers VALUES(1,1,'Busy LO',0),(2,1,'Pinned LO',1),(1,2,'Other org',1);
INSERT INTO audit_logs VALUES(1,1,'loan_officer',1,'Busy LO','{"needsTransfers":true}','2026-09-01T10:00:00Z');
INSERT INTO audit_logs VALUES(2,1,'loan_officer',0,'Pinned loan officers changed by link: Busy LO: unpinned, Pinned LO: pinned',NULL,'2026-09-10T10:00:00Z');
INSERT INTO lead_outcomes VALUES(1,1,1,'transfer','2026-09-05T12:00:00Z',NULL),(2,1,1,'transfer','2026-09-15T12:00:00Z',NULL),(3,1,2,'transfer','2026-09-05T12:00:00Z',NULL),(4,2,1,'transfer','2026-09-05T12:00:00Z',NULL);`);return db;}

test('migration reconstructs audited pins, keeps orgs separate and is idempotent',()=>{
 const db=fixture();try{migrateTransferPrioritySnapshots(db);
 assert.deepEqual(db.prepare('SELECT id,priority_at_transfer AS p,priority_snapshot_source AS s FROM lead_outcomes ORDER BY id').all(),[
 {id:1,p:1,s:'audit_history'},{id:2,p:0,s:'audit_history'},{id:3,p:0,s:'audit_history'},{id:4,p:1,s:'legacy_baseline'}]);
 db.exec('UPDATE loan_officers SET needs_transfers=1');migrateTransferPrioritySnapshots(db);
 assert.equal(db.prepare('SELECT priority_at_transfer AS p FROM lead_outcomes WHERE id=2').get().p,0);
 }finally{db.close()}
});

test('every insertion path stamps server priority; edits preserve it unless destination changes',()=>{
 const db=fixture();try{migrateTransferPrioritySnapshots(db);
 db.exec("INSERT INTO lead_outcomes(id,org_id,lo_id,outcome_type,created_at,priority_at_transfer) VALUES(5,1,2,'transfer','2026-09-20',0)");
 assert.equal(db.prepare('SELECT priority_at_transfer AS p FROM lead_outcomes WHERE id=5').get().p,1);
 db.exec("UPDATE loan_officers SET needs_transfers=0 WHERE org_id=1 AND id=2; UPDATE lead_outcomes SET notes='edited' WHERE id=5");
 assert.equal(db.prepare('SELECT priority_at_transfer AS p FROM lead_outcomes WHERE id=5').get().p,1);
 db.exec('UPDATE lead_outcomes SET lo_id=1 WHERE id=5');
 assert.equal(db.prepare('SELECT priority_at_transfer AS p FROM lead_outcomes WHERE id=5').get().p,0);
 db.exec('UPDATE lead_outcomes SET org_id=2 WHERE id=5');
 assert.equal(db.prepare('SELECT priority_at_transfer AS p FROM lead_outcomes WHERE id=5').get().p,1);
 }finally{db.close()}
});

test('explicit priority earns 100 despite workload, missing LOA or later unpinning; false never inherits a new pin',()=>{
 const recipients:RecipientRow[]=[1,2,3,4,5,6].map(id=>({id,kind:'lo',name:'LO '+id,receiving:true,transfers:id*100,needsTransfers:id===6}));
 const rows=Array.from({length:5},()=>({clrId:1,loId:6,at:'2026-09-23',priorityAtTransfer:true}));
 assert.equal(scoreTransferPriority(rows,recipients)[0].pct,100);
 assert.equal(scoreTransferPriority(rows,recipients.map(r=>({...r,needsTransfers:false})))[0].pct,100);
 const unprioritized=rows.map(r=>({...r,priorityAtTransfer:false}));
 assert.equal(scoreTransferPriority(unprioritized,recipients)[0].pct,0);
 assert.equal(scoreTransferPriority(unprioritized,recipients.map(r=>({...r,needsTransfers:false})))[0].pct,0);
});
