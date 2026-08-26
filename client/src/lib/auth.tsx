import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { queryClient, apiRequest } from "./queryClient";
import { detectProductPortal } from "./product-metadata";

async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (
    typeof window === "undefined"
    || !("serviceWorker" in navigator)
    || !("PushManager" in window)
    || !("Notification" in window)
    || Notification.permission !== "granted"
  ) {
    return null;
  }

  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration?.pushManager.getSubscription() ?? null;
}

async function rebindExistingPushSubscription() {
  try {
    const subscription = await getExistingPushSubscription();
    if (!subscription) return;
    await apiRequest("POST", "/api/push/subscribe", {
      subscription: subscription.toJSON(),
    });
  } catch {
    // Push is optional. A later auth refresh or service-worker-ready event retries.
  }
}

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: string;
  isClr: boolean;
  isManager?: boolean;
  hasSeenIntro: boolean;
  hasDismissedSample?: boolean;
  lastSeenPipelineSop?: string | null;
  mustChangePassword: boolean;
  createdAt: string | null;
  scriptCompanyName?: string | null;
  scriptNameOverride?: string | null;
  scriptLoOverride?: string | null;
  superAdmin?: boolean;
  orgId?: number;
  isDemo?: boolean;
  /** 'lap' = LO Assistant Portal account; null/'c3' = internal staff. */
  portal?: string | null;
  isImpersonating?: boolean;
  impersonatingOrgName?: string | null;
  reminderEmailEnabled?: boolean;
  smsRemindersEnabled?: boolean;
  muteChatNotifications?: boolean;
  muteForumNotifications?: boolean;
  muteLapChatNotifications?: boolean;
  muteLapForumNotifications?: boolean;
  phone?: string | null;
  timezone?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  logout: () => Promise<void>;
  markIntroSeen: () => Promise<void>;
  markPipelineSopSeen: () => Promise<void>;
  markSampleDismissed: () => void;
  clearMustChangePassword: () => void;
  refetchUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  logout: async () => {},
  markIntroSeen: async () => {},
  markPipelineSopSeen: async () => {},
  markSampleDismissed: () => {},
  clearMustChangePassword: () => {},
  refetchUser: async () => {},
});

/**
 * Only a 401 means "signed out". Anything else — a 502, a request that timed
 * out because the server was busy, a phone that dropped off Wi-Fi for a second
 * — means "we could not tell", and the session must survive it.
 *
 * This ran as a bare fetch with no retry, so a single failed request logged the
 * user out with a perfectly valid seven-day cookie still in the browser. Under
 * the load of the one-second Shotgun poll that happened all day.
 */
async function fetchMe(attempts = 3): Promise<any> {
  let lastError: any;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await apiRequest("GET", "/api/auth/me");
    } catch (error: any) {
      if (error?.status === 401) throw error; // genuinely signed out — do not retry
      lastError = error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchMe()
      .then((data: any) => {
        setUser(data.user ?? null);
        try {
          const w = window as any;
          w.__clrIsSuperAdmin = !!data?.user?.superAdmin;
          w.__clrIsImpersonating = !!data?.user?.isImpersonating;
        } catch {}
      })
      .catch(() => {
        // Reached only after a 401, or after every retry failed. Either way
        // there is no session to preserve on a first load.
        setUser(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!user) return;
    const rebind = () => { void rebindExistingPushSubscription(); };
    rebind();
    window.addEventListener("wcl:service-worker-ready", rebind);
    return () => window.removeEventListener("wcl:service-worker-ready", rebind);
  }, [user?.id, user?.orgId]);

  const logout = useCallback(async () => {
    const portal = detectProductPortal();
    let pushEndpoint = "";
    try {
      const subscription = await getExistingPushSubscription();
      if (subscription) {
        pushEndpoint = subscription.endpoint;
        await apiRequest("DELETE", "/api/push/unsubscribe", {
          endpoint: pushEndpoint,
        });
      }
    } catch {
      // Logout must still complete if the device subscription cannot be detached.
    }
    await apiRequest("POST", "/api/auth/logout", { pushEndpoint }).catch(() => {});
    setUser(null);
    queryClient.clear();
    window.location.hash = portal === "lap" ? "#/lap" : "#/login";
  }, []);

  const markIntroSeen = useCallback(async () => {
    await apiRequest("PATCH", "/api/users/me/seen-intro").catch(() => {});
    setUser((u) => u ? { ...u, hasSeenIntro: true } : u);
  }, []);

  const markPipelineSopSeen = useCallback(async () => {
    const ts = new Date().toISOString();
    await apiRequest("PATCH", "/api/users/me/seen-pipeline-sop").catch(() => {});
    setUser((u) => u ? { ...u, lastSeenPipelineSop: ts } : u);
  }, []);

  const markSampleDismissed = useCallback(() => {
    setUser((u) => u ? { ...u, hasDismissedSample: true } : u);
  }, []);

  const clearMustChangePassword = useCallback(() => {
    setUser((u) => u ? { ...u, mustChangePassword: false } : u);
  }, []);

  const refetchUser = useCallback(async () => {
    try {
      const data: any = await fetchMe();
      setUser(data.user ?? null);
      try {
        const w = window as any;
        w.__clrIsSuperAdmin = !!data?.user?.superAdmin;
        w.__clrIsImpersonating = !!data?.user?.isImpersonating;
      } catch {}
    } catch (error: any) {
      // Mid-session: drop the user only when the server actually says 401.
      // A refresh that fails for any other reason leaves them signed in.
      if (error?.status === 401) setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, logout, markIntroSeen, markPipelineSopSeen, markSampleDismissed, clearMustChangePassword, refetchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
