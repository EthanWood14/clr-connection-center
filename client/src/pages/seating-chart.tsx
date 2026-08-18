/**
 * Seating Map — the office seating chart, shown inside C3.
 *
 * The chart is a separate app on its own domain, so it is embedded rather than
 * rebuilt: it stays the single source of truth and keeps deploying on its own,
 * but looking at it no longer throws you out of C3 and back through login.
 *
 * Framing is safe here because that app sends no X-Frame-Options or
 * frame-ancestors (checked before building this). If it ever starts sending
 * them the frame goes blank, which is why "Open in new tab" is always on screen
 * rather than hidden behind an error state.
 */
import { useState } from "react";
import { Armchair, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const SEATING_CHART_URL = "https://seating-chart-production-1287.up.railway.app";

export default function SeatingChart() {
  const [loaded, setLoaded] = useState(false);
  // Bumped to force the iframe to remount — an iframe ignores a src it already
  // has, so reloading needs a new key rather than a new src.
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto flex flex-col gap-3 h-[calc(100vh-1rem)]">
      <div className="flex items-center justify-between gap-3 flex-wrap shrink-0">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Armchair className="w-5 h-5 text-primary" /> Seating Map
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Who sits where in the office.</p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => { setLoaded(false); setReloadKey((k) => k + 1); }}
            data-testid="seating-reload"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Reload
          </Button>
          {/* Always available, not just on failure: the frame can go blank for
              reasons this page cannot detect from the outside. */}
          <Button size="sm" variant="ghost" className="gap-1.5" asChild>
            <a href={SEATING_CHART_URL} target="_blank" rel="noopener noreferrer" data-testid="seating-open-new-tab">
              <ExternalLink className="w-3.5 h-3.5" /> Open in new tab
            </a>
          </Button>
        </div>
      </div>

      <div className="relative flex-1 min-h-[28rem] rounded-xl border overflow-hidden bg-muted/20">
        {!loaded && (
          <div className="absolute inset-0 p-4 space-y-3" aria-hidden="true">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-[calc(100%-3rem)] w-full rounded-lg" />
          </div>
        )}
        <iframe
          key={reloadKey}
          src={SEATING_CHART_URL}
          title="Office seating map"
          onLoad={() => setLoaded(true)}
          className="w-full h-full border-0"
          // Enough to run the app and follow its own links, without granting it
          // top-level navigation — an embedded page should not be able to
          // redirect the whole tab away from C3.
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer-when-downgrade"
          data-testid="seating-iframe"
        />
      </div>

      <p className="text-[11px] text-muted-foreground shrink-0">
        Loaded from the seating chart app. If it doesn't appear, open it in a new tab.
      </p>
    </div>
  );
}
