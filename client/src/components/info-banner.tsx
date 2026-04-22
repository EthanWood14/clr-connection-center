import { useState, useEffect } from "react";
import { Info, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Variant = "info" | "warning" | "success";

const STYLES: Record<Variant, { border: string; bg: string; title: string; body: string; icon: string; Icon: any }> = {
  info: {
    border: "border-blue-300 dark:border-blue-700",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    title: "text-blue-900 dark:text-blue-200",
    body: "text-blue-800 dark:text-blue-300",
    icon: "text-blue-600 dark:text-blue-400",
    Icon: Info,
  },
  warning: {
    border: "border-amber-300 dark:border-amber-700",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    title: "text-amber-900 dark:text-amber-200",
    body: "text-amber-800 dark:text-amber-300",
    icon: "text-amber-600 dark:text-amber-400",
    Icon: AlertTriangle,
  },
  success: {
    border: "border-green-300 dark:border-green-700",
    bg: "bg-green-50 dark:bg-green-950/30",
    title: "text-green-900 dark:text-green-200",
    body: "text-green-800 dark:text-green-300",
    icon: "text-green-600 dark:text-green-400",
    Icon: CheckCircle2,
  },
};

export function InfoBanner({
  storageKey,
  variant = "info",
  title,
  children,
}: {
  storageKey: string;
  variant?: Variant;
  title: string;
  children: React.ReactNode;
}) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(`banner_${storageKey}`) === "1") setHidden(true);
    } catch {}
  }, [storageKey]);

  if (hidden) return null;

  const s = STYLES[variant];
  const Icon = s.Icon;

  function dismiss() {
    try { sessionStorage.setItem(`banner_${storageKey}`, "1"); } catch {}
    setHidden(true);
  }

  return (
    <div className={`rounded-lg border ${s.border} ${s.bg} p-3 flex items-start gap-3 mb-4`}>
      <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${s.icon}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${s.title}`}>{title}</p>
        <div className={`text-xs ${s.body} mt-0.5 leading-relaxed`}>{children}</div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className={`h-7 w-7 shrink-0 ${s.title} hover:bg-black/5 dark:hover:bg-white/10`}
        onClick={dismiss}
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}
