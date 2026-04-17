import { useState } from "react";
import { Bell } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { formatDistanceToNow } from "date-fns";

const CURRENT_USER_ID = 1;

// Map notification type → the route to navigate to when clicked
const typeRoutes: Record<string, string> = {
  assignment_ready: "/assignments",
  license_alert: "/directory",
  eod_reminder: "/assignments",
  follow_up: "/outcomes",
  announcement: "/",
};

const typeColors: Record<string, string> = {
  assignment_ready: "bg-primary/10 text-primary",
  license_alert: "bg-destructive/10 text-destructive",
  eod_reminder: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400",
  follow_up: "bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400",
  announcement: "bg-purple-100 text-purple-800 dark:bg-purple-900/20 dark:text-purple-400",
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();

  const { data: notifications = [] } = useQuery<any[]>({
    queryKey: [`/api/notifications?userId=${CURRENT_USER_ID}`],
  });

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: [`/api/notifications/unread-count?userId=${CURRENT_USER_ID}`],
    refetchInterval: 30000,
  });

  const markRead = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/notifications/${id}/read`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/notifications?userId=${CURRENT_USER_ID}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/notifications/unread-count?userId=${CURRENT_USER_ID}`] });
    },
  });

  function handleNotificationClick(n: any) {
    // Mark as read (always, even if already read — idempotent on backend)
    if (!n.isRead) {
      markRead.mutate(n.id);
    }
    // Navigate to the relevant page
    const route = typeRoutes[n.type] ?? "/";
    navigate(route);
    setOpen(false);
  }

  const markAllRead = useMutation({
    mutationFn: () => apiRequest("POST", "/api/notifications/mark-all-read", { userId: CURRENT_USER_ID }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/notifications?userId=${CURRENT_USER_ID}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/notifications/unread-count?userId=${CURRENT_USER_ID}`] });
    },
  });

  const unreadCount = unreadData?.count ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" data-testid="button-notifications">
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <Badge className="absolute -top-1 -right-1 h-5 w-5 p-0 flex items-center justify-center text-xs bg-destructive text-destructive-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="flex items-center justify-between p-4 pb-2">
          <h3 className="font-semibold text-sm">Notifications</h3>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => markAllRead.mutate()}>
              Mark all read
            </Button>
          )}
        </div>
        <Separator />
        <ScrollArea className="h-80">
          {notifications.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No notifications yet
            </div>
          ) : (
            notifications.slice(0, 20).map((n: any) => (
              <div
                key={n.id}
                className={`px-4 py-3 border-b last:border-0 cursor-pointer hover:bg-muted/50 transition-colors ${!n.isRead ? "bg-primary/5" : ""}`}
                onClick={() => handleNotificationClick(n)}
                data-testid={`notification-${n.id}`}
              >
                <div className="flex items-start gap-2">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${typeColors[n.type] || "bg-muted text-muted-foreground"}`}>
                    {n.type.replace(/_/g, " ")}
                  </span>
                  {!n.isRead && <div className="w-2 h-2 rounded-full bg-primary mt-1 ml-auto flex-shrink-0" />}
                </div>
                <p className="text-sm font-medium mt-1">{n.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                </p>
              </div>
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
