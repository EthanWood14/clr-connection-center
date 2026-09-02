// LAP package-note email batching.
//
// An LOA's note on a package is emailed after the send-delay window, and a
// further note cancels and re-queues that email so notes posted in quick
// succession go out as one message. This module decides which notes ride
// along in the re-queued email. It is pure so the rule can be tested without
// the email queue.
//
// Membership used to be decided by note age: keep everything younger than the
// delay window plus a small margin. That was wrong because every re-queue
// restarts the window. With notes at 0s, 29s and 36s the third note evicted
// the first before any email had gone out, so the first note was never
// emailed at all; and a note landing 30-35s after a dispatched one pulled the
// already-sent note back into a second email. Whether the previous queued
// email was still pending when it was cancelled is the real signal, and that
// is what the caller passes in.

export type LapNoteBatchEntry = { authorName: string; body: string; at: number };

/**
 * The notes the next email should carry. `prior` is the batch behind the
 * previous queued email for this package (if any) and `cancelled` is how many
 * pending emails were just cancelled under its key. More than zero means the
 * previous email never went out, so its notes fold into this one; zero means
 * it already went out (or nothing was queued), so the new note starts fresh.
 */
export function foldLapNoteBatch(prior: LapNoteBatchEntry[] | undefined, cancelled: number, note: LapNoteBatchEntry): LapNoteBatchEntry[] {
  return cancelled > 0 ? [...(prior ?? []), note] : [note];
}
