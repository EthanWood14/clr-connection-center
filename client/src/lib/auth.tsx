import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { queryClient, apiRequest } from "./queryClient";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: string;
  isClr: boolean;
  hasSeenIntro: boolean;
  hasDismissedSample?: boolean;
  mustChangePassword: boolean;
  createdAt: string | null;
  scriptCompanyName?: string | null;
  scriptNameOverride?: string | null;
  scriptLoOverride?: string | null;
  superAdmin?: boolean;
  orgId?: number;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  logout: () => Promise<void>;
  markIntroSeen: () => Promise<void>;
  markSampleDismissed: () => void;
  clearMustChangePassword: () => void;
  refetchUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  logout: async () => {},
  markIntroSeen: async () => {},
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
      })
      .catch(() => {
        setUser(null);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const logout = useCallback(async () => {
    await apiRequest("POST", "/api/auth/logout").catch(() => {});
    setUser(null);
    queryClient.clear();
    window.location.hash = "#/login";
  }, []);

  const markIntroSeen = useCallback(async () => {
    await apiRequest("PATCH", "/api/users/me/seen-intro").catch(() => {});
    setUser((u) => u ? { ...u, hasSeenIntro: true } : u);
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
    } catch {
      setUser(null);
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, logout, markIntroSeen, markSampleDismissed, clearMustChangePassword, refetchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
