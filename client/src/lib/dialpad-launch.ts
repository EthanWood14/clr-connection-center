/** Official launcher: https://help.dialpad.com/docs/enable-click-to-call-on-third-party-apps */
export function dialpadCallUrl(phone: string): string {
  const raw = String(phone ?? "").trim();
  if (!raw || !/^[+\d\s().-]+$/.test(raw)) throw new Error("This lead needs a valid phone number before opening Dialpad.");
  let number = raw.replace(/[\s().-]/g, "");
  if (/^\d{10}$/.test(number)) number = `+1${number}`;
  else if (/^1\d{10}$/.test(number)) number = `+${number}`;
  if (!/^\+[1-9]\d{7,14}$/.test(number)) throw new Error("This lead needs a full phone number with country code before opening Dialpad.");
  return `https://dialpad.com/launch?phone=${encodeURIComponent(number)}`;
}

type LaunchWindow = Pick<Window, "closed" | "close" | "focus" | "opener" | "location" | "document">;

/**
 * Reserve a blank tab synchronously in the click gesture, BEFORE the claim
 * request. No phone number leaves C3 until the caller explicitly opens it
 * after a successful ownership/compliance check. C3 itself stays open.
 */
export function reserveDialpadLaunch(phone: string, openWindow: () => LaunchWindow | null = () => window.open("about:blank", "_blank")) {
  const url = dialpadCallUrl(phone);
  let popup: LaunchWindow | null = null;
  try {
    popup = openWindow();
    if (popup) {
      popup.opener = null;
      popup.document.title = "Preparing Dialpad";
      popup.document.body.textContent = "Securing your lead in C3 before opening Dialpad…";
    }
  } catch {
    try { popup?.close(); } catch { /* already closed */ }
    popup = null;
  }
  let settled = false;
  return {
    url,
    open(): boolean {
      if (settled) return false;
      settled = true;
      try {
        if (!popup || popup.closed) return false;
        popup.location.replace(url);
      } catch {
        try { popup?.close(); } catch { /* already closed */ }
        return false;
      }
      try { popup.focus(); } catch { /* focus may be denied even after successful navigation */ }
      return true;
    },
    cancel() {
      if (settled) return;
      settled = true;
      try { popup?.close(); } catch { /* already closed */ }
    },
  };
}
