import { useEffect, useMemo, useRef, useState } from "react";
import type { RankRow } from "@shared/tv-overtake";
import { raceGrid, type RaceDriver } from "@shared/tv-race-grid";
import { planRaceTransition, raceTransitionStartRank } from "@shared/tv-race-transition";
import { formatTransferCount } from "@shared/transfer-credit";
import { raceBroadcastShot, raceFocusCaption } from "@shared/tv-race-camera";
import { DAY_RACE_SECONDS_PER_HOUR, dayRaceRunSeconds, type DayRaceFrame } from "@shared/tv-day-race";

let sceneImport: Promise<typeof import("./race-scene")> | undefined;
/**
 * How long a transfer's race holds the wall. Eighteen seconds, not twelve:
 * the same flight walked more slowly reads as a broadcast rather than a
 * rush past the cars (owner, 16 Sep 2026: "I want it smooth and longer").
 * tv.tsx holds the moment for RACE_MOMENT_MS, which is this plus a beat.
 */
export const RACE_SCENE_SECONDS = 18;
export const RACE_MOMENT_MS = (RACE_SCENE_SECONDS + .6) * 1000;

/** What mountRaceScene hands back: tear it down, or move it on in place. */
type RaceSceneHandle = (() => void) & { update: (next: RaceDriver[]) => boolean };

export function preloadFieldRace() {
  return sceneImport ??= import("./race-scene").catch(error=>{sceneImport=undefined;throw error;});
}

export function FieldRace({ people, before = null, who, focusId: requestedFocusId, reduced, preview = false, dayFrames = null }: {
  people: RankRow[];
  before?: RankRow[] | null;
  who: string;
  focusId?: number;
  reduced: boolean;
  preview?: boolean;
  /**
   * Play-button day replay: cumulative standings after each non-empty hour.
   * The scene mounts on the first frame (from a zeroed before) and advances
   * in place every DAY_RACE_SECONDS_PER_HOUR — no black flash between hours.
   */
  dayFrames?: DayRaceFrame[] | null;
}) {
  const host=useRef<HTMLDivElement>(null);
  const scene=useRef<RaceSceneHandle|null>(null);
  const [status,setStatus]=useState<"loading"|"ready"|"unavailable">("loading");
  const [elapsed,setElapsed]=useState(0);
  const [shot,setShot]=useState(()=>raceBroadcastShot(0,reduced));
  const [livePeople,setLivePeople]=useState(people);
  const isDayRace=!!dayFrames?.length;
  const startPeople=isDayRace?dayFrames![0].people:people;
  const startBefore=isDayRace?(before??dayFrames![0].people.map(p=>({...p,transfersToday:0}))):before;
  const runSeconds=isDayRace?dayRaceRunSeconds(dayFrames!.length):RACE_SCENE_SECONDS;
  const drivers=useMemo(()=>raceGrid(livePeople),[livePeople]);
  const matching=drivers.filter(p=>p.name===who);
  const focusId=requestedFocusId??(matching.length===1?matching[0].id:undefined);
  const maneuvers=useMemo(()=>planRaceTransition(startBefore,livePeople,focusId),[startBefore,livePeople,focusId]);
  const maneuver=maneuvers.find(p=>p.id===focusId);
  const focus=drivers.find(p=>p.id===focusId);
  // Transition baselines already apply score corrections. Raw old totals can
  // otherwise claim a gained place that was not earned by this transfer.
  const priorRank=raceTransitionStartRank(maneuver,maneuvers);
  const caption=raceFocusCaption(maneuver,maneuvers,elapsed);
  const rivalIds=maneuver?.passedIds.length?maneuver.passedIds:maneuver?.tieIds??[];
  const rivalNames=drivers.filter(p=>rivalIds.includes(p.id)).map(p=>p.name);
  const rivalSummary=rivalNames.slice(0,2).join(' · ')+(rivalNames.length>2?` · +${rivalNames.length-2} more`:'');
  useEffect(()=>{
    let cancelled=false,cleanup:(()=>void)|undefined;
    setStatus("loading");
    setElapsed(0);
    setLivePeople(startPeople);
    setShot(raceBroadcastShot(0,reduced));
    scene.current=null;
    void preloadFieldRace().then(({mountRaceScene})=>{
      if(cancelled||!host.current)return;
      try {
        cleanup=mountRaceScene(host.current,{drivers:raceGrid(startPeople),before:startBefore,reduced,focusId,runSeconds,cameraSeconds:Math.min(runSeconds,RACE_SCENE_SECONDS),onProgress:time=>{if(!cancelled)setElapsed(time);},onShot:next=>{if(!cancelled)setShot(next);},onFailure:()=>{if(!cancelled)setStatus("unavailable");}});
        scene.current=cleanup as RaceSceneHandle;
        setStatus("ready");
      }catch{if(!cancelled)setStatus("unavailable");}
    }).catch(()=>{if(!cancelled)setStatus("unavailable");});
    return()=>{cancelled=true;scene.current=null;cleanup?.();};
    // Day-race frames advance via update() below; remounting on each hour
    // would flash the wall black. Transfer moments still remount per key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[isDayRace?`day:${dayFrames!.length}`:`live:${startPeople.map(p=>`${p.id}:${p.transfersToday}`).join("|")}`,reduced,focusId,runSeconds]);

  // Walk remaining hours in place: eight seconds each, skip already applied.
  useEffect(()=>{
    if(!isDayRace||!dayFrames||dayFrames.length<2)return;
    const timers=dayFrames.slice(1).map((frame,index)=>window.setTimeout(()=>{
      const next=raceGrid(frame.people);
      if(scene.current?.update(next)===false)return;
      setLivePeople(frame.people);
    },(index+1)*DAY_RACE_SECONDS_PER_HOUR*1000));
    return()=>{timers.forEach(clearTimeout);};
  },[isDayRace,dayFrames]);

  const leader=drivers[0];
  const hourLabel=isDayRace&&dayFrames?(()=>{
    const idx=Math.min(dayFrames.length-1,Math.max(0,Math.floor(elapsed/DAY_RACE_SECONDS_PER_HOUR)));
    const hour=dayFrames[idx]?.hour;
    if(hour==null)return `Hour ${idx+1} of ${dayFrames.length}`;
    const suffix=hour%12===0?12:hour%12;
    const ampm=hour<12?'AM':'PM';
    return `Through ${suffix} ${ampm}`;
  })():null;
  return <section className="absolute inset-0 z-30 overflow-hidden bg-[#111e29] text-white" data-testid="tv-field-race" data-scene-status={status} data-broadcast-shot={shot.id} data-day-race={isDayRace?"1":"0"}>
    <div ref={host} className="absolute inset-y-0 left-0 right-[20%] overflow-hidden" style={{background:"linear-gradient(160deg,#617886,#183338 65%,#0f202c)"}} />
    {status!=="ready"&&<div className="absolute inset-y-0 left-0 right-[20%] flex items-center justify-center"><div className="text-center"><p className="text-xs uppercase tracking-[.5em] text-cyan-200">C3 Grand Prix</p><p className="mt-3 text-3xl font-black italic">{status==='loading'?'TAKING YOU TRACKSIDE':'TODAY’S RUNNING ORDER'}</p><p className="mt-3 text-sm text-white/60">{status==='unavailable'?'3D is unavailable on this display. Live standings remain visible.':'Live team standings · Every transfer counts'}</p></div></div>}
    <div className="pointer-events-none absolute inset-0" style={{background:"linear-gradient(180deg,rgba(3,10,18,.72),transparent 20%,transparent 76%,rgba(3,10,18,.85))"}}/>
    <header className="pointer-events-none absolute left-[2.5%] top-[3.5%] right-[23%]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3"><span className={`${preview?'bg-cyan-700':'bg-red-600'} px-2.5 py-1 text-[10px] font-black uppercase tracking-[.2em]`}>{preview?(isDayRace?'Day race':'Preview'):'Live'}</span><h2 className="text-[clamp(16px,1.7vw,30px)] font-black italic uppercase tracking-tight">C3 Grand Prix</h2></div>
        <div className="border-l-2 border-cyan-300 bg-[#08131f]/80 px-3 py-1.5 text-right"><p className="text-[9px] font-semibold uppercase tracking-[.22em] text-white/50">Race coverage</p><p className="mt-0.5 text-[clamp(10px,1vw,17px)] font-bold uppercase tracking-wider text-cyan-100" data-testid="tv-race-shot-label">{isDayRace && hourLabel ? hourLabel : shot.label}</p></div>
      </div>
      {preview&&<p className="mt-2 text-[11px] font-semibold text-cyan-100/80">{isDayRace?`Today’s race · ${DAY_RACE_SECONDS_PER_HOUR}s per hour · Empty hours skipped`:'Current standings · No stats changed'}</p>}
    </header>
    <aside className="absolute right-0 inset-y-0 flex w-[20%] flex-col border-l border-white/15 bg-[#08131f]/95 px-[1.2%] py-[3%]">
      <div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-black uppercase tracking-[.15em]">Running order</h3><span className="rounded-sm border border-white/25 px-1.5 py-0.5 text-[10px] text-white/60">TODAY</span></div>
      {!preview&&<p className="mb-2 text-[9px] uppercase tracking-widest text-cyan-200/80">After this transfer</p>}
      <div className="mb-2 flex justify-end gap-5 text-[9px] uppercase tracking-widest text-white/45"><span>Transfers</span><span>Gap</span></div>
      <div className="flex min-h-0 flex-1 flex-col justify-evenly gap-0.5">{drivers.map((p,i)=><div key={p.id} className={`flex min-h-0 items-center gap-2 border-b border-white/[.07] py-1 ${p.id===focusId?'bg-cyan-300/15 ring-1 ring-cyan-200/40':''}`} style={{fontSize:drivers.length>20?'clamp(10px,1vw,17px)':'clamp(12px,1.15vw,21px)'}}>
        <span className="w-5 font-black italic tabular-nums" style={{color:i===0?'#f8d581':'#89949d'}}>{p.rank}</span><span className="h-5 w-[3px] shrink-0" style={{background:p.color}}/><span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span><strong className="tabular-nums">{formatTransferCount(p.transfersToday)}</strong><span className="w-10 text-right text-[.75em] tabular-nums" style={{color:p.gap===0?'#f8d581':'#8597a5'}}>{p.gap===0?'LEAD':`+${formatTransferCount(p.gap)}`}</span>
      </div>)}</div>
      <p className="mt-4 text-[10px] leading-relaxed text-white/40">Gaps are transfers behind first.<br/>Equal totals share a position.</p>
    </aside>
    {!preview&&focus?<div className="pointer-events-none absolute bottom-[4%] left-[2.5%] right-[23%] flex items-end justify-between gap-4">
      <div className="min-w-0 border-l-[3px] border-cyan-300 bg-gradient-to-r from-[#071320]/95 to-[#071320]/60 px-4 py-3 shadow-xl"><div className="flex flex-wrap items-center gap-x-4 gap-y-1"><p className="text-[clamp(10px,1vw,17px)] font-black uppercase tracking-[.16em] text-cyan-200" data-testid="tv-race-action-caption">{caption}</p>{priorRank!==undefined&&maneuver?.scored&&<span className="text-[clamp(10px,1vw,17px)] font-bold tabular-nums text-white/80">P{priorRank} → P{focus.rank}</span>}</div><p className="mt-1 text-[clamp(22px,2.4vw,42px)] font-black italic leading-tight">{focus.name}</p><p className="mt-1 line-clamp-2 text-[clamp(10px,1vw,15px)] text-white/65">{maneuver?.passedIds.length?`In the battle · ${rivalSummary}`:maneuver?.tieIds.length?`Drawing level with ${rivalSummary}`:'Every transfer moves the race forward'}</p></div>
      <div className="shrink-0 border-t-2 border-cyan-300 bg-[#071320]/90 px-4 py-3 text-right"><p className="text-[clamp(25px,3vw,48px)] font-black leading-none tabular-nums">{formatTransferCount(focus.transfersToday)}</p><p className="mt-2 text-[9px] uppercase tracking-[.2em] text-white/55">Transfers today</p></div>
    </div>:leader&&<div className="absolute bottom-[4%] left-[2.5%] right-[23%] flex items-end justify-between gap-6">
      <div className="flex items-center gap-4"><span className="text-6xl font-black italic text-[#f4d084]">P1</span><div><p className="text-[10px] uppercase tracking-[.3em] text-white/55">{drivers.filter(p=>p.rank===1).length>1?'Tied for the lead':'Setting the pace'}</p><p className="mt-1 text-2xl font-bold tracking-tight">{leader.name}</p></div></div>
      <div className="text-right"><p className="text-4xl font-black tabular-nums">{formatTransferCount(leader.transfersToday)}</p><p className="mt-1 text-[9px] uppercase tracking-[.3em] text-white/55">Transfers today</p></div>
    </div>}
  </section>;
}
