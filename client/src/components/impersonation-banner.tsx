import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

export function ImpersonationBanner() {
  const { user } = useAuth();
  const { data: org } = useQuery<{ id: number; name: string; companyName: string }>({
    queryKey: ["/api/org/current"],
    enabled: !!user,
  });

  // Only show if super-admin AND current org !== their home org (assume home org = 1 for WCL admin)
  // Simpler check: super admin viewing non-WCL org
  if (!user?.superAdmin || !org) return null;
  if (org.id === 1) return null;

  async function exitImpersonation() {
    try {
      await apiRequest("POST", "/api/super-admin/stop-impersonating");
      await queryClient.invalidateQueries();
      window.location.hash = "#/super-admin";
      window.location.reload();
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div className="bg-amber-500 text-white px-4 py-2 flex items-center justify-between text-sm shadow">
      <div>
        <strong>Impersonating:</strong> {org.name}
      </div>
      <Button variant="ghost" size="sm" className="text-white hover:bg-amber-600"
        onClick={exitImpersonation} data-testid="button-exit-impersonation">
        <X className="w-3 h-3 mr-1" /> Exit
      </Button>
    </div>
  );
}
