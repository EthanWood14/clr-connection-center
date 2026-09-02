/**
 * Manual live-fire test for Ask C3 (not part of npm test — spends API tokens).
 * Run: npx tsx tests/ask-c3-live.manual.ts
 * Exercises the full agent loop against the local sample clr.db and the real
 * Anthropic API: forced grounding on hop 0, tool execution, and — the LV
 * 400-killer — thinking-block replay with signatures across multi-hop turns.
 */
import { runWithOrg } from "../server/orgContext";
import { runAskAgent, executeTool } from "../server/ask-c3";

const user = {
  userId: 1,
  orgId: 1,
  name: "Ethan Wood",
  role: "admin",
  managerish: true,
  timezone: "America/Los_Angeles",
};

const clrUser = { ...user, userId: 1, managerish: false, role: "assistant", name: "Test CLR" };

async function main() {
  await runWithOrg({ orgId: 1, superAdmin: false } as any, async () => {
    // 1. Tool-layer checks (no API spend)
    const lb = await executeTool(user, "get_leaderboard", { start_date: "2026-04-01", end_date: "2026-04-30" });
    console.log("[tool] leaderboard rows:", Array.isArray(lb) ? lb.length : JSON.stringify(lb).slice(0, 120));
    const los = await executeTool(user, "list_loan_officers", {});
    const loJson = JSON.stringify(los);
    if (/password|credential/i.test(loJson)) throw new Error("CREDENTIALS LEAKED in list_loan_officers");
    console.log("[tool] loan officers:", (los as any).rows?.length, "— no credential keys ✓");
    const eodMgr = await executeTool(user, "get_eod_reports", { from: "2026-04-01", to: "2026-04-30" });
    const eodClr = await executeTool(clrUser, "get_eod_reports", { from: "2026-04-01", to: "2026-04-30" });
    console.log("[tool] eod manager rows:", (eodMgr as any).rows?.length, "| clr own rows:", (eodClr as any).rows?.length);
    const badDate = await executeTool(user, "get_dashboard_stats", { start_date: "nope", end_date: "2026-04-30" });
    console.log("[tool] bad date ->", JSON.stringify(badDate));

    // 1b. Computed-metrics tools (no API spend) — sample data lives in org 2.
    await runWithOrg({ orgId: 2, superAdmin: false } as any, async () => {
      const org2Mgr = { ...user, orgId: 2 };
      const metrics = await executeTool(org2Mgr, "get_team_metrics", { start_date: "2026-04-01", end_date: "2026-04-30" }) as any;
      console.log("[tool] team metrics: clrs:", metrics?.team?.clrCount, "| avg transfers/CLR:", metrics?.team?.avgTransfersPerClr,
        "| total transfers:", metrics?.team?.totalTransfers, "| perClr sample:", JSON.stringify(metrics?.perClr?.[0] ?? null));
      if (!metrics?.team || metrics.team.totalTransfers < 1) throw new Error("team metrics returned no transfers for org 2 sample data");
      const trends = await executeTool(org2Mgr, "get_clr_trends", { weeks: 4 }) as any;
      console.log("[tool] trends weeks:", trends?.weeks?.length, "| last week:", JSON.stringify(trends?.weeks?.[trends.weeks.length - 1] ?? null));
      if (!Array.isArray(trends?.weeks) || trends.weeks.length !== 4) throw new Error("trends did not return 4 weekly buckets");
    });

    // 2. Live multi-hop agent run (Sonnet, adaptive thinking, tool_choice any)
    const abort = new AbortController();
    const events: string[] = [];
    const result = await runAskAgent({
      user: user as any,
      question: "Who had the most transfers between 2026-04-01 and 2026-04-30, and how many appointments did the team set in that window?",
      tier: "medium",
      history: [],
      signal: abort.signal,
      onProgress: (event) => events.push(event.type + (event.type === "tool" ? `:${(event as any).name}:${(event as any).ok}` : "")),
    });
    console.log("[run] stoppedReason:", result.stoppedReason, "| toolCalls:", result.toolCalls, "| usage:", JSON.stringify(result.usage));
    console.log("[run] events:", events.join(" "));
    console.log("[run] answer:\n" + result.answer);
    if (result.stoppedReason !== "end_turn") throw new Error("run did not finish cleanly: " + result.stoppedReason);
    if (result.toolCalls < 1) throw new Error("no tool calls — grounding failed");
    if (!result.answer.trim()) throw new Error("empty answer");

    // 3. Follow-up WITH history (exercises alternation bounding)
    const followup = await runAskAgent({
      user: user as any,
      question: "And which loan officer received the most of those transfers?",
      tier: "medium",
      history: [
        { role: "user", content: "Who had the most transfers between 2026-04-01 and 2026-04-30?" },
        { role: "assistant", content: result.answer },
      ],
      signal: abort.signal,
      onProgress: () => {},
    });
    console.log("[followup] stoppedReason:", followup.stoppedReason, "| toolCalls:", followup.toolCalls);
    console.log("[followup] answer:\n" + followup.answer.slice(0, 600));
    if (!followup.answer.trim()) throw new Error("empty follow-up answer");
    console.log("\nALL PASS");
  });
}

main().catch((error) => { console.error("FAIL:", error?.message ?? error); process.exit(1); });
