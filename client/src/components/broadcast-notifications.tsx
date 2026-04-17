import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { formatDistanceToNow } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Megaphone, Send, Clock } from "lucide-react";

type NotificationType =
  | "announcement"
  | "eod_reminder"
  | "follow_up"
  | "assignment_ready"
  | "license_alert";

interface Notification {
  id: number;
  userId: number | null;
  type: NotificationType;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
}

const NOTIFICATION_TYPES: { value: NotificationType; label: string }[] = [
  { value: "announcement", label: "Announcement" },
  { value: "eod_reminder", label: "EOD Reminder" },
  { value: "follow_up", label: "Follow Up" },
  { value: "assignment_ready", label: "Assignment Ready" },
  { value: "license_alert", label: "License Alert" },
];

const typeColors: Record<NotificationType, string> = {
  announcement: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700",
  eod_reminder: "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-yellow-700",
  follow_up: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-700",
  assignment_ready: "bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-900/30 dark:text-teal-300 dark:border-teal-700",
  license_alert: "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/20 dark:text-red-400 dark:border-red-700",
};

const broadcastSchema = z.object({
  type: z.enum(["announcement", "eod_reminder", "follow_up", "assignment_ready", "license_alert"]),
  title: z.string().min(2, "Title must be at least 2 characters").max(120, "Title too long"),
  message: z.string().min(5, "Message must be at least 5 characters").max(500, "Message too long"),
  recipientId: z.string(), // "all" or stringified user ID
});

type BroadcastFormValues = z.infer<typeof broadcastSchema>;

export function BroadcastNotifications() {
  const { toast } = useToast();

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ["/api/users"],
  });

  const { data: notifications = [] } = useQuery<Notification[]>({
    queryKey: ["/api/notifications"],
  });

  const recentNotifications = notifications.slice(0, 5);

  const form = useForm<BroadcastFormValues>({
    resolver: zodResolver(broadcastSchema),
    defaultValues: {
      type: "announcement",
      title: "",
      message: "",
      recipientId: "all",
    },
  });

  const sendMutation = useMutation({
    mutationFn: (data: BroadcastFormValues) => {
      const userId = data.recipientId === "all" ? null : parseInt(data.recipientId, 10);
      return apiRequest("POST", "/api/notifications", {
        userId,
        type: data.type,
        title: data.title,
        message: data.message,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      toast({
        title: "Notification sent",
        description: "Your message has been delivered successfully.",
      });
      form.reset({
        type: "announcement",
        title: "",
        message: "",
        recipientId: "all",
      });
    },
    onError: (err: Error) =>
      toast({
        title: "Failed to send notification",
        description: err.message,
        variant: "destructive",
      }),
  });

  function onSubmit(values: BroadcastFormValues) {
    sendMutation.mutate(values);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Megaphone className="w-4 h-4" />
          Broadcast Notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Compose Form */}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Type */}
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notification Type</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-notification-type">
                          <SelectValue placeholder="Select type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {NOTIFICATION_TYPES.map(({ value, label }) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Recipient */}
              <FormField
                control={form.control}
                name="recipientId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Recipient</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-recipient">
                          <SelectValue placeholder="Select recipient" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="all">All Users</SelectItem>
                        {users.map((user) => (
                          <SelectItem key={user.id} value={String(user.id)}>
                            {user.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Title */}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Enter notification title…"
                      {...field}
                      data-testid="input-notification-title"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Message */}
            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Message</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Write your message here…"
                      className="resize-none min-h-[90px]"
                      {...field}
                      data-testid="textarea-notification-message"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end">
              <Button
                type="submit"
                disabled={sendMutation.isPending}
                data-testid="button-send-notification"
              >
                <Send className="w-4 h-4 mr-2" />
                {sendMutation.isPending ? "Sending…" : "Send Notification"}
              </Button>
            </div>
          </form>
        </Form>

        {/* Recent Notifications */}
        {recentNotifications.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Recently Sent
                </p>
              </div>
              <div className="space-y-2">
                {recentNotifications.map((n) => (
                  <div
                    key={n.id}
                    className="flex items-start gap-3 p-3 rounded-lg bg-muted/40 border border-border/50"
                    data-testid={`recent-notification-${n.id}`}
                  >
                    <Badge
                      variant="outline"
                      className={`text-xs font-medium flex-shrink-0 mt-0.5 ${typeColors[n.type as NotificationType] ?? "bg-muted text-muted-foreground"}`}
                    >
                      {n.type.replace(/_/g, " ")}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-tight truncate">{n.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground/60">
                          {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                        </span>
                        <span className="text-xs text-muted-foreground/40">·</span>
                        <span className="text-xs text-muted-foreground/60">
                          {n.userId === null
                            ? "All users"
                            : users.find((u) => u.id === n.userId)?.name ?? `User #${n.userId}`}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {recentNotifications.length === 0 && (
          <div className="py-4 text-center text-sm text-muted-foreground">
            No notifications sent yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
