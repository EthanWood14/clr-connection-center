import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { raceGrid, raceTrackPoint, type RaceDriver } from "@shared/tv-race-grid";
import { layoutRaceLabels, RACE_BASE_ANGULAR_SPEED, RACE_SPEED_MULTIPLIER } from "@shared/tv-race-labels";
import { planRaceTransition, interpolateRaceTransition } from "@shared/tv-race-transition";
import { RACE_CAMERA_FOV, raceCameraPose, raceCameraRadius, raceCameraSubjects } from "@shared/tv-race-camera";
import { createTvCarModel } from "./car-model";

type Options = { drivers: RaceDriver[]; before?: RaceDriver[] | null; reduced: boolean; focusId?: number; onFailure: () => void; onProgress?: (elapsed: number) => void };

/** Procedural scene with optional same-origin, access-controlled car pictures. */
export function mountRaceScene(host: HTMLElement, options: Options) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .95;
  renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
  renderer.domElement.setAttribute("aria-label", "3D race cars rounding the banked stadium corner");
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#61717e");
  scene.fog = new THREE.Fog("#687985", 105, 230);
  const camera = new THREE.PerspectiveCamera(RACE_CAMERA_FOV, 1, .3, 400);
  const resources = new Set<{ dispose: () => void }>();
  const keep = <T extends { dispose: () => void }>(resource: T) => { resources.add(resource); return resource; };
  let disposed=false, frame=0, observer:ResizeObserver|undefined;
  const tagElements:HTMLElement[]=[];
  let removeContextListener=()=>{};
  const cleanup=()=>{
    if(disposed)return;
    disposed=true;cancelAnimationFrame(frame);observer?.disconnect();removeContextListener();
    tagElements.forEach(t=>t.remove());resources.forEach(r=>r.dispose());
    scene.clear();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();
  };
  try {
  const material = (color: string | number, roughness = .55, metalness = .1) => keep(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  const steel = material("#647079", .32, .7);
  const white = material("#edf0e6", .5), red = material("#e54b3e", .5);
  const unitBox = keep(new THREE.BoxGeometry(1,1,1));
  const box = (parent: THREE.Object3D, w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(unitBox, mat); mesh.scale.set(w,h,d); mesh.position.set(x,y,z);
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  try { const environment=keep(pmrem.fromScene(room,.04));scene.environment=environment.texture; }
  finally { room.dispose();pmrem.dispose(); }
  scene.add(new THREE.HemisphereLight("#c1deef", "#3e4435", 1.6));
  const sun = new THREE.DirectionalLight("#fff1d5", 2.6);
  sun.position.set(35,65,-20); sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048); sun.shadow.camera.left=-70; sun.shadow.camera.right=70;
  sun.shadow.camera.top=70; sun.shadow.camera.bottom=-70; sun.shadow.normalBias=.08;
  keep(sun.shadow);
  scene.add(sun);

  const sky = new THREE.Mesh(keep(new THREE.SphereGeometry(245,24,16)),keep(new THREE.ShaderMaterial({
    side:THREE.BackSide,depthWrite:false,
    vertexShader:'varying vec3 vPosition; void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:'varying vec3 vPosition; void main(){float h=clamp(normalize(vPosition).y,0.0,1.0);vec3 c=mix(vec3(.63,.48,.38),vec3(.09,.19,.31),pow(h,.45));gl_FragColor=vec4(c,1.0);}',
  })));
  scene.add(sky);

  // Asphalt has fine, deterministic grain; no remote texture requests on a TV.
  const textureCanvas=document.createElement("canvas"); textureCanvas.width=textureCanvas.height=256;
  const ctx=textureCanvas.getContext("2d")!;
  let seed=7123;
  for(let y=0;y<256;y++) for(let x=0;x<256;x++) {
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const v=51+(seed%19); ctx.fillStyle=`rgb(${v},${v+3},${v+5})`; ctx.fillRect(x,y,1,1);
  }
  const asphaltTexture=keep(new THREE.CanvasTexture(textureCanvas));
  asphaltTexture.wrapS=asphaltTexture.wrapT=THREE.RepeatWrapping; asphaltTexture.repeat.set(6,35);
  asphaltTexture.colorSpace=THREE.SRGBColorSpace; asphaltTexture.anisotropy=4;
  const asphalt=keep(new THREE.MeshStandardMaterial({map:asphaltTexture,color:'#7b8590',roughness:.92}));
  const grass=material("#293d2b",1), sand=material("#9c9a80",1);
  const ground=new THREE.Mesh(keep(new THREE.PlaneGeometry(600,600)),grass);
  ground.rotation.x=-Math.PI/2; ground.position.y=-.22; ground.receiveShadow=true; scene.add(ground);

  const ribbon=(inner:number,outer:number,mat:THREE.Material,start=-Math.PI,end=Math.PI,extraY=0)=>{
    const count=Math.max(2,Math.ceil((end-start)*38)), vertices:number[]=[], uvs:number[]=[], indices:number[]=[];
    for(let i=0;i<=count;i++) {
      const a=start+(end-start)*i/count;
      for(let j=0;j<2;j++) { const r=j===0?inner:outer;
        vertices.push(Math.cos(a)*r, (r-32)*.075+extraY,Math.sin(a)*r); uvs.push(j,i/count);
      }
      if(i<count){const n=i*2;indices.push(n,n+2,n+1,n+1,n+2,n+3);}
    }
    const geometry=keep(new THREE.BufferGeometry());
    geometry.setAttribute("position",new THREE.Float32BufferAttribute(vertices,3));
    geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2)); geometry.setIndex(indices); geometry.computeVertexNormals();
    const mesh=new THREE.Mesh(geometry,mat); mesh.receiveShadow=true; scene.add(mesh); return mesh;
  }
  ribbon(28,57,sand); ribbon(31,53,asphalt,.0-Math.PI,Math.PI,.02);
  ribbon(30.5,31.2,white,-Math.PI,Math.PI,.045); ribbon(52.8,53.5,white,-Math.PI,Math.PI,.045);
  for(let i=0;i<150;i++) {
    const a=-Math.PI+i*Math.PI*2/150, b=a+Math.PI*2/150;
    ribbon(29.1,30.5,i%2?white:red,a,b,.04); ribbon(53.5,55,i%2?white:red,a,b,.04);
  }
  // Rubbered-in racing line, thin edge markings, and exit braking boards.
  const skid=keep(new THREE.MeshStandardMaterial({color:"#080b0e",transparent:true,opacity:.16,roughness:1}));
  ribbon(40.2,40.7,skid,-2.2,2.2,.035); ribbon(42.4,42.9,skid,-2.2,2.2,.035);
  for(let i=0;i<64;i++) {
    const a=i*Math.PI/32;
    const wall=box(scene,2.9,.8,.75,Math.cos(a)*57,2.25,Math.sin(a)*57,i%4===0?red:white);
    wall.rotation.y=-a+Math.PI/2;
  }

  const banner=(text:string,width:number,height:number,color:string)=>{
    const canvas=document.createElement("canvas");canvas.width=1024;canvas.height=128;
    const c=canvas.getContext("2d")!;c.fillStyle=color;c.fillRect(0,0,1024,128);
    c.fillStyle="#f5f6ef";c.font="italic 900 75px Arial";c.textAlign="center";c.textBaseline="middle";c.fillText(text,512,68,990);
    const map=keep(new THREE.CanvasTexture(canvas));map.colorSpace=THREE.SRGBColorSpace;
    return new THREE.Mesh(keep(new THREE.PlaneGeometry(width,height)),keep(new THREE.MeshBasicMaterial({map,side:THREE.DoubleSide})));
  }
  for(let i=0;i<9;i++) {
    const a=-1.6+i*.28;
    const sign=banner(i%2?"C3  /  GRAND PRIX":"WEST CAPITAL LENDING",13,1.65,i%2?"#183637":"#172634");
    sign.position.set(Math.cos(a)*57.5,2.3,Math.sin(a)*57.5);sign.rotation.y=Math.PI/2-a;scene.add(sign);
  }
  // A real stepped grandstand outside the far bend, with instanced crowd geometry.
  const standMat=material("#52656f",.85), roofMat=material("#1d303c",.55);
  const crowdCount=13*48, crowd=new THREE.InstancedMesh(keep(new THREE.BoxGeometry(.45,.65,.42)),material("#dce2dd"),crowdCount);
  const heads=new THREE.InstancedMesh(keep(new THREE.SphereGeometry(.18,6,5)),material("#d6b7a0"),crowdCount);
  const matrix=new THREE.Matrix4(), color=new THREE.Color();
  let person=0;
  for(let row=0;row<13;row++) {
    const r=63+row*1.3, y=3+row*.7;
    ribbon(r,r+1.35,standMat,-2.15,-.25,y-Math.max(0,r-32)*.075);
    for(let col=0;col<48;col++) {
      const a=-2.1+col*1.8/47;
      matrix.makeTranslation(Math.cos(a)*r,y+.5,Math.sin(a)*r);crowd.setMatrixAt(person,matrix);
      color.setHSL(((row*13+col*37)%100)/100,.3,.35+((col*7)%10)/30);crowd.setColorAt(person,color);
      matrix.makeTranslation(Math.cos(a)*r,y+.96,Math.sin(a)*r);heads.setMatrixAt(person,matrix);person++;
    }
  }
  keep(crowd);keep(heads);scene.add(crowd,heads);
  ribbon(63,82,roofMat,-2.18,-.24,12);
  for(let i=0;i<8;i++) {
    const a=-2.13+i*.265;box(scene,.3,15,.3,Math.cos(a)*81,7.5,Math.sin(a)*81,steel);
  }
  // Slim stadium lights and hills establish scale without obscuring the racing.
  const lampMat=keep(new THREE.MeshBasicMaterial({color:"#e8f8ff"}));
  for(const a of [-2.4,-1.8,-.8,.1,1.8,2.7]) {
    const r=91, x=Math.cos(a)*r,z=Math.sin(a)*r;
    box(scene,.45,22,.45,x,11,z,steel);box(scene,7,.7,1,x,22,z,lampMat);
  }
  for(let i=0;i<22;i++) {
    const a=i*Math.PI*2/22;
    const hill=new THREE.Mesh(keep(new THREE.ConeGeometry(22+(i%4)*8,18+(i%5)*6,6)),material(i%2?"#526663":"#4a5c5c",1));
    hill.position.set(Math.cos(a)*175,2,Math.sin(a)*175);scene.add(hill);
  }

  let redrawWraps=()=>{};
  const grid=raceGrid(options.drivers);
  const transitions=new Map(planRaceTransition(options.before??null,options.drivers,options.focusId).map(t=>[t.id,t]));
  const subjects=raceCameraSubjects(Array.from(transitions.values()),options.focusId);
  const framingRadius=raceCameraRadius(subjects);
  const racers=grid.map(driver=>{
    const model=keep(createTvCarModel({appearance:driver.car,rank:driver.rank,focus:driver.id===options.focusId,
      maxAnisotropy:renderer.capabilities.getMaxAnisotropy(),onTextureReady:()=>redrawWraps()}));
    const {root,wheels,boost}=model;scene.add(root);
    const tied=grid.filter(p=>p.gap===driver.gap).length;
    root.scale.setScalar(Math.min(1,16/Math.max(1,tied)/2.7));
    return {driver,root,wheels,boost};
  });

  // Every driver is named. Screen-space placement keeps nearby nameplates readable.
  const tags=racers.map(r=>{
    const element=document.createElement("div");
    element.style.cssText="position:absolute;pointer-events:none;padding:5px 8px;border-left:3px solid;background:#101a25ed;color:white;font:700 clamp(11px,1vw,17px) system-ui;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 3px 12px #0004;";
    element.style.borderColor=r.driver.color;
    element.textContent=r.driver.id===options.focusId?`▶ ${r.driver.name}`:r.driver.name;
    if(r.driver.id===options.focusId){element.style.background='#064e4bed';element.style.borderColor='#7cf5ee';element.style.fontWeight='900';element.style.zIndex='2';}
    element.title=r.driver.name;
    element.dataset.driverId=String(r.driver.id);
    const line=document.createElement("div");
    line.style.cssText="position:absolute;pointer-events:none;height:1px;transform-origin:0 50%;opacity:.7;";
    line.style.background=r.driver.color;
    host.append(line,element);tagElements.push(line,element);
    return {element,line,racer:r,width:element.offsetWidth,height:element.offsetHeight};
  });

  let start:number|undefined, previous=0, reported=-1, draw:(now:number)=>void;
  const vector=new THREE.Vector3();
  const resize=()=>{
    const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);
    renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
    for(const tag of tags){
      const display=tag.element.style.display;tag.element.style.display='block';
      tag.element.style.maxWidth=`${Math.max(1,w-20)}px`;
      tag.width=tag.element.offsetWidth;tag.height=tag.element.offsetHeight;
      tag.element.style.display=display;
    }
    if(options.reduced&&draw)draw(performance.now());
  };
  observer=new ResizeObserver(resize);observer.observe(host);resize();
  const fail=()=>{if(!disposed){cancelAnimationFrame(frame);options.onFailure();}};
  const contextLost=(event:Event)=>{event.preventDefault();fail();};
  renderer.domElement.addEventListener("webglcontextlost",contextLost);
  removeContextListener=()=>renderer.domElement.removeEventListener("webglcontextlost",contextLost);
  draw=(now:number)=>{
    if(disposed)return;
    if(start===undefined)start=now;
    const elapsed=options.reduced?4.6:Math.min(11.8,(now-start)/1000);
    if(!options.reduced && now-previous<32){frame=requestAnimationFrame(draw);return;}
    previous=now;
    const motionTime=options.reduced?4.6:elapsed;
    const speed=options.reduced?RACE_BASE_ANGULAR_SPEED:RACE_BASE_ANGULAR_SPEED*RACE_SPEED_MULTIPLIER;
    const lead=.06+motionTime*speed;
    for(const {driver,root,wheels,boost} of racers) {
      const transition=transitions.get(driver.id)!;
      const position=interpolateRaceTransition(transition,options.reduced?12:elapsed);
      const point=raceTrackPoint(lead-position.distance/42,position.lane);
      root.position.set(point.x,point.y,point.z);root.rotation.set(0,point.yaw,Math.atan(.075));
      boost.visible=!options.reduced&&transition.scored&&position.progress>.15&&position.progress<.85;
      for(const wheel of wheels)wheel.rotation.x=-motionTime*19*(options.reduced?1:RACE_SPEED_MULTIPLIER);
    }
    const shot=raceCameraPose(subjects,options.reduced?12:elapsed,lead,camera.aspect,framingRadius);
    camera.position.set(shot.position.x,shot.position.y,shot.position.z);
    camera.lookAt(shot.target.x,shot.target.y,shot.target.z);
    const progressTick=options.reduced?120:Math.floor(elapsed*5);
    if(progressTick!==reported){reported=progressTick;options.onProgress?.(options.reduced?12:elapsed);}
    try {renderer.render(scene,camera);}catch{fail();return;}
    const anchors=[];
    for(const {element,line,racer,width,height} of tags) {
      vector.copy(racer.root.position);vector.y+=2.2;vector.project(camera);
      const visible=vector.z>-1&&vector.z<1&&Math.abs(vector.x)<1&&Math.abs(vector.y)<.95;
      element.style.display=line.style.display=visible?'block':'none';
      if(visible)anchors.push({id:racer.driver.id,x:(vector.x*.5+.5)*host.clientWidth,y:(-vector.y*.5+.5)*host.clientHeight,width,height});
    }
    for(const label of layoutRaceLabels(anchors,{width:host.clientWidth,height:host.clientHeight})) {
      const tag=tags.find(t=>t.racer.driver.id===label.id)!;
      tag.element.style.left=`${label.left}px`;tag.element.style.top=`${label.top}px`;
      const dx=label.left+label.width/2-label.x,dy=label.top+label.height-label.y;
      tag.line.style.left=`${label.x}px`;tag.line.style.top=`${label.y}px`;
      tag.line.style.width=`${Math.hypot(dx,dy)}px`;tag.line.style.transform=`rotate(${Math.atan2(dy,dx)}rad)`;
    }
    if(!options.reduced&&elapsed<11.8)frame=requestAnimationFrame(draw);
  };
  // A late picture also updates a reduced-motion (single-frame) TV without
  // starting another animation loop or changing its fixed race pose.
  redrawWraps=()=>{if(!disposed){try{renderer.render(scene,camera);}catch{fail();}}};
  frame=requestAnimationFrame(draw);
  return cleanup;
  } catch(error) { cleanup();throw error; }
}
