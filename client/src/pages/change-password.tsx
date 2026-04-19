import { useState, FormEvent, useEffect } from "react";
import { useLocation } from "wouter";
import { Lock, ArrowRight, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth";

export default function ChangePassword() {
  const { user, isLoading, clearMustChangePassword } = useAuth();
  const [, navigate] = useLocation();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!isLoading && user && !user.mustChangePassword) {
      navigate("/");
    }
  }, [isLoading, user, navigate]);

  useEffect(() => {
    if (!user?.mustChangePassword) return;
    const blockBack = () => {
      window.history.pushState(null, "", window.location.href);
    };
    blockBack();
    window.addEventListener("popstate", blockBack);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("popstate", blockBack);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [user?.mustChangePassword]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
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
      const res = await fetch("/api/users/me/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ newPassword, confirmPassword, forced: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? "Failed to change password.");
      } else {
        setSuccess(true);
        clearMustChangePassword();
        setTimeout(() => {
          navigate("/");
        }, 800);
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f0f4f8]">
        <div className="text-slate-500 text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f0f4f8] px-4">
      <div className="w-full max-w-md">
        <div className="bg-[#1A2B4A] rounded-2xl p-8 mb-1 shadow-2xl text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center flex-shrink-0">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-lg leading-tight">Set a New Password</div>
              <div className="text-blue-200 text-xs">One-time setup required</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 border border-slate-100">
          <h2 className="text-lg font-bold text-[#1A2B4A] mb-1">
            Welcome to CLR Connection Center!
          </h2>
          <p className="text-slate-500 text-sm mb-6">
            Please set a new password to continue.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                New Password
              </label>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setError(null); }}
                placeholder="At least 8 characters"
                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400
                  focus:outline-none focus:ring-2 focus:ring-[#1A2B4A]/20 focus:border-[#1A2B4A] focus:bg-white transition-all"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
                Confirm New Password
              </label>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setError(null); }}
                placeholder="Repeat new password"
                className="w-full px-3 py-2.5 text-sm rounded-lg border border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400
                  focus:outline-none focus:ring-2 focus:ring-[#1A2B4A]/20 focus:border-[#1A2B4A] focus:bg-white transition-all"
              />
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
                <span>Password updated. Redirecting…</span>
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
        </div>

        <p className="text-center text-xs text-slate-400 mt-4">
          Signed in as {user.email}
        </p>
      </div>
    </div>
  );
}
