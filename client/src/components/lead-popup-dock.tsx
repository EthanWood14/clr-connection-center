import type { ReactNode } from "react";
import { createPortal } from "react-dom";

/** Outside the glass panels' stacking contexts, but below blocking dialogs. */
export function LeadPopupDock({ children }: { children: ReactNode }) {
  return createPortal(
    <aside aria-label="Incoming lead alerts" data-testid="lead-popup-dock"
      className="pointer-events-none fixed bottom-20 left-3 z-[45] flex max-h-[calc(100dvh-7rem)] w-[calc(100vw-1.5rem)] max-w-sm flex-col gap-3 overflow-y-auto overscroll-contain sm:bottom-4 sm:left-4 sm:max-h-[calc(100dvh-2rem)]">
      {children}
    </aside>,
    document.body,
  );
}
