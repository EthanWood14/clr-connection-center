import { memo } from "react";

/**
 * Tile-grid US map. Each state is a square placed at its rough geographic
 * position on an 11-column grid. Used by FiveThirtyEight, NYT, WaPo for
 * state-level data viz — better than a tiny geographic map for reading
 * counts at a glance, and 100% recognizable as "the US."
 *
 * Layout reference (row, col are 1-indexed):
 *   row 1:                                         ME(11)
 *   row 2:                                VT(9) NH(10)
 *   row 3: WA(1)    MT(3) ND(4) MN(5)    WI(7)    MI(9) NY(10) MA(11)
 *   row 4: ID(2) WY(3) SD(4) IA(5) IL(6) IN(7) OH(8) PA(9)  NJ(10) CT(11) RI(12... wrap)
 *   ...etc.
 *
 * Each tile carries the state abbr; clicking fires onSelect.
 */

type Tile = { abbr: string; name: string; row: number; col: number };

// 8 rows × 12 cols. AK and HI are tucked in the bottom-left corner.
const TILES: Tile[] = [
  // Row 1
  { abbr: "ME", name: "Maine", row: 1, col: 12 },
  // Row 2
  { abbr: "VT", name: "Vermont", row: 2, col: 11 },
  { abbr: "NH", name: "New Hampshire", row: 2, col: 12 },
  // Row 3
  { abbr: "WA", name: "Washington", row: 3, col: 2 },
  { abbr: "MT", name: "Montana", row: 3, col: 4 },
  { abbr: "ND", name: "North Dakota", row: 3, col: 5 },
  { abbr: "MN", name: "Minnesota", row: 3, col: 6 },
  { abbr: "WI", name: "Wisconsin", row: 3, col: 8 },
  { abbr: "MI", name: "Michigan", row: 3, col: 10 },
  { abbr: "NY", name: "New York", row: 3, col: 11 },
  { abbr: "MA", name: "Massachusetts", row: 3, col: 12 },
  // Row 4
  { abbr: "ID", name: "Idaho", row: 4, col: 3 },
  { abbr: "WY", name: "Wyoming", row: 4, col: 4 },
  { abbr: "SD", name: "South Dakota", row: 4, col: 5 },
  { abbr: "IA", name: "Iowa", row: 4, col: 6 },
  { abbr: "IL", name: "Illinois", row: 4, col: 7 },
  { abbr: "IN", name: "Indiana", row: 4, col: 8 },
  { abbr: "OH", name: "Ohio", row: 4, col: 9 },
  { abbr: "PA", name: "Pennsylvania", row: 4, col: 10 },
  { abbr: "NJ", name: "New Jersey", row: 4, col: 11 },
  { abbr: "CT", name: "Connecticut", row: 4, col: 12 },
  // Row 5
  { abbr: "OR", name: "Oregon", row: 5, col: 2 },
  { abbr: "NV", name: "Nevada", row: 5, col: 3 },
  { abbr: "CO", name: "Colorado", row: 5, col: 4 },
  { abbr: "NE", name: "Nebraska", row: 5, col: 5 },
  { abbr: "MO", name: "Missouri", row: 5, col: 6 },
  { abbr: "KY", name: "Kentucky", row: 5, col: 7 },
  { abbr: "WV", name: "West Virginia", row: 5, col: 8 },
  { abbr: "VA", name: "Virginia", row: 5, col: 9 },
  { abbr: "MD", name: "Maryland", row: 5, col: 10 },
  { abbr: "DE", name: "Delaware", row: 5, col: 11 },
  { abbr: "RI", name: "Rhode Island", row: 5, col: 12 },
  // Row 6
  { abbr: "CA", name: "California", row: 6, col: 2 },
  { abbr: "UT", name: "Utah", row: 6, col: 3 },
  { abbr: "NM", name: "New Mexico", row: 6, col: 4 },
  { abbr: "KS", name: "Kansas", row: 6, col: 5 },
  { abbr: "AR", name: "Arkansas", row: 6, col: 6 },
  { abbr: "TN", name: "Tennessee", row: 6, col: 7 },
  { abbr: "NC", name: "North Carolina", row: 6, col: 8 },
  { abbr: "SC", name: "South Carolina", row: 6, col: 9 },
  { abbr: "DC", name: "Washington D.C.", row: 6, col: 10 },
  // Row 7
  { abbr: "AZ", name: "Arizona", row: 7, col: 3 },
  { abbr: "OK", name: "Oklahoma", row: 7, col: 5 },
  { abbr: "TX", name: "Texas", row: 7, col: 4 },
  { abbr: "LA", name: "Louisiana", row: 7, col: 6 },
  { abbr: "MS", name: "Mississippi", row: 7, col: 7 },
  { abbr: "AL", name: "Alabama", row: 7, col: 8 },
  { abbr: "GA", name: "Georgia", row: 7, col: 9 },
  // Row 8
  { abbr: "AK", name: "Alaska", row: 8, col: 1 },
  { abbr: "HI", name: "Hawaii", row: 8, col: 2 },
  { abbr: "FL", name: "Florida", row: 8, col: 9 },
];

interface Props {
  coverage: Record<string, number>;
  selectedAbbr: string | null;
  onSelect: (state: { abbr: string; name: string }) => void;
}

function bucketClass(count: number, selected: boolean): string {
  const base = "transition-colors rounded-md flex flex-col items-center justify-center text-[10px] font-mono font-semibold leading-none aspect-square select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const ring = selected ? " ring-2 ring-primary ring-offset-1 ring-offset-card scale-105" : "";
  if (count === 0) {
    return `${base}${ring} bg-muted/40 text-muted-foreground hover:bg-muted border border-border`;
  }
  if (count === 1) {
    return `${base}${ring} bg-primary/15 text-primary hover:bg-primary/25 border border-primary/25`;
  }
  if (count <= 3) {
    return `${base}${ring} bg-primary/35 text-primary-foreground hover:bg-primary/45 border border-primary/40`;
  }
  return `${base}${ring} bg-primary/65 text-primary-foreground hover:bg-primary/75 border border-primary/70`;
}

function UsStateTileMapInner({ coverage, selectedAbbr, onSelect }: Props) {
  return (
    <div className="space-y-3">
      <div
        className="grid gap-1 sm:gap-1.5 mx-auto"
        style={{
          gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
          gridTemplateRows: "repeat(8, minmax(0, 1fr))",
          maxWidth: "640px",
        }}
        role="grid"
        aria-label="US states map"
      >
        {TILES.map((tile) => {
          const count = coverage[tile.abbr] || 0;
          const selected = selectedAbbr === tile.abbr;
          return (
            <button
              key={tile.abbr}
              type="button"
              role="gridcell"
              aria-label={`${tile.name}: ${count} loan officer${count === 1 ? "" : "s"}`}
              aria-pressed={selected}
              title={`${tile.name} — ${count} LO${count === 1 ? "" : "s"}`}
              onClick={() => onSelect({ abbr: tile.abbr, name: tile.name })}
              className={bucketClass(count, selected)}
              style={{ gridColumn: tile.col, gridRow: tile.row }}
              data-state={tile.abbr}
              data-testid={`map-tile-${tile.abbr}`}
            >
              <span>{tile.abbr}</span>
              {count > 0 && (
                <span className="text-[8px] font-normal opacity-80 mt-0.5">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-muted/40 border border-border" /> 0
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-primary/15 border border-primary/25" /> 1
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-primary/35 border border-primary/40" /> 2–3
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-primary/65 border border-primary/70" /> 4+
        </span>
      </div>
    </div>
  );
}

export const UsStateTileMap = memo(UsStateTileMapInner);
