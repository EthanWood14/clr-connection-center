export function approvedTimeOffUserIds(db: any, orgId: number, date: string): Set<number> {
  const rows = db.prepare(`
    SELECT DISTINCT user_id
    FROM time_off_requests
    WHERE org_id=? AND status='approved' AND start_date<=? AND end_date>=?
  `).all(orgId, date, date) as Array<{ user_id: number }>;
  return new Set(rows.map(row => Number(row.user_id)));
}

export function assignmentClrsForDate(users: any[], db: any, orgId: number, date: string): any[] {
  const away = approvedTimeOffUserIds(db, orgId, date);
  return users.filter(user => {
    const userOrgId = Number(user.orgId ?? user.org_id ?? 1) || 1;
    const isActive = !!(user.isActive ?? user.is_active);
    const inDailyAssignments = !!(user.inDailyAssignments ?? user.in_daily_assignments);
    const excluded = !!(user.excludeFromStats ?? user.exclude_from_stats);
    const isClr = user.role === "assistant" || (user.role === "admin" && !!(user.isClr ?? user.is_clr));
    return userOrgId === orgId && isActive && inDailyAssignments && !excluded && isClr && !away.has(Number(user.id));
  });
}

export function resolveMonthlyClrAssignments(rows: any[], assistants: any[]): Array<{ row: any; assistantId: number }> {
  if (!assistants.length) return [];
  const orderedAssistants = [...assistants].sort((a, b) => Number(a.id) - Number(b.id));
  const availableIds = new Set(orderedAssistants.map(user => Number(user.id)));
  const counts = new Map<number, number>(orderedAssistants.map(user => [Number(user.id), 0]));

  return rows.map(row => {
    const originalId = Number(row.assistant_id ?? row.assistantId);
    let assistantId = originalId;
    if (!availableIds.has(originalId)) {
      assistantId = orderedAssistants.reduce((bestId, user) => {
        const id = Number(user.id);
        const count = counts.get(id) ?? 0;
        const bestCount = counts.get(bestId) ?? 0;
        return count < bestCount ? id : bestId;
      }, Number(orderedAssistants[0].id));
    }
    counts.set(assistantId, (counts.get(assistantId) ?? 0) + 1);
    return { row, assistantId };
  });
}
