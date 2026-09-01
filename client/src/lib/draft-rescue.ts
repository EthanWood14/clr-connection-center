/**
 * Save what someone was typing before the screen is taken away from them.
 *
 * The 4:15 EOD alarm blanks the app mid-sentence. Without this, a CLR halfway
 * through logging a transfer loses the borrower's name, the phone number and
 * the whole write-up — and the punishment for a late report becomes "do the
 * last ten minutes again", which is how people learn to resent a tool.
 *
 * Two layers, because neither is sufficient alone:
 *
 *  - A DOM sweep catches every ordinary input, textarea and select on screen
 *    without any form having to know this exists. It is the safety net, and it
 *    is what makes this work for forms nobody has touched since.
 *  - A registry lets a form hand over structured state the DOM cannot show —
 *    a react-hook-form object, an unsent draft held in a ref.
 *
 * Nothing here is a substitute for saving properly. It is a rescue, and it is
 * offered back once.
 */

const KEY_PREFIX = "c3:draft-rescue:";
/** Long enough to finish an EOD report and come back; short enough to expire. */
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** A pasted call transcript should not be able to fill the whole quota. */
const MAX_FIELD_CHARS = 20_000;

export interface RescuedDraft {
  /** Where the person was when the screen was taken. */
  route: string;
  reason: string;
  savedAt: number;
  /** Field label -> what was in it. */
  fields: Record<string, string>;
}

type Provider = () => Record<string, unknown> | null | undefined;

const providers = new Set<Provider>();

/**
 * Hand over state a DOM sweep cannot see. Returns its own unsubscribe, so a
 * component that registers on mount does not leak a closure over stale state.
 */
export function registerDraftProvider(fn: Provider): () => void {
  providers.add(fn);
  return () => { providers.delete(fn); };
}

const routeKey = () => {
  if (typeof window === "undefined") return "unknown";
  // Hash routing: the pathname is always "/" and tells us nothing.
  const hash = window.location.hash.replace(/^#/, "").split("?")[0];
  return hash || window.location.pathname || "/";
};

/** A label a person will recognise, since the field's own name rarely is one. */
function labelFor(el: HTMLElement, fallback: string): string {
  const testid = el.getAttribute("data-testid");
  const aria = el.getAttribute("aria-label");
  const name = el.getAttribute("name");
  const id = el.getAttribute("id");
  const byFor = id && typeof document !== "undefined"
    ? document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent?.trim()
    : "";
  return (byFor || aria || name || testid || fallback)
    .replace(/^(input|textarea|select)-/, "")
    .slice(0, 80);
}

/**
 * Snapshot everything on screen worth keeping.
 *
 * Passwords are skipped outright — rescuing one would put a credential in
 * localStorage, which is a worse outcome than retyping it.
 */
export function rescueDrafts(reason: string): RescuedDraft | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  const fields: Record<string, string> = {};

  try {
    const els = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "input, textarea, select",
    );
    let i = 0;
    for (const el of Array.from(els)) {
      i += 1;
      const type = (el.getAttribute("type") || "").toLowerCase();
      if (type === "password" || el.getAttribute("autocomplete") === "current-password") continue;
      if (type === "hidden" || el.disabled) continue;
      // Radix and friends render a real input behind a styled control to
      // carry the value for form submission. Rescuing those adds "field 4:
      // 8" to a list a person is meant to recognise, so skip anything the
      // page has already hidden from assistive tech or from view.
      if (el.getAttribute("aria-hidden") === "true") continue;
      if (el.closest("[aria-hidden='true']")) continue;
      if (!el.offsetParent && el.type !== "date") continue;
      let value = "";
      if (type === "checkbox" || type === "radio") {
        if (!(el as HTMLInputElement).checked) continue;
        value = (el as HTMLInputElement).value || "on";
      } else {
        value = String(el.value ?? "");
      }
      if (!value.trim()) continue;
      fields[labelFor(el, `field ${i}`)] = value.slice(0, MAX_FIELD_CHARS);
    }
  } catch { /* a sweep that throws must not stop the alarm */ }

  for (const p of Array.from(providers)) {
    try {
      const got = p();
      if (!got) continue;
      for (const [k, v] of Object.entries(got)) {
        const s = typeof v === "string" ? v : JSON.stringify(v);
        if (s && s !== "null" && s !== '""' && s.trim()) fields[k] = s.slice(0, MAX_FIELD_CHARS);
      }
    } catch { /* one bad provider must not lose the rest */ }
  }

  if (!Object.keys(fields).length) return null;
  const draft: RescuedDraft = { route: routeKey(), reason, savedAt: Date.now(), fields };
  try {
    window.localStorage.setItem(KEY_PREFIX + draft.route, JSON.stringify(draft));
  } catch { /* private mode, or full — the draft is lost, the alarm is not */ }
  return draft;
}

/** Every rescue still worth offering back, newest first. */
export function listRescuedDrafts(): RescuedDraft[] {
  if (typeof window === "undefined") return [];
  const out: RescuedDraft[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key?.startsWith(KEY_PREFIX)) continue;
      try {
        const d = JSON.parse(window.localStorage.getItem(key) || "") as RescuedDraft;
        if (!d?.savedAt || Date.now() - d.savedAt > MAX_AGE_MS) { window.localStorage.removeItem(key); continue; }
        if (d.fields && Object.keys(d.fields).length) out.push(d);
      } catch { window.localStorage.removeItem(key); }
    }
  } catch { return []; }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

export function clearRescuedDraft(route: string): void {
  try { window.localStorage.removeItem(KEY_PREFIX + route); } catch { /* nothing to clear */ }
}
