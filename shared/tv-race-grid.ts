import { fieldStandings } from "./tv-field-race";
import { normalizeTvCarAppearance, type TvCarAppearance } from "./tv-car";
export type RaceDriver = { id: number; name: string; transfersToday: number; car?: TvCarAppearance };

/**
 * How much track one transfer of the gap is worth, and the most the field can
 * ever be strung out over.
 *
 * Being a long way ahead has to LOOK like it (Ethan, 16 Sep 2026: "make the
 * gap more noticeable on the race when someone's up by a lot"). The spacing
 * used to be entirely relative — a group index plus the gap divided by the
 * BIGGEST gap — so a leader four clear and a leader one clear sat at the same
 * place on the road, and a runaway morning looked like a photo finish.
 *
 * Absolute, then, but bounded: `1 - e^-x` keeps every extra transfer worth
 * some track while the tail of the field still fits on one corner, and it is
 * strictly increasing, so more credit is ALWAYS further up the road — a hard
 * cap would let two different gaps land on the same spot.
 */
export const RACE_TRACK_PER_TRANSFER = 3.4;
export const RACE_TRACK_MAX_SPREAD = 64;
export function raceTrackSpread(gap: number) {
  const behind = Math.max(0, gap);
  return RACE_TRACK_MAX_SPREAD * (1 - Math.exp(-behind * RACE_TRACK_PER_TRANSFER / RACE_TRACK_MAX_SPREAD));
}

export function raceGrid(people: RaceDriver[]) {
  const ranked=fieldStandings(people);
  const groups=Array.from(new Set(ranked.map(p=>p.gap)));
  return ranked.map(p=>{
    const peers=ranked.filter(r=>r.gap===p.gap);
    const seat=peers.findIndex(r=>r.id===p.id);
    const car=normalizeTvCarAppearance(p.car,p.id);
    return {...p,car,color:car.bodyColor,
      // The minimum group spacing keeps fractional-credit neighbors legible;
      // the spread above is what makes a real lead read as one.
      distance:groups.indexOf(p.gap)*4.8 + raceTrackSpread(p.gap),
      lane:peers.length>1?(seat-(peers.length-1)/2)*Math.min(3.2,16/peers.length):((p.rank%3)-1)*3.2,
    };
  });
}

export function raceTrackPoint(angle:number,lane:number) {
  const radius=42+lane;
  return {x:Math.cos(angle)*radius,z:Math.sin(angle)*radius,y:Math.max(0,radius-32)*.075+.045,yaw:-angle};
}
