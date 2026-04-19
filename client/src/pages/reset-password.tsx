import { useState, FormEvent, useEffect } from "react";
import { useLocation } from "wouter";
import { Lock, ArrowRight, AlertTriangle, CheckCircle2, KeyRound } from "lucide-react";

function getTokenFromUrl(): string {
  // main.tsx normalizes "#/reset-password?token=XYZ" by moving the query string
  // from the hash to location.search, so we read from URL search params here.
  // Falls back to parsing the hash in case normalization hasn't run.
  const fromSearch = new URLSearchParams(window.location.search).get("token");
  if (fromSearch) return fromSearch;
  const hash = window.location.hash || "";
  const qIdx = hash.indexOf("?");
  if (qIdx === -1) return "";
  return new URLSearchParams(hash.slice(qIdx + 1)).get("token") || "";
}

export default function ResetPassword() {
  const [, navigate] = useLocation();
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setToken(getTokenFromUrl());
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError("This reset link is invalid or has expired.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, newPassword, confirmPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "This reset link is invalid or has expired.");
      } else {
        setSuccess(true);
        setTimeout(() => { navigate("/"); }, 1500);
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const invalidToken = !token;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f0f4f8] px-4">
      <div className="w-full max-w-md">
        <div className="bg-[#1A2B4A] rounded-2xl p-8 mb-1 shadow-2xl text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center flex-shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-lg leading-tight">Set New Password</div>
              <div className="text-blue-200 text-xs">CLR Connection Center</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-100">
          <h2 className="text-lg font-bold text-[#1A2B4A] mb-1">Choose a new password</h2>
          <p className="text-slate-500 text-sm mb-6">
            Enter a new password for your account.
          </p>

          {invalidToken ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2.5 rounded-lg bg-red-50 border border-red-200 px-3 py-3 text-sm text-red-700">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>This reset link is invalid or has expired.</span>
              </div>
              <a
                href="#/forgot-password"
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg
                  bg-[#1A2B4A] hover:bg-[#243a63] active:bg-[#131f35]
                  text-white text-sm font-semibold tracking-wide
                  transition-all duration-150 shadow-md hover:shadow-lg"
              >
                Request a new link
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  New Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    value={newPassword}
                    onChange={(e) => { setNewPassword(e.target.value); setError(null); }}
                    placeholder="At least 8 characters"
                    className="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400
                      focus:outline-none focus:ring-2 focus:ring-[#1A2B4A]/20 focus:border-[#1A2B4A] focus:bg-white transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Confirm New Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); setError(null); }}
                    placeholder="Repeat new password"
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

              {success && (
                <div className="flex items-start gap-2.5 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5 text-sm text-green-700">
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>Password updated! Redirecting to login…</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || success}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg
                  bg-[#1A2B4A] hover:bg-[#243a63] active:bg-[#131f35]
                  disabled:opacity-60 disabled:cursor-not-allowed
                  text-white text-sm font-semibold tracking-wide
                  transition-all duration-150 shadow-md hover:shadow-lg"
              >
                {loading ? "Updating…" : (
                  <>
                    Update Password
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-4">
          © {new Date().getFullYear()} West Capital Lending, Inc. · Internal use only
        </p>
      </div>
    </div>
  );
}
