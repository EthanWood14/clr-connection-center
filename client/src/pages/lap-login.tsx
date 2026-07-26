import { FormEvent, useState } from "react";
import { AlertTriangle, ArrowRight, Eye, EyeOff, Lock, Mail, ShieldCheck } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { LapBrand } from "@/components/lap/lap-brand";

export default function LapLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/login", {
        email: email.trim(),
        password: password.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      window.location.hash = "#/lap";
      window.location.reload();
    } catch (cause: any) {
      setError(cause?.message ?? "We couldn’t sign you in.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="lap-login min-h-screen overflow-hidden px-4 py-8 sm:px-6">
      <div className="lap-login-grid pointer-events-none fixed inset-0" aria-hidden="true" />
      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl items-center justify-center">
        <div className="grid w-full overflow-hidden rounded-[1.75rem] border border-white/10 bg-card shadow-2xl lg:grid-cols-[1.05fr_0.95fr]">
          <section className="relative hidden min-h-[620px] overflow-hidden bg-[#3B111A] p-12 text-white lg:flex lg:flex-col">
            <div className="absolute -right-24 -top-28 h-80 w-80 rounded-full bg-[#8B2F3F]/35 blur-3xl" />
            <div className="absolute -bottom-32 -left-28 h-96 w-96 rounded-full bg-[#6E1F2B]/45 blur-3xl" />
            <div className="relative">
              <LapBrand inverse className="h-14" />
              <p className="mt-7 max-w-md text-2xl font-semibold leading-tight">
                The focused operating desk for loan officer support.
              </p>
              <p className="mt-4 max-w-md text-sm leading-7 text-white/65">
                Keep borrower results organized, maintain a clean handoff record, and stay connected to your LO team from one secure workspace.
              </p>
            </div>

            <div className="relative mt-auto space-y-3">
              {[
                "Credit reports, AUS findings, and formal quotes",
                "Shared team workflow and attendance tools",
                "Organization-scoped access and document controls",
              ].map((value) => (
                <div key={value} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-white/80">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-[#E3ADB5]" />
                  {value}
                </div>
              ))}
            </div>
          </section>

          <section className="flex min-h-[620px] flex-col justify-center bg-[#FFF9F4] p-7 sm:p-11 dark:bg-[#1B0C10]">
            <LapBrand className="mb-10 h-12 lg:hidden" />
            <div className="mx-auto w-full max-w-sm">
              <div className="mb-8">
                <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                  <Lock className="h-3 w-3" />
                  Authorized team access
                </span>
                <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground">Welcome to LAP</h1>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Sign in with your existing West Capital Lending account.
                </p>
              </div>

              <form onSubmit={submit} className="space-y-5">
                <div className="space-y-1.5">
                  <label htmlFor="lap-email" className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground/70">
                    Email address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      id="lap-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="you@westcapitallending.com"
                      className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                      data-testid="lap-login-email"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor="lap-password" className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground/70">
                      Password
                    </label>
                    <a
                      href={`${window.location.pathname}?portal=lap#/forgot-password`}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Forgot password?
                    </a>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      id="lap-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="h-11 w-full rounded-xl border border-input bg-background pl-10 pr-11 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                      data-testid="lap-login-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/15 transition hover:bg-[#5B1823] disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-[#A64051]"
                  data-testid="lap-login-submit"
                >
                  {loading ? "Signing in…" : (
                    <>
                      Enter LAP
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-8 border-t border-border/70 pt-5 text-center text-xs text-muted-foreground">
                Need the CLR workspace?{" "}
                <a href="#/login" className="font-semibold text-primary hover:underline">Open C3 sign-in</a>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
