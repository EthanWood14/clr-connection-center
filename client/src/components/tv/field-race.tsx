import type { RankRow } from "@shared/tv-overtake";
import { formatTransferCount } from "@shared/transfer-credit";

/** A full-field celebration: every lane moves, nobody drops off the board. */
export function FieldRace({ people, who, reduced, preview = false }: { people: RankRow[]; who: string; reduced: boolean; preview?: boolean }) {
  const ranked = [...people].sort((a, b) => b.transfersToday - a.transfersToday || a.name.localeCompare(b.name));
  const columns = Math.max(1, Math.ceil(ranked.length / 7));
  return <section className="absolute inset-0 z-30 flex flex-col bg-slate-950 p-8 text-white" data-testid="tv-field-race">
    <style>{`
      @keyframes field-drive { from { transform: translateX(-18%); } to { transform: translateX(18%); } }
      @keyframes field-road { to { background-position: -120px 0; } }
      @media (prefers-reduced-motion: reduce) { .field-moving { animation: none !important; } }
    `}</style>
    <header className="mb-5 text-center"><p className="text-xl font-bold uppercase tracking-[.3em] text-amber-300">The whole team is moving</p><h2 className="text-5xl font-black">{preview ? "Full-team race!" : `${who} logged a transfer!`}</h2><p className="mt-2 text-lg text-slate-300">Today's transfer standings · every CLR, every lane</p></header>
    <div className="grid min-h-0 flex-1 gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.ceil(ranked.length / columns) || 1}, minmax(0, 1fr))`, gridAutoFlow: "column" }}>
      {ranked.map((person, i) => <div key={person.id} className="relative min-h-0 overflow-hidden rounded-xl border border-slate-600 bg-slate-900 px-3 py-2">
        <div className="relative z-10 flex items-center justify-between gap-2 font-bold"><span className="truncate">{ranked.filter(p => p.transfersToday > person.transfersToday).length + 1}. {person.name}</span><span className="text-amber-300">{formatTransferCount(person.transfersToday)}</span></div>
        <div className="field-moving absolute inset-x-0 bottom-[12%] h-1" style={{ background: "repeating-linear-gradient(90deg,#cbd5e1 0 40px,transparent 40px 80px)", animation: reduced ? "none" : "field-road .8s linear infinite" }} />
        <div className="field-moving absolute inset-x-[12%] bottom-[7%] h-[60%]" style={{ animation: reduced ? "none" : `field-drive ${2.5 + (i % 4) * .3}s ease-in-out ${-(i % 4)}s infinite alternate` }}>
          <svg viewBox="0 0 210 78" className="h-full w-full" aria-hidden="true"><path d="M12 49 30 42 54 17 123 17 153 39 191 45 201 64 8 64Z" fill={`hsl(${i * 47 % 360} 85% 65%)`} stroke="#020617" strokeWidth="4"/><path d="M63 22 91 22 91 39 47 39Z M98 22 120 22 142 39 98 39Z" fill="#e0f2fe"/><circle cx="47" cy="62" r="13" fill="#0f172a" stroke="#e2e8f0" strokeWidth="5"/><circle cx="167" cy="62" r="13" fill="#0f172a" stroke="#e2e8f0" strokeWidth="5"/></svg>
        </div>
      </div>)}
    </div>
  </section>;
}
