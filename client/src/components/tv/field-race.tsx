import type { RankRow } from "@shared/tv-overtake";
import { fieldStandings } from "@shared/tv-field-race";
import { formatTransferCount } from "@shared/transfer-credit";

/** One CSS-3D circuit. Positions represent real totals, never invented overtakes. */
export function FieldRace({ people, who, reduced, preview = false }: { people: RankRow[]; who: string; reduced: boolean; preview?: boolean }) {
  const ranked = fieldStandings(people);
  const lanes = Math.max(5, ...ranked.map(p=>ranked.filter(r=>r.gap===p.gap).length));
  return <section className="absolute inset-0 z-30 overflow-hidden bg-[#070c16] text-white" data-testid="tv-field-race">
    <style>{`
      @keyframes circuit-flow { to { background-position: 0 180px; } }
      @keyframes circuit-camera { from { transform: rotateX(49deg) rotateZ(-3deg) translateY(-2%); } to { transform: rotateX(44deg) rotateZ(2deg) translateY(2%); } }
      @keyframes circuit-suspension { to { transform: translateZ(3px); } }
      .circuit-car,.circuit-car * { transform-style: preserve-3d; }
      @media(prefers-reduced-motion:reduce){ .circuit-moving { animation:none!important; } }
    `}</style>
    <div className="absolute inset-0" style={{background:'radial-gradient(ellipse at 35% 15%,#153f65 0%,#090f1b 48%,#03060b 100%)'}} />
    <header className="absolute left-10 top-7 z-20 max-w-[65%]">
      <p className="text-sm font-bold uppercase tracking-[.45em] text-cyan-300">C3 Grand Prix · Live standings</p>
      <h2 className="mt-2 text-4xl font-black tracking-tight">{preview ? "THE RACE IS ON" : `${who.toUpperCase()} MOVES THE FIELD`}</h2>
      <p className="mt-2 text-base text-slate-300">Cars ahead have more transfers. Side by side means tied.</p>
    </header>
    <div className="absolute bottom-0 left-0 top-[15%] w-[74%]" style={{perspective:'1000px',perspectiveOrigin:'50% 25%'}}>
      <div className="circuit-moving absolute inset-x-[8%] bottom-[-6%] top-[-5%]" style={{transformStyle:'preserve-3d',transform:'rotateX(46deg)',animation:reduced?'none':'circuit-camera 12s ease-in-out both'}}>
        <div className="absolute -inset-x-6 inset-y-0 bg-emerald-950" />
        <div className="circuit-moving absolute inset-0 border-x-[10px] border-cyan-200/70 shadow-[0_0_55px_#22d3ee40]" style={{backgroundColor:'#202b3b',backgroundImage:'repeating-linear-gradient(0deg,transparent 0px,transparent 87px,#ffffff12 88px,#ffffff12 90px)',animation:reduced?'none':'circuit-flow 1.4s linear infinite'}} />
        {Array.from({length:lanes-1},(_,i)=><div key={i} className="circuit-moving absolute inset-y-0 w-[2px]" style={{left:`${(i+1)*100/lanes}%`,background:'repeating-linear-gradient(0deg,#e2e8f080 0 35px,transparent 35px 90px)',animation:reduced?'none':'circuit-flow 1.4s linear infinite'}}/>)}
        <div className="absolute inset-x-0 top-[4%] h-4 opacity-70" style={{background:'repeating-conic-gradient(white 0% 25%,#111827 0% 50%) 0/20px 20px'}} />
        {ranked.map(p=><div key={p.id} className="circuit-car absolute" style={{left:`${(p.index%lanes+.5)*100/lanes}%`,top:`${p.depth}%`,width:`${Math.min(80,500/lanes)}px`,height:100,transform:'translateX(-50%) translateZ(5px)'}}>
          <div className="absolute -inset-2 rounded-full bg-black/60 blur-md" />
          <div className="circuit-moving absolute inset-0" style={{animation:reduced?'none':`circuit-suspension .3s ease-in-out ${-(p.index%3)/10}s infinite alternate`}}>
            {[8,65].flatMap(y=>[-8,88].map(x=><div key={`${x}-${y}`} className="absolute h-7 w-4 rounded bg-[#06080d] border border-slate-500" style={{left:`${x}%`,top:y,transform:'translateZ(7px)'}}/>))}
            <div className="absolute inset-0 rounded-[16px] border-2 border-white/40" style={{background:p.color,transform:'translateZ(12px)',boxShadow:'0 7px 0 #0b1220,0 10px 12px #0009'}} />
            <div className="absolute inset-x-[18%] top-[30%] h-[38%] rounded-lg border border-cyan-100 bg-gradient-to-b from-slate-700 to-cyan-950" style={{transform:'translateZ(23px)'}} />
            <div className="absolute -inset-x-2 bottom-0 h-3 border border-white/50 bg-slate-800" style={{transform:'translateZ(24px)'}} />
            <div className="absolute inset-x-0 top-2 text-center text-lg font-black text-slate-950" style={{transform:'translateZ(15px)'}}>{p.rank}</div>
          </div>
          <div className="absolute -left-12 -right-12 -top-10 text-center" style={{transform:'rotateX(-46deg) translateZ(45px)',transformOrigin:'center bottom'}}>
            <span className="inline-block max-w-full truncate rounded-md border border-white/25 bg-slate-950/95 px-2 py-1 text-sm font-bold shadow-lg" style={{color:p.color}}>{p.name.split(' ')[0]} · {formatTransferCount(p.transfersToday)}</span>
          </div>
        </div>)}
      </div>
    </div>
    <aside className="absolute right-6 bottom-8 top-8 flex w-[25%] flex-col rounded-2xl border border-white/15 bg-slate-950/90 p-5 shadow-2xl">
      <h3 className="mb-2 text-xl font-black uppercase tracking-widest">Race order</h3>
      <div className="mb-3 flex justify-between text-xs uppercase tracking-widest text-slate-400"><span>Driver / transfers</span><span>Gap to lead</span></div>
      <div className="flex min-h-0 flex-1 flex-col justify-evenly gap-1">{ranked.map(p=><div key={p.id} className="flex min-h-0 items-center gap-2 border-b border-white/10 py-1 text-sm">
        <strong className="w-6 text-lg" style={{color:p.color}}>{p.rank}</strong><span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span><strong>{formatTransferCount(p.transfersToday)}</strong><span className="w-16 text-right text-xs text-cyan-200">{p.gap===0?'LEADER':`−${formatTransferCount(p.gap)}`}</span>
      </div>)}</div>
      <p className="mt-3 text-xs text-slate-400">Gaps measured in today's transfers. Ties share a position.</p>
    </aside>
  </section>;
}
