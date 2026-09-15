export const RACE_SPEED_MULTIPLIER = 5;
export const RACE_BASE_ANGULAR_SPEED = .115;

export type RaceLabelAnchor = { id: number; x: number; y: number; width: number; height: number };
export type RaceLabelPlacement = RaceLabelAnchor & { left: number; top: number };

/** Stable, bounded screen-space labels. Connector lines retain the true car anchor. */
export function layoutRaceLabels(anchors: RaceLabelAnchor[], bounds: { width: number; height: number }) {
  const placed:RaceLabelPlacement[]=[];
  const left=10,right=Math.max(10,bounds.width-10),top=Math.min(130,bounds.height*.2),bottom=bounds.height*.8;
  for(const anchor of [...anchors].sort((a,b)=>a.id-b.id)) {
    const width=Math.min(anchor.width,Math.max(1,right-left));
    const height=anchor.height;
    const baseLeft=Math.max(left,Math.min(right-width,anchor.x-width/2));
    const baseTop=Math.max(top,Math.min(bottom-height,anchor.y-height-18));
    let best={left:baseLeft,top:baseTop},bestScore=Infinity;
    // Try columns around the car and rows upward/downward; penalize overlap first.
    for(let row=0;row<12;row++) for(const column of [0,-1,1]) {
      const offset=row===0?0:Math.ceil(row/2)*(row%2?-1:1)*(height+6);
      const x=Math.max(left,Math.min(right-width,baseLeft+column*(width+8)));
      const y=Math.max(top,Math.min(bottom-height,baseTop+offset));
      const overlaps=placed.reduce((sum,p)=>sum+(x<p.left+p.width+5&&x+width+5>p.left&&y<p.top+p.height+5&&y+height+5>p.top?1:0),0);
      const score=overlaps*100000+Math.abs(x-baseLeft)+Math.abs(y-baseTop)*1.1;
      if(score<bestScore){best={left:x,top:y};bestScore=score;}
    }
    placed.push({...anchor,width,...best});
  }
  return placed;
}
