import { fieldStandings } from "./tv-field-race";
import { normalizeTvCarAppearance, type TvCarAppearance } from "./tv-car";
export type RaceDriver = { id: number; name: string; transfersToday: number; car?: TvCarAppearance };

export function raceGrid(people: RaceDriver[]) {
  const ranked=fieldStandings(people);
  const groups=Array.from(new Set(ranked.map(p=>p.gap)));
  const high=Math.max(1,...groups);
  return ranked.map(p=>{
    const peers=ranked.filter(r=>r.gap===p.gap);
    const seat=peers.findIndex(r=>r.id===p.id);
    const car=normalizeTvCarAppearance(p.car,p.id);
    return {...p,car,color:car.bodyColor,
      // The minimum group spacing keeps fractional-credit neighbors legible.
      distance:groups.indexOf(p.gap)*4.8 + p.gap/high*10,
      lane:peers.length>1?(seat-(peers.length-1)/2)*Math.min(3.2,16/peers.length):((p.rank%3)-1)*3.2,
    };
  });
}

export function raceTrackPoint(angle:number,lane:number) {
  const radius=42+lane;
  return {x:Math.cos(angle)*radius,z:Math.sin(angle)*radius,y:Math.max(0,radius-32)*.075+.045,yaw:-angle};
}
