import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Bell, BellOff } from "lucide-react";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

type Status = "loading" | "unsupported" | "denied" | "disabled" | "enabled";

export function PushNotificationsCard() {
  const { toast } = useToast();
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setStatus(sub ? "enabled" : "disabled");
    } catch {
      setStatus("disabled");
    }
  }

  useEffect(() => { refresh(); }, []);

  async function enable() {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setStatus(perm === "denied" ? "denied" : "disabled");
        toast({ title: "Permission required", description: "Enable notifications in your browser to continue." });
        return;
      }
      const keyRes = await fetch("/api/push/vapid-public-key", { credentials: "include" });
      if (!keyRes.ok) throw new Error("VAPID key unavailable");
      const { publicKey } = await keyRes.json();
      const reg = await navigator.serviceWorker.ready;
      // Clear any stale subscription (e.g. from a previous VAPID key) before
      // subscribing again, otherwise pushManager.subscribe rejects with
      // InvalidStateError on browsers that already have one.
      const existing = await reg.pushManager.getSubscription();
      if (existing) { try { await existing.unsubscribe(); } catch {} }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await apiRequest("POST", "/api/push/subscribe", { subscription: sub.toJSON() });
      setStatus("enabled");
      toast({ title: "Notifications enabled", description: "You'll get push alerts on this device." });
    } catch (e: any) {
      toast({ title: "Failed to enable", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        try {
          await apiRequest("DELETE", "/api/push/unsubscribe", { endpoint: sub.endpoint });
        } catch {}
        await sub.unsubscribe();
      }
      setStatus("disabled");
      toast({ title: "Notifications disabled" });
    } catch (e: any) {
      toast({ title: "Failed to disable", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    try {
      await apiRequest("POST", "/api/push/send", {
        title: "Test notification",
        body: "Push is working on this device.",
        url: "/",
      });
      toast({ title: "Test sent" });
    } catch (e: any) {
      toast({ title: "Test failed", description: e?.message ?? "Unknown", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const statusText = {
    loading: "Checking…",
    unsupported: "Your browser doesn't support push notifications.",
    denied: "Permission denied by browser. Update site settings to allow notifications.",
    disabled: "Notifications disabled on this device.",
    enabled: "Notifications enabled on this device.",
  }[status];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {status === "enabled" ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
          Push Notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Get background alerts for reminders, forum activity, and announcements — even when the app is closed.
        </p>
        <div className="flex items-center justify-between">
          <div className="text-sm">{statusText}</div>
          <Switch
            checked={status === "enabled"}
            disabled={busy || status === "loading" || status === "unsupported" || status === "denied"}
            onCheckedChange={(v) => (v ? enable() : disable())}
            data-testid="push-notifications-toggle"
          />
        </div>
        {status === "enabled" && (
          <Button onClick={sendTest} size="sm" variant="outline" disabled={busy}>
            Send test notification
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
