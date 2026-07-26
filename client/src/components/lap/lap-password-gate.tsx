import { FormEvent, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, KeyRound, Lock } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { LapBrand } from "./lap-brand";

export function LapPasswordGate() {
  const { user, clearMustChangePassword, refetchUser } = useAuth();
  const [, navigate] = useLocation();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (user && !user.mustChangePassword) navigate("/");
  }, [user, navigate]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const next = password.trim();
    if (next.length < 8) {
      setError("Your new password must be at least 8 characters.");
      return;
    }
    if (next !== confirmation.trim()) {
      setError("The passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/users/me/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ newPassword: next, confirmPassword: next, forced: true }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error ?? "Couldn’t update your password.");

      setSuccess(true);
      clearMustChangePassword();
      await refetchUser();
      window.setTimeout(() => navigate("/"), 650);
    } catch (cause: any) {
      setError(cause?.message ?? "Couldn’t update your password.");
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
            <LapBrand inverse className="h-11" />
            <div className="mt-7 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-white/10">
                <KeyRound className="h-5 w-5 text-[#E8B8BE]" />
              </span>
              <div>
                <h1 className="text-lg font-semibold">Secure your LAP account</h1>
                <p className="mt-0.5 text-xs text-white/60">One-time password setup</p>
              </div>
            </div>
          </div>

          <div className="bg-[#FFF9F4] p-7 dark:bg-[#1B0C10]">
            <p className="mb-6 text-sm leading-6 text-muted-foreground">
              Choose a private password before entering the LO Assistant Portal.
            </p>

            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="lap-new-password" className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground/70">
                  New password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="lap-new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="At least 8 characters"
                    className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="lap-confirm-password" className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground/70">
                  Confirm password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    id="lap-confirm-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              {success && (
                <div className="flex items-start gap-2.5 rounded-xl border border-primary/25 bg-primary/10 px-3.5 py-3 text-sm text-primary">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  Password updated. Opening LAP…
                </div>
              )}

              <button
                type="submit"
                disabled={loading || success}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-[#5B1823] disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-[#A64051]"
              >
                {loading ? "Updating…" : (
                  <>
                    Save and continue
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            <p className="mt-5 text-center text-xs text-muted-foreground">Signed in as {user?.email}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
