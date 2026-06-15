import { useMemo, useRef, useState } from "react";
import { US_STATE_PATHS, US_STATE_LABEL_POINTS, US_MAP_W, US_MAP_H } from "./us-state-paths";

export interface GeoMapState {
  abbr: string;
  name: string;
}

interface UsStateGeoMapProps {
  /** abbr -> number of LOs licensed in that state */
  coverage: Record<string, number>;
  selectedAbbr: string | null;
  onSelect: (state: GeoMapState) => void;
  /** optional abbr -> LO names, used to enrich the hover tooltip */
  namesByState?: Record<string, string[]>;
}

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "Washington D.C.",
};

// Tiny Northeast states (+ DC) get election-style labels in a column on the
// right with leader lines, since they're too small to label in place.
const RIGHT_COLUMN = ["VT", "NH", "MA", "CT", "RI", "NJ", "DE", "MD", "DC"];
// DC has no shape in the dataset — anchor its marker/leader line here.
const DC_POS = { x: 851, y: 299 };

const RIGHT_X = US_MAP_W + 70;       // x of the label chips
const VIEW_W = US_MAP_W + 170;       // extra room on the right for the column
const VIEW_H = US_MAP_H + 6;

function fillFor(count: number, selected: boolean): string {
  if (selected) return "hsl(var(--primary) / 0.92)";
  if (!count) return "hsl(var(--muted))";
  if (count === 1) return "hsl(var(--primary) / 0.18)";
  if (count === 2) return "hsl(var(--primary) / 0.34)";
  if (count === 3) return "hsl(var(--primary) / 0.5)";
  if (count <= 5) return "hsl(var(--primary) / 0.66)";
  return "hsl(var(--primary) / 0.82)";
}

// Whether the label sitting on a given count should be light (for dark fills).
function labelLight(count: number, selected: boolean): boolean {
  return selected || count >= 4;
}

export function UsStateGeoMap({ coverage, selectedAbbr, onSelect, namesByState }: UsStateGeoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ abbr: string; x: number; y: number } | null>(null);

  // Pointer position relative to the container, so the tooltip lands correctly
  // regardless of which SVG child fired the event.
  const moveHover = (abbr: string, e: { clientX: number; clientY: number }) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({ abbr, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  const abbrs = useMemo(() => Object.keys(US_STATE_PATHS), []);
  const rightColumn = useMemo(() => {
    // Spread the chips vertically across the map height, north -> south.
    const top = 96, bottom = 372, gap = (bottom - top) / (RIGHT_COLUMN.length - 1);
    return RIGHT_COLUMN.map((abbr, i) => ({ abbr, y: top + i * gap }));
  }, []);

  const select = (abbr: string) => onSelect({ abbr, name: STATE_NAMES[abbr] ?? abbr });

  const tooltip = (() => {
    if (!hover) return null;
    const count = coverage[hover.abbr] || 0;
    const names = namesByState?.[hover.abbr] ?? [];
    return (
      <div
        className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
        style={{ left: hover.x + 12, top: hover.y + 12, maxWidth: 220 }}
      >
        <div className="font-semibold text-popover-foreground">{STATE_NAMES[hover.abbr] ?? hover.abbr}</div>
        <div className="text-muted-foreground">
          {count === 0 ? "No LOs licensed" : `${count} LO${count === 1 ? "" : "s"} licensed`}
        </div>
        {names.length > 0 && (
          <div className="mt-0.5 text-popover-foreground/80 leading-snug">
            {names.slice(0, 6).join(", ")}{names.length > 6 ? ` +${names.length - 6} more` : ""}
          </div>
        )}
      </div>
    );
  })();

  return (
    <div ref={containerRef} className="relative w-full">
      <svg
        viewBox={`-4 -3 ${VIEW_W} ${VIEW_H}`}
        className="w-full h-auto select-none"
        role="group"
        aria-label="US state coverage map"
        onMouseLeave={() => setHover(null)}
      >
        {/* State shapes */}
        {abbrs.map((abbr) => {
          const count = coverage[abbr] || 0;
          const selected = selectedAbbr === abbr;
          return (
            <path
              key={abbr}
              data-abbr={abbr}
              d={US_STATE_PATHS[abbr]}
              role="button"
              tabIndex={0}
              aria-label={`${STATE_NAMES[abbr] ?? abbr}: ${count} loan officer${count === 1 ? "" : "s"} licensed`}
              aria-pressed={selected}
              fill={fillFor(count, selected)}
              stroke={selected ? "hsl(var(--primary))" : "hsl(var(--border))"}
              strokeWidth={selected ? 1.6 : 0.6}
              className="cursor-pointer outline-none transition-[fill] duration-150 hover:brightness-95 focus-visible:stroke-[hsl(var(--ring))] focus-visible:[stroke-width:1.8]"
              onClick={() => select(abbr)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(abbr); }
              }}
              onMouseEnter={(e) => moveHover(abbr, e)}
              onMouseMove={(e) => moveHover(abbr, e)}
            />
          );
        })}

        {/* DC marker (no shape in the dataset) */}
        {(() => {
          const count = coverage.DC || 0;
          const selected = selectedAbbr === "DC";
          return (
            <circle
              data-abbr="DC"
              cx={DC_POS.x}
              cy={DC_POS.y}
              r={selected ? 5 : 4}
              role="button"
              tabIndex={0}
              aria-label={`Washington D.C.: ${count} loan officers licensed`}
              fill={fillFor(count, selected)}
              stroke={selected ? "hsl(var(--primary))" : "hsl(var(--border))"}
              strokeWidth={1}
              className="cursor-pointer outline-none focus-visible:stroke-[hsl(var(--ring))]"
              onClick={() => select("DC")}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select("DC"); } }}
              onMouseEnter={(e) => moveHover("DC", e)}
            />
          );
        })()}

        {/* In-place labels for states big enough to fit them, anchored at the
            visual centroid of the state's largest landmass (precomputed). */}
        {abbrs.map((abbr) => {
          if (RIGHT_COLUMN.includes(abbr)) return null;
          const p = US_STATE_LABEL_POINTS[abbr];
          if (!p || p.w < 22 || p.h < 18) return null;
          const count = coverage[abbr] || 0;
          const selected = selectedAbbr === abbr;
          const light = labelLight(count, selected);
          const fg = light ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))";
          return (
            <g key={`lbl-${abbr}`} className="pointer-events-none" textAnchor="middle">
              <text x={p.x} y={p.y - 1} fontSize={11} fontWeight={700} fill={fg}>{abbr}</text>
              <text x={p.x} y={p.y + 10} fontSize={9} fill={count ? fg : "hsl(var(--muted-foreground))"} opacity={count ? 0.85 : 0.6}>
                {count || ""}
              </text>
            </g>
          );
        })}

        {/* Right-column election-style labels + leader lines for tiny states */}
        {rightColumn.map(({ abbr, y }) => {
          const lp = US_STATE_LABEL_POINTS[abbr];
          const anchor = abbr === "DC" ? DC_POS : lp ? { x: lp.x, y: lp.y } : null;
          const count = coverage[abbr] || 0;
          const selected = selectedAbbr === abbr;
          const light = labelLight(count, selected);
          return (
            <g key={`rc-${abbr}`}>
              {anchor && (
                <polyline
                  points={`${anchor.x},${anchor.y} ${RIGHT_X - 6},${y}`}
                  fill="none"
                  stroke="hsl(var(--border))"
                  strokeWidth={0.7}
                  className="pointer-events-none"
                />
              )}
              <g
                role="button"
                tabIndex={0}
                aria-label={`${STATE_NAMES[abbr] ?? abbr}: ${count} loan officers licensed`}
                className="cursor-pointer outline-none"
                onClick={() => select(abbr)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(abbr); } }}
                onMouseEnter={(e) => moveHover(abbr, e)}
              >
                <rect
                  x={RIGHT_X - 6} y={y - 9} width={62} height={18} rx={3}
                  fill={fillFor(count, selected)}
                  stroke={selected ? "hsl(var(--primary))" : "hsl(var(--border))"}
                  strokeWidth={selected ? 1.4 : 0.6}
                />
                <text
                  x={RIGHT_X - 1} y={y + 4} fontSize={11} fontWeight={700}
                  fill={light ? "hsl(var(--primary-foreground))" : "hsl(var(--foreground))"}
                >
                  {abbr}{count ? ` ${count}` : ""}
                </text>
              </g>
            </g>
          );
        })}
      </svg>
      {tooltip}
    </div>
  );
}
