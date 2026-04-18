import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { queryClient, apiRequest } from "./queryClient";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: string;
  isClr: boolean;
  hasSeenIntro: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  logout: () => Promise<void>;
  markIntroSeen: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  logout: async () => {},
  markIntroSeen: async () => {},
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

  return (
    <AuthContext.Provider value={{ user, isLoading, logout, markIntroSeen }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
