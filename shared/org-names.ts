/**
 * Organization dual naming.
 *
 * - company_name  → client-facing / legal name (emails, portal, external surfaces)
 * - nickname      → optional C3-internal label (boards, SA lists, impersonation)
 * - name          → legacy org name; kept for slug/compat. Nickname falls back to it.
 *
 * Example: company_name "West Capital Lending", nickname "West Capital — Victory"
 * so operators can tell Victory vs Retail apart while clients still see the legal name.
 */

export type OrgNameFields = {
  name?: string | null;
  companyName?: string | null;
  company_name?: string | null;
  nickname?: string | null;
};

/** Name C3 operators see in lists, boards, manager/TV chrome, SA console. */
export function orgInternalLabel(org: OrgNameFields | null | undefined): string {
  if (!org) return "CLR Connection Center";
  const nick = (org.nickname ?? "").trim();
  if (nick) return nick;
  const name = (org.name ?? "").trim();
  if (name) return name;
  return orgClientFacingName(org);
}

/** Name clients / external surfaces see (portal, invites-to-borrowers, email From). */
export function orgClientFacingName(org: OrgNameFields | null | undefined): string {
  if (!org) return "CLR Connection Center";
  const company = (org.companyName ?? org.company_name ?? "").trim();
  if (company) return company;
  const name = (org.name ?? "").trim();
  if (name) return name;
  return "CLR Connection Center";
}

/** True when the query matches nickname, company name, or legacy name (case-insensitive). */
export function orgMatchesQuery(org: OrgNameFields, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    org.nickname,
    org.name,
    org.companyName ?? org.company_name,
  ]
    .filter(Boolean)
    .map((s) => String(s).toLowerCase());
  return hay.some((h) => h.includes(q));
}
