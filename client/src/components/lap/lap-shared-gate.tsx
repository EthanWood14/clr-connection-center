// The shared-password door to LAP.
//
// One password replaces individual logins, so there is no name attached to a
// session. The screen says so plainly rather than implying privacy it cannot
// provide: every browser that enters is tagged as a device and its actions are
// recorded under that tag.
import { FormEvent, useState } from "react";
import { KeyRound, ShieldAlert } from "lucide-react";
import { LapBrand } from "./lap-brand";

export function LapSharedGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/lap/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password: password.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error ?? "Could not unlock the portal.");
      onUnlocked();
    } catch (cause: any) {
      setError(cause?.message ?? "Could not unlock the portal.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lap-login min-h-screen px-4 py-8">
      <div className="lap-login-grid pointer-events-none fixed inset-0" aria-hidden="true" />
      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-md items-center">
        <div className="w-full overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-2xl">
          <div className="bg-[#3B111A] px-7 py-7 text-white">
            <LapBrand />
            <p className="mt-3 text-sm text-white/80">Enter the shared access password to open the portal.</p>
          </div>
          <form onSubmit={submit} className="space-y-4 px-7 py-7">
            <div className="space-y-1.5">
              <label htmlFor="lap-shared-password" className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground/70">
                Access password
              </label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="lap-shared-password"
                  type="password"
                  autoComplete="off"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-[#991b35]/40"
                  data-testid="lap-shared-password"
                />
              </div>
            </div>

            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="lap-gate-error">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !password.trim()}
              className="h-11 w-full rounded-lg bg-[#991b35] text-sm font-semibold text-white transition hover:bg-[#7f1d2d] disabled:opacity-60"
              data-testid="lap-gate-submit"
            >
              {loading ? "Unlocking…" : "Enter portal"}
            </button>

            <p className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                This password is shared, so your work is recorded against this <strong>device</strong> rather than your
                name. An administrator can see and revoke device access at any time.
              </span>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
