/** An assignee, campaign, or pipeline name alone is not stage membership. */
export function hasPipelineStage(lead: unknown): boolean {
  if (!lead || typeof lead !== "object" || Array.isArray(lead)) return false;
  const row = lead as Record<string, any>;
  const stage = row.stage ?? row.pipelineStage ?? row.pipeline_stage;
  const name = typeof stage === "string" ? stage : stage?.name ?? row.stageName ?? row.stage_name;
  if (typeof name === "string") {
    const normalized = name.trim().toLowerCase().replace(/[\s_-]+/g, " ").trim();
    if (normalized && !["0", "none", "null", "undefined", "n/a", "unassigned", "no stage", "no pipeline", "no pipeline stage", "not in pipeline", "unknown"].includes(normalized)) return true;
  }
  const id = stage?.id ?? row.stageId ?? row.stage_id ?? row.pipelineStageId ?? row.pipeline_stage_id;
  return (typeof id === "number" || (typeof id === "string" && /^\d+$/.test(id.trim())))
    && Number.isSafeInteger(Number(id)) && Number(id) > 0;
}
