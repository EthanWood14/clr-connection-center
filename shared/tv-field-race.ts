/** Stable 15% sampling: polling/reloading must not reroll a transfer. */
export function showsFieldRace(eventId: string): boolean {
  let hash = 2166136261;
  for (const char of eventId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 100 < 15;
}

export function fieldStandings(people: { id: number; name: string; transfersToday: number }[]) {
  const sorted = [...people].sort((a,b) => b.transfersToday-a.transfersToday || a.name.localeCompare(b.name));
  const high = sorted[0]?.transfersToday ?? 0;
  const span = Math.max(2, high-(sorted.at(-1)?.transfersToday ?? 0));
  return sorted.map((p,i) => ({ ...p, rank: sorted.findIndex(r=>r.transfersToday===p.transfersToday)+1,
    gap: high-p.transfersToday, depth: 12 + (high-p.transfersToday)/span*54,
    color: `hsl(${(p.id*67)%360} 82% 62%)`, index:i }));
}
