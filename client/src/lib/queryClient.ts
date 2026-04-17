import { QueryClient } from "@tanstack/react-query";

const API_BASE = '__PORT_5000__'.startsWith('__') ? '' : '__PORT_5000__';

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
    throw new Error(err.error || res.statusText);
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
