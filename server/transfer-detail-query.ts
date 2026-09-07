import { buildTransferDetail, detailSummary, type TransferDetail } from "../shared/transfer-detail";

/**
 * Reading back one transfer, and deciding who is allowed to.
 *
 * The write-up score has been visible for a while and the write-up itself has
 * not, so "is this transfer any good?" has only ever been answerable in Bonzo.
 * This is the read side of that: one outcome row, every captured answer with
 * its value, and the free text, for whoever is entitled to see it.
 *
 * NOTHING HERE WRITES. The transfer is not editable through this path, by
 * anyone, at any level — a page built to answer questions about somebody's
 * work must not also be able to change it, or the record stops being evidence.
 */

/** A viewer, reduced to the three facts that decide what they may read. */
export interface DetailViewer {
  id: number;
  role?: string | null;
  isManager?: boolean | number | null;
  superAdmin?: boolean | number | null;
}

/** The stored row, as the query below returns it. */
export interface TransferDetailRow {
  id: number;
  date: string;
  assistantId: number;
  shotgunSenderId?: number | null;
  [key: string]: unknown;
}

const truthy = (v: unknown): boolean => v === true || v === 1 || v === "1";

/** Managers and admins read everyone's; everyone else reads their own. */
export function isDetailManager(viewer: DetailViewer | null | undefined): boolean {
  if (!viewer) return false;
  return viewer.role === "admin" || truthy(viewer.isManager) || truthy(viewer.superAdmin);
}

/**
 * May this person read this transfer?
 *
 * Deliberately the same manager test the rest of the app uses rather than a
 * second one — two definitions of "manager" drift, and the one that drifts is
 * always the copy nobody remembers exists.
 *
 * The shotgun publisher is included because half of this transfer is theirs.
 * Somebody credited with half a transfer they are not allowed to look at
 * cannot check it, which is the whole complaint this page exists to answer.
 */
export function canReadTransfer(
  viewer: DetailViewer | null | undefined,
  row: Pick<TransferDetailRow, "assistantId" | "shotgunSenderId"> | null | undefined,
): boolean {
  if (!viewer || !row) return false;
  if (isDetailManager(viewer)) return true;
  if (Number(row.assistantId) === Number(viewer.id)) return true;
  return row.shotgunSenderId != null && Number(row.shotgunSenderId) === Number(viewer.id);
}

/**
 * One outcome with the names a reader needs spelled out.
 *
 * The joins are LEFT because a transfer can predate an LO record, and a page
 * that 404s on a row with a tidy-up problem is a page that hides exactly the
 * transfers somebody wanted to look at.
 */
export const TRANSFER_DETAIL_SQL = `
  SELECT o.id, o.date, o.assistant_id AS assistantId, o.shotgun_sender_id AS shotgunSenderId,
         o.borrower_name AS borrowerName, o.phone_number AS phoneNumber,
         o.lead_source AS leadSource, o.outcome_type AS outcomeType,
         o.transfer_type AS transferType, o.lead_type AS leadType,
         o.conversation_notes AS conversationNotes, o.notes AS notes,
         o.prequalification_notes AS prequalificationNotes,
         o.lo_action_plan AS loActionPlan, o.next_steps AS nextSteps,
         o.lead_goal AS leadGoal, o.lead_timeframe AS leadTimeframe,
         o.follow_up_date AS followUpDate, o.appointment_datetime AS appointmentDatetime,
         o.helper_assisted AS helperAssisted, o.bulk_texter AS bulkTexter,
         o.lo_id AS loId, o.loa_id AS loaId, o.created_at AS createdAt,
         u.name AS clrName,
         sender.name AS shotgunSenderName,
         lo.full_name AS loName,
         loa.full_name AS loaName
  FROM lead_outcomes o
  LEFT JOIN users u ON u.id = o.assistant_id
  LEFT JOIN users sender ON sender.id = o.shotgun_sender_id
  LEFT JOIN loan_officers lo ON lo.id = o.lo_id
  LEFT JOIN loan_officer_assistants loa ON loa.id = o.loa_id
  WHERE o.id = ?
`;

/**
 * Whether this LO has an assistant, which the score needs to know: the LOA
 * question is only expected on a transfer to an LO who has one.
 */
export const TRANSFER_DETAIL_LOA_SQL = `
  SELECT COUNT(*) AS c FROM loan_officer_assistants
  WHERE lo_id = ? AND COALESCE(active, 1) = 1
`;

/**
 * The browsable list.
 *
 * A per-id page alone would not have answered the ask: knowing an id means
 * already knowing which transfer you want, and the thing nobody could do was
 * BROWSE what was entered. So the list carries enough of each write-up to
 * judge it — the score, the gaps, the borrower — and the same rows expand to
 * the full text without a second trip.
 *
 * Bound by name (`@who`, `@from`, `@to`, `@limit`). `@who` NULL means
 * everybody, so one query serves both a manager looking at one person and a
 * manager looking at everybody, rather than two queries that can quietly
 * disagree about what counts as a transfer.
 */
export const TRANSFER_DETAIL_LIST_SQL = `
  SELECT o.id, o.date, o.assistant_id AS assistantId, o.shotgun_sender_id AS shotgunSenderId,
         o.borrower_name AS borrowerName, o.phone_number AS phoneNumber,
         o.lead_source AS leadSource, o.transfer_type AS transferType,
         o.conversation_notes AS conversationNotes, o.notes AS notes,
         o.prequalification_notes AS prequalificationNotes,
         o.lo_action_plan AS loActionPlan, o.next_steps AS nextSteps,
         o.lead_goal AS leadGoal, o.created_at AS createdAt,
         o.lo_id AS loId, o.loa_id AS loaId,
         u.name AS clrName,
         sender.name AS shotgunSenderName,
         lo.full_name AS loName,
         loa.full_name AS loaName,
         (SELECT COUNT(*) FROM loan_officer_assistants a
           WHERE a.lo_id = o.lo_id AND COALESCE(a.active, 1) = 1) AS loaCount
  FROM lead_outcomes o
  LEFT JOIN users u ON u.id = o.assistant_id
  LEFT JOIN users sender ON sender.id = o.shotgun_sender_id
  LEFT JOIN loan_officers lo ON lo.id = o.lo_id
  LEFT JOIN loan_officer_assistants loa ON loa.id = o.loa_id
  WHERE o.outcome_type = 'transfer'
    AND (@who IS NULL OR o.assistant_id = @who OR o.shotgun_sender_id = @who)
    AND o.date >= @from AND o.date <= @to
  ORDER BY o.date DESC, o.id DESC
  LIMIT @limit
`;

/** How many rows one request may pull back. A page, not an export. */
export const TRANSFER_DETAIL_LIST_LIMIT = 400;

/**
 * The assistant filter, resolved from who is asking and who they asked about.
 *
 * A CLR is pinned to themselves whatever they send, so a hand-edited request
 * cannot read somebody else's book. Returning null means "everybody", which
 * only a manager can reach.
 */
export function listAssistantFilter(
  viewer: DetailViewer | null | undefined,
  requested: unknown,
): number | null {
  if (!viewer) return -1; // matches nobody; a signed-out request sees nothing
  if (!isDetailManager(viewer)) return Number(viewer.id);
  const asked = Number(requested);
  return Number.isFinite(asked) && asked > 0 ? asked : null;
}

export interface PresentedTransfer {
  id: number;
  date: string;
  borrowerName: string;
  phoneNumber: string;
  leadSource: string;
  transferType: string;
  /** Who made it, who it went to, and who published it if it was a shotgun. */
  clrName: string;
  loName: string;
  loaName: string;
  shotgunSenderName: string;
  summary: string;
  detail: TransferDetail;
}

const str = (v: unknown): string => String(v ?? "").trim();

/** Shape one row for the page. */
export function presentTransfer(row: TransferDetailRow, loHasLoa = false): PresentedTransfer {
  const detail = buildTransferDetail({ ...(row as any), loHasLoa });
  return {
    id: Number(row.id),
    date: str(row.date),
    borrowerName: str((row as any).borrowerName),
    phoneNumber: str((row as any).phoneNumber),
    leadSource: str((row as any).leadSource),
    transferType: str((row as any).transferType),
    clrName: str((row as any).clrName),
    loName: str((row as any).loName),
    loaName: str((row as any).loaName),
    shotgunSenderName: str((row as any).shotgunSenderName),
    summary: detailSummary(detail),
    detail,
  };
}
