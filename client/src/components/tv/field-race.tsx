import { useEffect, useMemo, useRef, useState } from "react";
import type { RankRow } from "@shared/tv-overtake";
import { raceGrid } from "@shared/tv-race-grid";
import { planRaceTransition } from "@shared/tv-race-transition";
import { formatTransferCount } from "@shared/transfer-credit";
import { raceFocusCaption } from "@shared/tv-race-camera";

let sceneImport: Promise<typeof import("./race-scene")> | undefined;
export function preloadFieldRace() {
  return sceneImport ??= import("./race-scene").catch(error=>{sceneImport=undefined;throw error;});
}

export function FieldRace({ people, before = null, who, focusId: requestedFocusId, reduced, preview = false }: { people: RankRow[]; before?: RankRow[] | null; who: string; focusId?:number; reduced: boolean; preview?: boolean }) {
  const host=useRef<HTMLDivElement>(null);
  const [status,setStatus]=useState<"loading"|"ready"|"unavailable">("loading");
  const [elapsed,setElapsed]=useState(0);
  const drivers=useMemo(()=>raceGrid(people),[people]);
  const matching=drivers.filter(p=>p.name===who);
  const focusId=requestedFocusId??(matching.length===1?matching[0].id:undefined);
  const maneuvers=useMemo(()=>planRaceTransition(before,people,focusId),[before,people,focusId]);
  const maneuver=maneuvers.find(p=>p.id===focusId);
  const focus=drivers.find(p=>p.id===focusId);
  const priorFocus=before?.find(p=>p.id===focusId);
  const priorRank=priorFocus?1+before!.filter(p=>p.transfersToday>priorFocus.transfersToday).length:undefined;
  const caption=raceFocusCaption(maneuver,maneuvers,elapsed);
  useEffect(()=>{
    let cancelled=false,cleanup:(()=>void)|undefined;
    setStatus("loading");
    setElapsed(0);
    void preloadFieldRace().then(({mountRaceScene})=>{
      if(cancelled||!host.current)return;
      try {
        cleanup=mountRaceScene(host.current,{drivers,before,reduced,focusId,onProgress:time=>{if(!cancelled)setElapsed(time);},onFailure:()=>{if(!cancelled)setStatus("unavailable");}});
        setStatus("ready");
      }catch{if(!cancelled)setStatus("unavailable");}
    }).catch(()=>{if(!cancelled)setStatus("unavailable");});
    return()=>{cancelled=true;cleanup?.();};
  },[drivers,before,reduced,focusId]);
  const leader=drivers[0];
  return <section className="absolute inset-0 z-30 overflow-hidden bg-[#111e29] text-white" data-testid="tv-field-race" data-scene-status={status}>
    <div ref={host} className="absolute inset-y-0 left-0 right-[22%] overflow-hidden" style={{background:"linear-gradient(160deg,#617886,#183338 65%,#0f202c)"}} />
    {status!=="ready"&&<div className="absolute inset-y-0 left-0 right-[22%] flex items-center justify-center"><div className="text-center"><p className="text-xs uppercase tracking-[.5em] text-cyan-200">C3 Grand Prix</p><p className="mt-3 text-3xl font-black italic">{status==='loading'?'TAKING YOU TRACKSIDE':'TODAY’S RUNNING ORDER'}</p><p className="mt-3 text-sm text-white/60">{status==='unavailable'?'3D is unavailable on this display. Live standings remain visible.':'Live team standings · Every transfer counts'}</p></div></div>}
    <div className="pointer-events-none absolute inset-0" style={{background:"linear-gradient(180deg,rgba(3,10,18,.65),transparent 26%,transparent 70%,rgba(3,10,18,.78))"}}/>
    <header className="absolute left-[3%] top-[4%] right-[25%]">
      <div className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-[.25em]"><span className={`${preview?'bg-cyan-700':'bg-red-600'} px-2 py-1 tracking-widest`}>{preview?'Preview':'Live'}</span><span className="text-white/85">C3 Grand Prix</span><span className="h-3 w-px bg-white/40"/><span className="text-white/65">Turn 03 · Trackside</span></div>
      <h2 className="mt-3 text-[clamp(24px,3vw,52px)] font-black italic leading-none tracking-tight">{preview?'THE CHASE IS ON':maneuver?.passedIds.length?`${who.split(' ')[0].toUpperCase()} MAKES THE PASS`:maneuver?.tieIds.length?`${who.split(' ')[0].toUpperCase()} DRAWS LEVEL`:`${who.split(' ')[0].toUpperCase()} MOVES THE FIELD`}</h2>
      {preview&&<p className="mt-3 text-sm font-semibold text-cyan-100">Current standings · No stats changed</p>}
      {!preview&&focus&&<div className="mt-3 flex flex-wrap items-center gap-3 text-[clamp(12px,1.25vw,22px)] font-black uppercase tracking-wider"><span className="rounded-sm bg-cyan-300 px-3 py-1 text-slate-950">{caption}</span>{priorRank!==undefined&&maneuver?.scored&&<span className="rounded-sm bg-black/50 px-3 py-1 tabular-nums">P{priorRank} → P{focus.rank}</span>}</div>}
    </header>
    <aside className="absolute right-0 inset-y-0 flex w-[22%] flex-col border-l border-white/15 bg-[#08131f]/95 px-[1.4%] py-[3%]">
      <div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-black uppercase tracking-[.15em]">Running order</h3><span className="rounded-sm border border-white/25 px-1.5 py-0.5 text-[10px] text-white/60">TODAY</span></div>
      {!preview&&<p className="mb-2 text-[9px] uppercase tracking-widest text-cyan-200/80">After this transfer</p>}
      <div className="mb-2 flex justify-end gap-5 text-[9px] uppercase tracking-widest text-white/45"><span>Transfers</span><span>Gap</span></div>
      <div className="flex min-h-0 flex-1 flex-col justify-evenly gap-0.5">{drivers.map((p,i)=><div key={p.id} className={`flex min-h-0 items-center gap-2 border-b border-white/[.07] py-1 ${p.id===focusId?'bg-cyan-300/15 ring-1 ring-cyan-200/40':''}`} style={{fontSize:drivers.length>20?'clamp(10px,1vw,17px)':'clamp(12px,1.15vw,21px)'}}>
        <span className="w-5 font-black italic tabular-nums" style={{color:i===0?'#f8d581':'#89949d'}}>{p.rank}</span><span className="h-5 w-[3px] shrink-0" style={{background:p.color}}/><span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span><strong className="tabular-nums">{formatTransferCount(p.transfersToday)}</strong><span className="w-10 text-right text-[.75em] tabular-nums" style={{color:p.gap===0?'#f8d581':'#8597a5'}}>{p.gap===0?'LEAD':`+${formatTransferCount(p.gap)}`}</span>
      </div>)}</div>
      <p className="mt-4 text-[10px] leading-relaxed text-white/40">Gaps are transfers behind first.<br/>Equal totals share a position.</p>
    </aside>
    {!preview&&focus?<div className="absolute bottom-[5%] left-[3%] right-[25%] flex items-end justify-between gap-6">
      <div><p className="text-[10px] uppercase tracking-[.3em] text-cyan-200">Onboard focus</p><p className="mt-1 text-[clamp(24px,2.5vw,44px)] font-black italic">{focus.name}</p><p className="mt-1 text-sm text-white/70">{maneuver?.passedIds.length?`Passing ${drivers.filter(p=>maneuver.passedIds.includes(p.id)).map(p=>p.name).join(' · ')}`:maneuver?.tieIds.length?`Drawing level with ${drivers.filter(p=>maneuver.tieIds.includes(p.id)).map(p=>p.name).join(' · ')}`:'Every transfer moves the race forward'}</p></div>
      <div className="shrink-0 text-right"><p className="text-5xl font-black tabular-nums">{formatTransferCount(focus.transfersToday)}</p><p className="mt-1 text-[9px] uppercase tracking-[.3em] text-white/55">Transfers today</p></div>
    </div>:leader&&<div className="absolute bottom-[5%] left-[3%] right-[25%] flex items-end justify-between gap-6">
      <div className="flex items-center gap-4"><span className="text-6xl font-black italic text-[#f4d084]">P1</span><div><p className="text-[10px] uppercase tracking-[.3em] text-white/55">{drivers.filter(p=>p.rank===1).length>1?'Tied for the lead':'Setting the pace'}</p><p className="mt-1 text-2xl font-bold tracking-tight">{leader.name}</p></div></div>
      <div className="text-right"><p className="text-4xl font-black tabular-nums">{formatTransferCount(leader.transfersToday)}</p><p className="mt-1 text-[9px] uppercase tracking-[.3em] text-white/55">Transfers today</p></div>
    </div>}
  </section>;
}
