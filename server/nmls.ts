// NMLS Consumer Access license verification.
//
// NMLS Consumer Access (https://www.nmlsconsumeraccess.org) sits behind a
// Cloudflare Turnstile challenge that blocks non-browser requests with 403.
// We do a best-effort fetch — if the page comes back without the challenge
// marker we parse it; otherwise we return status "Unknown" so the admin UI
// surfaces a direct link for manual verification.

export type NmlsStatus = "Active" | "Inactive" | "Expired" | "Unknown";

export interface NmlsCheckResult {
  status: NmlsStatus;
  states: string[];
  licenseExpiration: string | null;
  rawError?: string;
  blocked: boolean;
}

export function nmlsProfileUrl(nmlsId: string): string {
  return `https://www.nmlsconsumeraccess.org/EntityDetails.aspx/INDIVIDUAL/${encodeURIComponent(nmlsId)}`;
}

function extractStates(html: string): string[] {
  // License tables on NMLS typically list state codes in two-letter uppercase
  // inside tds. We scan for a "State-Regulated" or licensing block and pull
  // two-letter codes. Heuristic — works when the HTML is accessible.
  const codes = new Set<string>();
  const re = /\b([A-Z]{2})\b(?=\s*(?:<|\bState\b|-|,))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const code = m[1];
    if (US_STATE_CODES.has(code)) codes.add(code);
  }
  return Array.from(codes).sort();
}

function extractStatus(html: string): NmlsStatus {
  const h = html.toLowerCase();
  if (/\bexpired\b/.test(h)) return "Expired";
  if (/\bterminated\b|\binactive\b|\brevoked\b|\bsurrendered\b/.test(h)) return "Inactive";
  if (/\bapproved\b|\bactive\b|\blicensed\b/.test(h)) return "Active";
  return "Unknown";
}

function extractExpiration(html: string): string | null {
  const m = /Expiration(?:\s*Date)?\s*[:<][^0-9]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(html);
  return m ? m[1] : null;
}

function looksBlocked(html: string): boolean {
  return (
    html.includes("Just a moment") ||
    html.includes("challenges.cloudflare.com") ||
    html.includes("cf-browser-verification") ||
    html.length < 2000
  );
}

export async function checkNmlsLicense(nmlsId: string): Promise<NmlsCheckResult> {
  if (!nmlsId || !nmlsId.trim()) {
    return { status: "Unknown", states: [], licenseExpiration: null, blocked: false, rawError: "no nmls id" };
  }
  const url = nmlsProfileUrl(nmlsId.trim());
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    });
    clearTimeout(t);
    const html = await res.text();
    if (res.status !== 200 || looksBlocked(html)) {
      return {
        status: "Unknown",
        states: [],
        licenseExpiration: null,
        blocked: true,
        rawError: `http ${res.status}`,
      };
    }
    return {
      status: extractStatus(html),
      states: extractStates(html),
      licenseExpiration: extractExpiration(html),
      blocked: false,
    };
  } catch (err: any) {
    return {
      status: "Unknown",
      states: [],
      licenseExpiration: null,
      blocked: true,
      rawError: err?.message ?? "fetch failed",
    };
  }
}

const US_STATE_CODES = new Set<string>([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC","PR","VI","GU",
]);
