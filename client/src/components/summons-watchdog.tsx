import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { APP_VERSION } from "@shared/version";

/**
 * Makes sure C3 is actually awake before the call-in alarm has to fire.
 *
 * The alarm renders from a React Query poll. That is fine in a tab someone is
 * using, but these tabs sit open all day: the laptop sleeps, the query gets
 * wedged, or the tab is still running a build from three deploys ago. In any of
 * those states a manager could raise a summons and the screen would sit there
 * quietly — which is the one thing the feature must never do.
 *
 * So this watches for a summons on a plain fetch loop that owes nothing to
 * React Query, and when it finds one it reloads the page ONCE before the alarm
 * has to work. After the reload the app is on current code with a live poll,
 * and the alarm mounts normally.
 *
 * Deliberate limits:
 *  - One reload per summons, recorded in sessionStorage. A reload that does not
 *    fix things must not become a loop that makes the machine unusable.
 *  - Never within the first few seconds of a page load, for the same reason.
 *  - If the tab's JavaScript is dead outright, nothing here runs — no in-page
 *    watchdog can save that case. It covers a stalled poll and a stale build,
 *    not a crashed tab.
 */

const POLL_MS = 15_000;
const MIN_AGE_BEFORE_RELOAD_MS = 8_000;
const KEY = "c3.summons.refreshed";

function alreadyRefreshedFor(id: number): boolean {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return false;
    return raw.split(",").includes(String(id));
  } catch {
    // No sessionStorage (private mode, blocked storage) means no way to
    // remember a reload — so refuse to reload at all rather than risk a loop.
    return true;
  }
}

function rememberRefresh(id: number): boolean {
  try {
    const raw = sessionStorage.getItem(KEY) ?? "";
    const ids = raw ? raw.split(",") : [];
    if (!ids.includes(String(id))) ids.push(String(id));
    sessionStorage.setItem(KEY, ids.slice(-20).join(","));
    return true;
  } catch {
    return false;
  }
}

export function SummonsWatchdog() {
  const { user } = useAuth();
  const loadedAt = useRef(Date.now());
  const busy = useRef(false);

  useEffect(() => {
    if (!user) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const check = async () => {
      if (stopped || busy.current) return;
      busy.current = true;
      try {
        const r = await fetch("/api/summons/mine", {
          credentials: "include",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        if (!r.ok) return;
        const j = await r.json();
        const id = Number(j?.summons?.id);
        if (!j?.active || !Number.isFinite(id) || id <= 0) return;

        // Someone is being called in. Give the app one clean restart so the
        // alarm cannot be swallowed by a wedged poll or an old bundle.
        if (alreadyRefreshedFor(id)) return;
        if (Date.now() - loadedAt.current < MIN_AGE_BEFORE_RELOAD_MS) return;
        if (!rememberRefresh(id)) return;
        window.location.reload();
      } catch {
        // Offline or the request failed — try again on the next tick.
      } finally {
        busy.current = false;
      }
    };

    // A stale build is the other way the alarm goes quiet: the running tab has
    // code that predates the feature entirely. Reload on a version mismatch
    // regardless of whether a summons is pending right now.
    const checkBuild = async () => {
      if (stopped) return;
      try {
        const r = await fetch("/api/health", { cache: "no-store", credentials: "include" });
        if (!r.ok) return;
        const j = await r.json();
        const live = String(j?.version ?? "");
        if (!live || live === APP_VERSION) return;
        if (Date.now() - loadedAt.current < MIN_AGE_BEFORE_RELOAD_MS) return;
        if (alreadyRefreshedFor(-1)) return;
        if (!rememberRefresh(-1)) return;
        window.location.reload();
      } catch { /* nothing to do */ }
    };

    const loop = () => {
      void check();
      timer = setTimeout(loop, POLL_MS);
    };
    loop();
    void checkBuild();

    // A laptop coming out of sleep, or a network coming back, are exactly when
    // a poll has been dead for a while. Check straight away instead of waiting
    // out the interval.
    const onWake = () => { if (document.visibilityState === "visible") { void check(); void checkBuild(); } };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    window.addEventListener("focus", onWake);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
      window.removeEventListener("focus", onWake);
    };
  }, [user]);

  return null;
}
