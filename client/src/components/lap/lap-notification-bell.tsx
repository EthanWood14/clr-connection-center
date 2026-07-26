import { useMemo, useState } from "react";
import { Bell, Check, FileStack, MessageCircle, MessagesSquare, UserCheck } from "lucide-react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

const LAP_NOTIFICATION_ROUTES: Record<string, string> = {
  announcement: "/",
  chat: "/chat",
  forum: "/forum",
  schedule: "/my-schedule",
  checkin: "/check-ins",
  attendance_excuse: "/check-ins",
  lap_result: "/results",
  lap_results: "/results",
};

const notificationIcons: Record<string, typeof Bell> = {
  chat: MessageCircle,
  forum: MessagesSquare,
  checkin: UserCheck,
  attendance_excuse: UserCheck,
  lap_result: FileStack,
  lap_results: FileStack,
};

function relativeTime(value: unknown) {
  const date = new Date(String(value ?? ""));
  if (!Number.isFinite(date.getTime())) return "";
  const delta = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(delta / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function LapNotificationBell() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const uid = user?.id ?? 0;

  const { data = [] } = useQuery<any[]>({
    queryKey: [`/api/notifications?userId=${uid}`],
    enabled: uid > 0,
    refetchInterval: 30000,
  });

  const notifications = useMemo(
    () => data.filter((item) => Object.prototype.hasOwnProperty.call(LAP_NOTIFICATION_ROUTES, item.type)),
    [data],
  );
  const unreadCount = notifications.filter((item) => !item.isRead).length;

  const markRead = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/notifications/${id}/read`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/notifications?userId=${uid}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/notifications/unread-count?userId=${uid}`] });
    },
  });

  function openNotification(notification: any) {
    if (!notification.isRead) markRead.mutate(notification.id);
    navigate(LAP_NOTIFICATION_ROUTES[notification.type] ?? "/");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label="LAP notifications"
          data-testid="lap-notifications"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center bg-primary px-1 text-[10px] text-primary-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(23rem,calc(100vw-1.5rem))] p-0">
        <div className="px-4 py-3">
          <p className="text-sm font-semibold">LAP notifications</p>
          <p className="text-xs text-muted-foreground">Updates from your assistant workflow</p>
        </div>
        <Separator />
        <ScrollArea className="h-80">
          {notifications.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 px-5 text-center">
              <Check className="h-6 w-6 text-primary" />
              <p className="text-sm font-medium">You’re all caught up</p>
              <p className="text-xs text-muted-foreground">New result, attendance, and team updates will appear here.</p>
            </div>
          ) : (
            notifications.slice(0, 20).map((notification) => {
              const Icon = notificationIcons[notification.type] ?? Bell;
              return (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => openNotification(notification)}
                  className={`flex w-full gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-accent/60 ${
                    notification.isRead ? "" : "bg-primary/5"
                  }`}
                  data-testid={`lap-notification-${notification.id}`}
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{notification.title}</span>
                    <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{notification.message}</span>
                    <span className="mt-1 block text-[10px] uppercase tracking-wide text-muted-foreground/70">
                      {relativeTime(notification.createdAt)}
                    </span>
                  </span>
                  {!notification.isRead && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                </button>
              );
            })
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
