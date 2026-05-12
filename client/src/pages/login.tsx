import { useState, FormEvent } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Eye, EyeOff, Lock, Mail, ArrowRight, AlertTriangle } from "lucide-react";

// Animated background dots
function BackgroundPattern() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* Grid of subtle dots */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage: "radial-gradient(circle, #1A2B4A 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />
      {/* Gradient orbs */}
      <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-[#1A2B4A] opacity-[0.06] blur-3xl" />
      <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-[#1A2B4A] opacity-[0.06] blur-3xl" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-blue-50 opacity-40 blur-3xl" />
    </div>
  );
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/login", { email: email.trim(), password: password.trim() });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      window.location.hash = "#/";
      window.location.reload();
    } catch (err: any) {
      setError(err.message ?? "Login failed");
      setShake(true);
      setTimeout(() => setShake(false), 600);
    } finally {
      setLoading(false);
    }
  }

  async function handleDemoLogin() {
    setEmail("demo@clrconnection.com");
    setPassword("Demo2026!");
    setError(null);
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/login", { email: "demo@clrconnection.com", password: "Demo2026!" });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      window.location.hash = "#/";
      window.location.reload();
    } catch (err: any) {
      setError(err.message ?? "Demo login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f0f4f8] relative px-4">
      <BackgroundPattern />

      <div className="w-full max-w-md relative z-10">
        {/* Top branding card */}
        <div className="bg-gradient-to-br from-[#3e5379] to-[#1A2B4A] rounded-2xl p-8 mb-1 shadow-2xl text-white overflow-hidden relative">
          {/* Background texture inside card */}
          <div className="absolute inset-0 opacity-10"
            style={{ backgroundImage: "radial-gradient(circle at 80% 20%, white 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
          <div className="relative z-10 flex flex-col items-center text-center">
            <img
              src="/logo-white-full.svg"
              alt="CLR Connection Center"
              className="w-[200px] max-w-full h-auto mb-3"
              style={{ filter: "drop-shadow(0 4px 16px rgba(0,0,0,0.35))" }}
            />
            <div className="text-blue-100/90 text-[10px] uppercase tracking-[0.32em] font-semibold mb-3">
              West Capital Lending
            </div>
            <p className="text-blue-100 text-sm leading-relaxed">
              Your daily command center for CLR assignments, LO management, and transfer tracking.
            </p>
          </div>
        </div>

        {/* Login form card */}
        <div
          className={`bg-white rounded-2xl shadow-xl p-8 border border-slate-100 transition-all ${shake ? "animate-shake" : ""}`}
          style={shake ? { animation: "shake 0.5s ease-in-out" } : {}}
        >
          <h2 className="text-xl font-bold text-[#1A2B4A] mb-1">Welcome back</h2>
          <p className="text-slate-500 text-sm mb-6">Sign in to access your dashboard.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
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
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@westcapitallending.com"
                  className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400
                    focus:outline-none focus:ring-2 focus:ring-[#1A2B4A]/20 focus:border-[#1A2B4A] focus:bg-white transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  id="password"
                  type={showPass ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-10 py-2.5 text-sm rounded-lg border border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400
                    focus:outline-none focus:ring-2 focus:ring-[#1A2B4A]/20 focus:border-[#1A2B4A] focus:bg-white transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div className="flex justify-end pt-0.5">
                <a
                  href="#/forgot-password"
                  className="text-xs text-slate-500 hover:text-[#1A2B4A] hover:underline transition-colors"
                >
                  Forgot your password?
                </a>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg
                bg-[#1A2B4A] hover:bg-[#243a63] active:bg-[#131f35]
                disabled:opacity-60 disabled:cursor-not-allowed
                text-white text-sm font-semibold tracking-wide
                transition-all duration-150 shadow-md hover:shadow-lg
                focus:outline-none focus:ring-2 focus:ring-[#1A2B4A]/40 focus:ring-offset-2"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Signing in…
                </span>
              ) : (
                <>
                  Sign In
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Demo section */}
          <div className="mt-6 pt-5 border-t border-slate-100">
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-xs font-semibold text-[#1A2B4A]">Try the Demo</div>
                  <div className="text-[11px] text-slate-500">Explore a sandboxed read-only org</div>
                </div>
                <button
                  type="button"
                  onClick={handleDemoLogin}
                  disabled={loading}
                  className="text-xs font-semibold px-3 py-1.5 rounded-md bg-[#1A2B4A] text-white hover:bg-[#243a63] disabled:opacity-60 transition-colors"
                >
                  Login as Demo
                </button>
              </div>
              <div className="text-[11px] text-slate-500 font-mono">
                demo@clrconnection.com · Demo2026!
              </div>
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-6 pt-5 border-t border-slate-100 grid grid-cols-3 gap-2 text-center">
            {[
              { label: "CLR Assistants", value: "Active" },
              { label: "Platform", value: "Internal" },
              { label: "Updates", value: "Live" },
            ].map(item => (
              <div key={item.label}>
                <div className="text-xs font-bold text-[#1A2B4A]">{item.value}</div>
                <div className="text-[10px] text-slate-400">{item.label}</div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-4">
          © {new Date().getFullYear()} West Capital Lending, Inc. · Internal use only
        </p>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          15% { transform: translateX(-6px); }
          30% { transform: translateX(6px); }
          45% { transform: translateX(-4px); }
          60% { transform: translateX(4px); }
          75% { transform: translateX(-2px); }
          90% { transform: translateX(2px); }
        }
      `}</style>
    </div>
  );
}
