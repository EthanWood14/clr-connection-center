// Local-only visual QA. This file is not imported by the production app.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { AuthProvider, useAuth } from "../../client/src/lib/auth";
import { apiRequest, queryClient } from "../../client/src/lib/queryClient";
import { DailyReportGateActive } from "../../client/src/components/daily-report-gate";
import { EodLockGateActive } from "../../client/src/components/eod-lock-gate";
import { AssignedLoLeadAlert } from "../../client/src/components/assigned-lo-lead-alert";
import { ShotgunOfferAlert } from "../../client/src/components/shotgun-offer-alert";
import { LeadPopupDock } from "../../client/src/components/lead-popup-dock";
import "../../client/src/index.css";

function Harness() {
  const { user, refetchUser } = useAuth();
  const [blocked, setBlocked] = useState(false);
  const [page, setPage] = useState("Call list");
  const trigger = async (action: string) => {
    await apiRequest("POST", "/__fixture", { action });
    if (action === "switch-user") await refetchUser();
    await queryClient.invalidateQueries();
  };
  return <div className="min-h-screen bg-slate-100 p-8 text-slate-950">
    <h1 className="text-2xl font-bold">Lead alerts — local QA</h1>
    <p>Fictional records only. User {user?.id}. {page}.</p>
    <label className="mt-4 block">Work in progress <input className="block rounded border p-2" placeholder="Keep typing here" /></label>
    <div className="mt-4 flex max-w-3xl flex-wrap gap-2">
      {["new-lo", "burst", "shotgun", "expire", "fail-confirm", "switch-user", "remove-assignment"].map(action => <button className="rounded border bg-white px-3 py-2" key={action} onClick={() => void trigger(action)}>{action}</button>)}
      <button className="rounded border bg-white px-3 py-2" onClick={() => setBlocked(value => !value)}>Toggle reporting gate</button>
      <button className="rounded border bg-white px-3 py-2" onClick={() => setPage(value => value === "Call list" ? "Other C3 page" : "Call list")}>Navigate locally</button>
    </div>
    {blocked && <p role="alert" className="mt-4">Reporting gate active</p>}
    <DailyReportGateActive.Provider value={blocked}><EodLockGateActive.Provider value={false}>
      {user && <LeadPopupDock key={`${user.orgId}:${user.id}`}><ShotgunOfferAlert /><AssignedLoLeadAlert /></LeadPopupDock>}
    </EodLockGateActive.Provider></DailyReportGateActive.Provider>
  </div>;
}

createRoot(document.getElementById("root")!).render(<QueryClientProvider client={queryClient}><AuthProvider><Router hook={useHashLocation}><Harness /></Router></AuthProvider></QueryClientProvider>);
