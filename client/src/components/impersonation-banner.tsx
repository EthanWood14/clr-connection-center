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

  // Show when the session says we're impersonating. Fall back to org.id !== 1
  // for legacy sessions that lack the isImpersonating flag.
  const impersonating = user?.isImpersonating || (!!user?.superAdmin && !!org && org.id !== 1);
  if (!user?.superAdmin || !org || !impersonating) return null;

  async function exitImpersonation() {
    try {
      await apiRequest("POST", "/api/super-admin/exit-impersonate");
      await queryClient.invalidateQueries();
      window.location.hash = "#/";
      window.location.reload();
    } catch (e) {
      console.error(e);
    }
  }

  const displayName = user?.impersonatingOrgName || org.name;

  return (
    <div className="w-full bg-amber-500 text-white px-4 py-2 flex items-center gap-3 text-sm shadow">
      <div className="flex-1 min-w-0 truncate">
        <strong>Impersonating:</strong> {displayName}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="flex-shrink-0 text-white hover:bg-amber-600 whitespace-nowrap"
        onClick={exitImpersonation}
        data-testid="button-exit-impersonation"
      >
        <X className="w-3 h-3 mr-1" /> Exit
      </Button>
    </div>
  );
}
