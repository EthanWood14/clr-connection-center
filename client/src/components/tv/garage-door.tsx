import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Clock3, Loader2, LockKeyhole } from "lucide-react";
import "./garage-door.css";

/** Keep the editor mounted behind a modal shutter, preserving its current drafts. */
export function GarageDoor({ closed, boost, pending, error, hasUnsaved, onBoost }: {
  closed: boolean;
  boost?: { affordable: boolean; priceLabel: string };
  pending: boolean;
  error?: string;
  hasUnsaved: boolean;
  onBoost: () => void;
}) {
  const door = useRef<HTMLDialogElement>(null);
  const [, navigate] = useLocation();
  useEffect(() => {
    const dialog = door.current;
    if (!dialog) return;
    if (closed && !dialog.open) dialog.showModal();
    if (!closed && dialog.open) dialog.close();
    return () => { if (dialog.open) dialog.close(); };
  }, [closed]);
  return <dialog ref={door} className="garage-door" aria-labelledby="garage-closed-title" aria-describedby="garage-closed-description" onCancel={event => event.preventDefault()} data-testid="tv-car-locked">
    <div className="garage-door-shutter" aria-hidden="true"><div className="garage-door-windows"><i/><i/><i/></div><div className="garage-door-handle"/><div className="garage-door-bottom"/></div>
    <div className="garage-door-rail garage-door-rail-left" aria-hidden="true"/><div className="garage-door-rail garage-door-rail-right" aria-hidden="true"/>
    <div className="garage-door-content">
      <div className="garage-door-beacon" aria-hidden="true"/>
      <p className="garage-door-eyebrow">C3 CUSTOMS · END OF SHIFT</p>
      <div className="garage-door-sign">
        <LockKeyhole size={30} aria-hidden="true"/>
        <p className="garage-door-stamp">GARAGE CLOSED</p>
        <h2 id="garage-closed-title">That's a wrap for today.</h2>
        <p id="garage-closed-description">Your garage time is up. Your last saved car is still on the track. The doors reopen with your next daily allowance.</p>
        {hasUnsaved && <p className="garage-door-draft">Your unsaved edits are still here while this page stays open. Add time to keep working and save them.</p>}
        <div className="garage-door-actions">
          {boost && <button type="button" disabled={!boost.affordable || pending} onClick={onBoost} className="garage-door-boost" autoFocus>
            {pending ? <Loader2 size={17} className="animate-spin"/> : <Clock3 size={17}/>}
            {pending ? "Opening the garage…" : `Reopen for +5 min · ${boost.priceLabel}`}
          </button>}
          {boost && !boost.affordable && <small>Earn more CallTools time to buy a garage boost.</small>}
          {error && <p role="alert" className="garage-door-error">{error}</p>}
          <button type="button" onClick={() => navigate("/")} disabled={pending} className="garage-door-exit"><ArrowLeft size={16}/> Back to C3{hasUnsaved ? " (leave unsaved edits)" : ""}</button>
        </div>
      </div>
      <p className="garage-door-caption">TOOLS DOWN. ENGINE ON.</p>
    </div>
  </dialog>;
}
