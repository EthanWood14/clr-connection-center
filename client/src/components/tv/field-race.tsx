import { useEffect, useState } from "react";
import type { RankRow } from "@shared/tv-overtake";
import { fieldStandings, cornerPosition } from "@shared/tv-field-race";
import { formatTransferCount } from "@shared/transfer-credit";

/** Projected trackside scene; the pack advances together without inventing passes. */
export function FieldRace({ people, who, reduced, preview = false }: { people: RankRow[]; who: string; reduced: boolean; preview?: boolean }) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (reduced) return;
    let frame = 0, start = 0, last = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      if (now-last>32) { setProgress(Math.min(1,(now-start)/11000)); last=now; }
      if (now-start<11000) frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced]);
  const ranked = fieldStandings(people);
  const maxGap = Math.max(2,...ranked.map(p=>p.gap));
  const cars = ranked.map(p=>{
    const ties=ranked.filter(r=>r.gap===p.gap);
    const lane=ties.length>1 ? (ties.findIndex(r=>r.id===p.id)-(ties.length-1)/2)*Math.min(76,140/ties.length) : ((p.rank%3)-1)*60;
    return {...p,...cornerPosition(.06+.5*(1-p.gap/maxGap)+progress*.29,lane)};
  }).sort((a,b)=>a.y-b.y);
  return <section className="absolute inset-0 z-30 overflow-hidden bg-[#07101e] text-white" data-testid="tv-field-race">
    <style>{`
      @keyframes fan-wave { to { transform:rotate(18deg); } }
      .race-fan { animation:fan-wave .6s ease-in-out infinite alternate; transform-box:fill-box; transform-origin:bottom; }
      @media(prefers-reduced-motion:reduce){ .race-fan { animation:none; } }
    `}</style>
    <svg className="absolute inset-0 h-full w-[79%]" viewBox="0 0 1100 760" preserveAspectRatio="xMidYMid slice" aria-label="The team racing out of a sweeping corner from the grandstand">
      <defs>
        <linearGradient id="race-sky" x2="0" y2="1"><stop stopColor="#293e64"/><stop offset="1" stopColor="#e69864"/></linearGradient>
        <linearGradient id="race-road" x2="0" y2="1"><stop stopColor="#3d4552"/><stop offset="1" stopColor="#131a25"/></linearGradient>
        <linearGradient id="race-glass" x2="0" y2="1"><stop stopColor="#b9edff"/><stop offset="1" stopColor="#14243c"/></linearGradient>
        <pattern id="race-crowd" width="19" height="17" patternUnits="userSpaceOnUse"><circle cx="7" cy="6" r="3" fill="#dcbcad"/><path d="M3 16V10H11V16" fill="#479ba8"/><circle cx="17" cy="12" r="2" fill="#f1c459"/></pattern>
      </defs>
      <rect width="1100" height="760" fill="url(#race-sky)"/>
      <path d="M0 140L150 90 220 130 340 60 500 135 610 80 790 145 1100 90V350H0Z" fill="#182a36" opacity=".7"/>
      <path d="M0 165L1100 195V300L0 235Z" fill="#172332"/>
      <path d="M0 170L1100 200V280L0 220Z" fill="url(#race-crowd)"/>
      {[0,1,2,3].map(i=><path key={i} d={`M0 ${182+i*16}L1100 ${213+i*16}`} stroke="#647480" strokeWidth="3"/>)}
      <path d="M0 152L1100 181" stroke="#111b2a" strokeWidth="12"/>
      <rect y="285" width="1100" height="475" fill="#294635"/>
      <g transform={`translate(${-progress*22} ${-progress*10}) scale(${1+progress*.045})`}>
        <path d="M-300 245H90Q545 245 1000 595L1400 903" fill="none" stroke="#d9ded9" strokeWidth="231"/>
        <path d="M-300 245H90Q545 245 1000 595L1400 903" fill="none" stroke="#d64746" strokeWidth="224" strokeDasharray="28 27"/>
        <path d="M-300 245H90Q545 245 1000 595L1400 903" fill="none" stroke="url(#race-road)" strokeWidth="194"/>
        <path d="M-300 245H90Q545 245 1000 595L1400 903" fill="none" stroke="#c0c7cf" strokeWidth="2" strokeDasharray="35 34" opacity=".35"/>
        {cars.map(p=><g key={p.id} transform={`translate(${p.x} ${p.y})`}>
          <g transform={`rotate(${p.angle}) scale(${p.scale*.8})`}>
            <path d="M-95 3H-42M-78 13H-45" stroke={p.color} strokeWidth="3" opacity=".5"/>
            <ellipse cy="16" rx="52" ry="19" fill="#000" opacity=".5"/>
            {[-29,29].map(x=><g key={x}><rect x={x-9} y="-24" width="18" height="14" rx="4" fill="#060b12"/><rect x={x-9} y="12" width="18" height="15" rx="4" fill="#060b12"/><path d={`M${x-5} 18h10`} stroke="#85929c" strokeWidth="2"/></g>)}
            <path d="M-48 9L-42-10 27-12 53 0 51 16-37 23Z" fill={p.color} stroke="#e3f3ff" strokeWidth="1.5"/>
            <path d="M-37 23L51 16 51 24-37 30Z" fill="#101b29"/>
            <path d="M-17-10L-7-24 16-24 31-9 16 4-15 4Z" fill="url(#race-glass)" stroke={p.color} strokeWidth="3"/>
            <path d="M-44-18V19M-49-18H-36" stroke="#101723" strokeWidth="6"/>
            <path d="M42-7L48-4M44 9L51 8" stroke="#fff3bd" strokeWidth="4"/>
            <text x="-25" y="15" fill="#07101b" fontSize="14" fontWeight="900">{p.rank}</text>
          </g>
          <g transform={`translate(0 ${-39*p.scale})`}>
            <rect x="-61" y="-22" width="122" height="27" rx="5" fill="#07101eee" stroke={p.color}/>
            <text textAnchor="middle" y="-4" fill="white" fontSize="13" fontWeight="800">{p.name.split(' ')[0]} · {formatTransferCount(p.transfersToday)}</text>
          </g>
        </g>)}
      </g>
      <path d="M-40 485Q450 380 1140 775" fill="none" stroke="#182333" strokeWidth="25"/>
      <path d="M-40 478Q450 373 1140 768" fill="none" stroke="#d4dce2" strokeWidth="8"/>
      {[30,160,305,470,660,855].map((x,i)=><g key={x} transform={`translate(${x} ${575+i*i*4})`} fill="#060c17">
        <circle cy="-10" r="21"/><path d="M-30 75L-27 18Q0 0 28 20L36 95Z"/>
        <g className={reduced?'':'race-fan'} style={{animationDelay:`${-i*.17}s`}}><path d="M-20 35L-50-20-43-28-8 18M19 28L45-30 53-23 31 48" stroke="#060c17" strokeWidth="13" fill="none"/>
        {i%2===0&&<><path d="M48-25V-95" stroke="#c6d0dc" strokeWidth="3"/><path d="M49-96L104-80 49-59Z" fill={i%4===0?'#f7c948':'#39d7dd'}/></>}</g>
      </g>)}
    </svg>
    <header className="absolute left-8 top-6 z-20 max-w-[70%]">
      <p className="text-xs font-bold uppercase tracking-[.4em] text-cyan-200">C3 Grand Prix · Grandstand cam</p>
      <h2 className="mt-2 text-4xl font-black italic tracking-tight drop-shadow-lg">{preview ? "OUT OF THE CORNER!" : `${who.toUpperCase()} ON THE CHARGE!`}</h2>
      <p className="mt-2 text-sm text-white/80">Today's transfers set the running order · Ties run together</p>
    </header>
    <aside className="absolute right-5 bottom-6 top-6 flex w-[23%] flex-col rounded-xl border border-white/20 bg-[#07101e]/95 p-4 shadow-2xl">
      <h3 className="text-lg font-black italic uppercase">Live race order</h3><p className="mb-3 mt-1 text-xs text-slate-400">TRANSFERS / GAP TO FIRST</p>
      <div className="flex min-h-0 flex-1 flex-col justify-evenly gap-1">{ranked.map(p=><div key={p.id} className="flex min-h-0 items-center gap-2 border-b border-white/10 py-1 text-sm">
        <strong className="w-5 text-lg" style={{color:p.color}}>{p.rank}</strong><span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span><strong>{formatTransferCount(p.transfersToday)}</strong><span className="w-12 text-right text-xs text-cyan-200">{p.gap===0?'LEAD':`−${formatTransferCount(p.gap)}`}</span>
      </div>)}</div>
      <p className="mt-3 text-xs text-slate-400">Real standings. No simulated passes.</p>
    </aside>
  </section>;
}
