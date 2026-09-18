/**
 * Prospects and conversations a CLR opens inside Bonzo, as seen by the C3
 * extension.
 *
 * Separate from Bonzo CALLS (shared/bonzo-calls.ts) and from Dialpad Call
 * Tools contacts/conversations on the scorecard. A "view" is the CLR opening
 * a prospect or a conversation thread — unique per CLR per target per
 * business day.
 */
export type BonzoViewType = "contact" | "conversation";
export const BONZO_VIEW_TYPES: readonly BonzoViewType[] = ["contact", "conversation"];
export const BONZO_VIEW_EVENT_BATCH_MAX = 50;

/** Unique contacts viewed per CLR per business day. Columns: org_id, assistant_id, d, contacts. */
export const BONZO_CONTACTS_VIEWED_BY_DAY_SQL = `(
  SELECT org_id, user_id AS assistant_id, business_date AS d, COUNT(*) AS contacts
    FROM bonzo_view_events
   WHERE view_type = 'contact'
   GROUP BY org_id, user_id, business_date
)`;

/** Unique conversations viewed per CLR per business day. Columns: org_id, assistant_id, d, conversations. */
export const BONZO_CONVERSATIONS_VIEWED_BY_DAY_SQL = `(
  SELECT org_id, user_id AS assistant_id, business_date AS d, COUNT(*) AS conversations
    FROM bonzo_view_events
   WHERE view_type = 'conversation'
   GROUP BY org_id, user_id, business_date
)`;
