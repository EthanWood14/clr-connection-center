export type ProductPortal = "c3" | "lap" | "lop";

const LAP_HASH = /^#\/lap(?:\/|$|\?)/i;
const LOP_HASH = /^#\/lop(?:\/|$|\?)/i;

export function detectProductPortal(): ProductPortal {
  if (typeof window === "undefined") return "c3";
  try {
    if (LOP_HASH.test(window.location.hash || "")) return "lop";
    if (LAP_HASH.test(window.location.hash || "")) return "lap";
    const search = new URLSearchParams(window.location.search);
    const q = search.get("portal")?.toLowerCase();
    if (q === "lap" || q === "lop") return q;
    const hashQuery = (window.location.hash || "").split("?", 2)[1];
    const hq = hashQuery ? new URLSearchParams(hashQuery).get("portal")?.toLowerCase() : null;
    if (hq === "lap" || hq === "lop") return hq;
  } catch {}
  return "c3";
}

function setMeta(name: string, content: string) {
  const meta = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (meta) meta.content = content;
}

function setLink(
  selector: string,
  attributes: Record<string, string | null>,
) {
  const link = document.head.querySelector<HTMLLinkElement>(selector);
  if (!link) return;
  for (const [name, value] of Object.entries(attributes)) {
    if (value == null) link.removeAttribute(name);
    else link.setAttribute(name, value);
  }
}

function applyStoredTheme(portal: ProductPortal) {
  try {
    const key = portal === "c3" ? "theme" : `${portal}.theme`;
    const stored = localStorage.getItem(key);
    const dark = stored === "dark"
      || (stored !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch {}
}

export function applyProductMetadata(
  portal: ProductPortal = detectProductPortal(),
  options: { updateTitle?: boolean } = {},
) {
  if (typeof document === "undefined") return;
  // LOP shares LAP's visual identity and installable assets today; only the
  // product name differs. Split the icon set here if they ever diverge.
  const lap = portal !== "c3";
  const name = portal === "lop" ? "LOP" : "LAP";

  document.documentElement.classList.toggle("lap-mode", lap);
  applyStoredTheme(portal);

  setLink('link[rel="manifest"]', {
    href: lap ? "/manifest-lap.json" : "/manifest.json",
  });
  setLink('link[rel="icon"]:not([sizes])', {
    href: lap ? "/lap-icon-192.png" : "/favicon-32.png",
    type: "image/png",
  });
  setLink('link[rel="icon"][sizes="192x192"]', {
    href: lap ? "/lap-icon-192.png" : "/favicon-192.png",
    type: "image/png",
  });
  setLink('link[rel="icon"][sizes="512x512"]', {
    href: lap ? "/lap-icon-512.png" : "/favicon-512.png",
    type: "image/png",
  });
  setLink('link[rel="apple-touch-icon"]', {
    href: lap ? "/lap-icon-180.png" : "/apple-touch-icon.png",
    sizes: "180x180",
    type: "image/png",
  });
  setLink('link[rel="mask-icon"]', {
    href: lap ? "/lap-icon.svg" : "/logo-white.svg",
    color: lap ? "#6E1F2B" : "#3e5379",
    type: lap ? "image/svg+xml" : null,
  });

  setMeta("theme-color", lap ? "#3B111A" : "#3e5379");
  setMeta("apple-mobile-web-app-title", lap ? name : "WCLCC");
  setMeta("application-name", lap ? name : "WCLCC");
  setMeta("msapplication-TileColor", lap ? "#3B111A" : "#3e5379");
  setMeta("msapplication-TileImage", lap ? "/lap-icon-192.png" : "/favicon-192.png");

  if (options.updateTitle) {
    document.title = portal === "lop" ? "LOP · Loan Officer Portal" : portal === "lap" ? "LAP · LO Assistant Portal" : "WCLCC";
  }
}
