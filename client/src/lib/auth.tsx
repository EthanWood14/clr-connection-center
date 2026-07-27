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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    apiRequest("GET", "/api/auth/me")
      .then((data: any) => {
        setUser(data.user ?? null);
        try {
          const w = window as any;
          w.__clrIsSuperAdmin = !!data?.user?.superAdmin;
          w.__clrIsImpersonating = !!data?.user?.isImpersonating;
        } catch {}
      })
      .catch(() => {
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
      const data: any = await apiRequest("GET", "/api/auth/me");
      setUser(data.user ?? null);
      try {
        const w = window as any;
        w.__clrIsSuperAdmin = !!data?.user?.superAdmin;
        w.__clrIsImpersonating = !!data?.user?.isImpersonating;
      } catch {}
    } catch {
      setUser(null);
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
