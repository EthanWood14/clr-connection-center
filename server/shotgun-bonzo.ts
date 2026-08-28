// One-click Shotgun from Bonzo — pure helpers for the Chrome extension's
// POST /api/shotgun/from-bonzo endpoint. The extension sends only a prospect
// id (captured from the Bonzo page's own API traffic); the server re-fetches
// the prospect from the Bonzo API so the published lead always carries what
// Bonzo actually has, not what a content script scraped.

// Bonzo stores `state` inconsistently: sometimes "CA", sometimes "California".
// The Shotgun publish gate needs the 2-letter code (calling-hours check), so
// accept both. Codes are validated again against SHOTGUN_STATE_CODES in routes.
const US_STATE_NAME_TO_CODE: Record<string, string> = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA",
  COLORADO: "CO", CONNECTICUT: "CT", DELAWARE: "DE", FLORIDA: "FL", GEORGIA: "GA",
  HAWAII: "HI", IDAHO: "ID", ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA",
  KANSAS: "KS", KENTUCKY: "KY", LOUISIANA: "LA", MAINE: "ME", MARYLAND: "MD",
  MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN", MISSISSIPPI: "MS", MISSOURI: "MO",
  MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV", "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ",
  "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", OHIO: "OH",
  OKLAHOMA: "OK", OREGON: "OR", PENNSYLVANIA: "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX", UTAH: "UT", VERMONT: "VT",
  VIRGINIA: "VA", WASHINGTON: "WA", "WEST VIRGINIA": "WV", WISCONSIN: "WI", WYOMING: "WY",
  "DISTRICT OF COLUMBIA": "DC", "WASHINGTON DC": "DC",
};

const US_STATE_CODES = new Set(Object.values(US_STATE_NAME_TO_CODE));

export function normalizeStateCode(raw: string | null | undefined): string {
  const s = String(raw ?? "").replace(/\./g, "").trim().toUpperCase().replace(/\s+/g, " ");
  if (!s) return "";
  // "ON"/"BC" must miss here, not die later on the composer's generic error.
  if (/^[A-Z]{2}$/.test(s)) return US_STATE_CODES.has(s) ? s : "";
  return US_STATE_NAME_TO_CODE[s] ?? "";
}

// The prospect id is the integer path segment after /prospects/ — the shape of
// every Bonzo API and web path. Accepts a bare numeric id too.
export function extractProspectId(urlOrId: unknown): number | null {
  if (typeof urlOrId === "number" && Number.isSafeInteger(urlOrId) && urlOrId > 0) return urlOrId;
  const s = String(urlOrId ?? "").trim();
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  const m = s.match(/\/prospects\/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// Bonzo's `source` is usually an ingestion channel, not a marketing source —
// verified live: real prospects carry source:"webhook". Stamping that into a
// shotgun lead would pollute the lead-source analytics, so technical channel
// names fall back to plain "Bonzo". (custom_source, when set, is the human
// one and is preferred upstream in getProspectDetail.)
const TECHNICAL_SOURCES = new Set(["webhook", "api", "import", "imported", "manual", "zapier", "csv"]);
export function cleanBonzoSource(source: string): string {
  const s = String(source ?? "").trim();
  if (!s || TECHNICAL_SOURCES.has(s.toLowerCase())) return "Bonzo";
  return s;
}

export type BonzoProspectDetail = {
  id: number;
  firstName: string;
  lastName: string;
  fullName: string;
  phone: string;
  email: string;
  state: string;
  city: string;
  source: string;
  assignedUserName: string;
  pipelineName: string;
  stageName: string;
};

// The context a CLR needs when the lead card pops — where the prospect sits in
// Bonzo and who to hand them back to. Kept short: the composer's 3000-char cap
// applies to hand-typed notes too.
export function buildBonzoManagerNotes(
  detail: BonzoProspectDetail,
  publisherName: string,
  pageUrl: string | null,
): string {
  const lines: string[] = [`One-click from Bonzo by ${publisherName}.`];
  const stage = [detail.pipelineName, detail.stageName].filter(Boolean).join(" / ");
  if (stage) lines.push(`Bonzo pipeline: ${stage}`);
  if (detail.assignedUserName) lines.push(`Assigned in Bonzo: ${detail.assignedUserName}`);
  if (detail.city || detail.state) lines.push(`Location: ${[detail.city, detail.state].filter(Boolean).join(", ")}`);
  lines.push(pageUrl && /^https:\/\/(?:platform|app)\.getbonzo\.com\//.test(pageUrl) ? pageUrl : `Bonzo prospect #${detail.id}`);
  return lines.join("\n").slice(0, 3000);
}
