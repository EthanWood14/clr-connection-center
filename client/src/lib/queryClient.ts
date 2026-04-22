import { QueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";

const API_BASE = '__PORT_5000__'.startsWith('__') ? '' : '__PORT_5000__';

const DEMO_READONLY_MSG = "Demo mode is read-only. Sign up for full access.";

let lastDemoToastAt = 0;
function showDemoToast() {
  const now = Date.now();
  if (now - lastDemoToastAt < 3000) return;
  lastDemoToastAt = now;
  // Broadcast for any listener (App.tsx) to render a rich toast with a real button.
  try { window.dispatchEvent(new CustomEvent("demo-readonly")); } catch {}
  toast({
    title: "This is a demo — sign up for full access",
    description: "Visit /landing#request-access to request full access.",
    variant: "destructive" as any,
  });
}

export async function apiRequest(method: string, path: string, body?: any) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const errMsg = err.error || res.statusText;
    if (res.status === 403 && errMsg === DEMO_READONLY_MSG) {
      showDemoToast();
    }
    throw new Error(errMsg);
  }
  return res.json();
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: ({ queryKey }) => apiRequest("GET", queryKey[0] as string),
      staleTime: 30000,
    },
  },
});
