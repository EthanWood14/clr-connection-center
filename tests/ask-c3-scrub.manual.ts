import { executeTool } from "../server/ask-c3";
import { runWithOrg } from "../server/orgContext";
import { getRawSqlite } from "../server/storage";

const mgr = { userId: 1, orgId: 1, name: "T", role: "admin", managerish: true, timezone: "America/Los_Angeles" } as any;

async function main() {
  await runWithOrg({ orgId: 1, superAdmin: false } as any, async () => {
    const db = getRawSqlite();
    try {
      db.prepare(
        "INSERT INTO morning_checkins (org_id,user_id,date,checked_in_at,lat,lng,accuracy_m,distance_m,in_area,on_time,minutes_late,ip_address) " +
        "VALUES (1,1,'2099-01-01','2099-01-01T08:00:00',33.61,-117.87,10,5,1,1,0,'73.1.2.3')",
      ).run();
    } catch (error: any) {
      console.log("insert:", error.message);
    }
    const rows = await executeTool(mgr, "get_checkins", { date: "2099-01-01" });
    const json = JSON.stringify(rows);
    console.log("has lat:", json.includes("33.61"), "| has ip:", json.includes("73.1.2.3"), "| has on_time:", /on_time|onTime/.test(json));
    db.prepare("DELETE FROM morning_checkins WHERE date='2099-01-01'").run();
    if (json.includes("33.61") || json.includes("73.1.2.3")) throw new Error("SCRUB FAILED");
    console.log("SCRUB OK");
  });
}

main().catch((error) => { console.error("ERR", error?.message ?? error); process.exit(1); });
