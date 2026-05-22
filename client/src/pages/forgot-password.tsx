import { useState, FormEvent } from "react";
import { Mail, ArrowRight, ArrowLeft, AlertTriangle, CheckCircle2, KeyRound } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Something went wrong. Please try again.");
      } else {
        setSent(true);
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f0f4f8] px-4">
      <div className="w-full max-w-md">
        <div className="bg-[#1A2B4A] rounded-2xl p-8 mb-1 shadow-2xl text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center flex-shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-lg leading-tight">Reset Your Password</div>
              <div className="text-blue-200 text-xs">CLR Connection Center</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-100">
          <h2 className="text-lg font-bold text-[#1A2B4A] mb-1">Forgot your password?</h2>
          <p className="text-slate-500 text-sm mb-6">
            Enter your email address and we'll send you a reset link.
          </p>

          {sent ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2.5 rounded-lg bg-green-50 border border-green-200 px-3 py-3 text-sm text-green-700">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>If an account with that email exists, a reset link has been sent.</span>
              </div>
              <a
                href="#/login"
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg
                  bg-[#1A2B4A] hover:bg-[#243a63] active:bg-[#131f35]
                  text-white text-sm font-semibold tracking-wide
                  transition-all duration-150 shadow-md hover:shadow-lg"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Login
              </a>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(null); }}
                    placeholder="you@westcapitallending.com"
                    className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400
                      focus:outline-none focus:ring-2 focus:ring-[#1A2B4A]/20 focus:border-[#1A2B4A] focus:bg-white transition-all"
                  />
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg
                  bg-[#1A2B4A] hover:bg-[#243a63] active:bg-[#131f35]
                  disabled:opacity-60 disabled:cursor-not-allowed
                  text-white text-sm font-semibold tracking-wide
                  transition-all duration-150 shadow-md hover:shadow-lg"
              >
                {loading ? "Sending…" : (
                  <>
                    Send Reset Link
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              <div className="pt-2 text-center">
                <a href="#/login" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-[#1A2B4A] transition-colors">
                  <ArrowLeft className="w-3 h-3" />
                  Back to Login
                </a>
              </div>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-4">
          © {new Date().getFullYear()} WCL Team: Team Members Only
        </p>
      </div>
    </div>
  );
}
