/** Stable 15% sampling: polling/reloading must not reroll a transfer. */
export function showsFieldRace(eventId: string): boolean {
  let hash = 2166136261;
  for (const char of eventId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 100 < 15;
}
