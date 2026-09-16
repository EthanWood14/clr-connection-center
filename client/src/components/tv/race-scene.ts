import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { raceGrid, raceTrackPoint, type RaceDriver } from "@shared/tv-race-grid";
import { layoutRaceLabels, RACE_BASE_ANGULAR_SPEED, RACE_SPEED_MULTIPLIER } from "@shared/tv-race-labels";
import { planRaceTransition, interpolateRaceTransition } from "@shared/tv-race-transition";
import { RACE_CAMERA_FOV, raceBroadcastShot, raceCameraPose, raceCameraRadius, raceCameraStartAngle, raceCameraSubjects } from "@shared/tv-race-camera";
import { cornerCameraPose } from "@shared/tv-corner-camera";
import { createTvCarModel } from "./car-model";
import { sampleRaceDynamics } from "@shared/tv-race-dynamics";
import { raceSceneryClipPlane } from "@shared/tv-race-scenery";

type Options = { drivers: RaceDriver[]; before?: RaceDriver[] | null; reduced: boolean; focusId?: number; /** How long the scene runs before it stops drawing. The wall's corner race asks for two minutes; a transfer's moment holds the screen for twelve seconds. */ runSeconds?: number; /** How long the camera flight is stretched over. The same thirty-odd angles, walked slowly. */ cameraSeconds?: number; /** Corner mode: hold ONE car, and put its name up only now and then. A dozen nameplates at once is unreadable on a small panel. */ spotlight?: boolean; onFailure: () => void; onProgress?: (elapsed: number) => void; onShot?: (shot: { id: string; label: string }) => void };

/** Procedural scene with optional same-origin, access-controlled car pictures. */
export function mountRaceScene(host: HTMLElement, options: Options) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.localClippingEnabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .95;
  renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
  renderer.domElement.setAttribute("aria-label", "3D race cars rounding the banked stadium corner");
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#61717e");
  const raceFog=new THREE.Fog("#687985", 105, 230);scene.fog=raceFog;
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
  // A broadcast camera has a clear sightline. Clip only foreground scenery;
  // cars, the racing surface, and score-derived positions remain untouched.
  const sceneryPlane=new THREE.Plane();
  const sceneryMaterial=<T extends THREE.Material>(mat:T)=>{mat.clippingPlanes=[sceneryPlane];mat.clipShadows=true;return mat;};
  const material = (color: string | number, roughness = .55, metalness = .1) => keep(new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  const steel = sceneryMaterial(material("#647079", .32, .7));
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

  // A low infield camera needs a real grass foreground rather than an empty
  // green plane. This flat disc never touches the banked road (radius 31+).
  const grassCanvas=document.createElement("canvas");grassCanvas.width=grassCanvas.height=256;
  const grassContext=grassCanvas.getContext("2d")!,grassPixels=grassContext.createImageData(256,256);
  let grassSeed=9817;
  for(let i=0;i<256*256;i++){
    grassSeed=(Math.imul(grassSeed,1664525)+1013904223)>>>0;
    const stripe=Math.floor((i%256)/32)%2?7:0,noise=grassSeed%17;
    grassPixels.data.set([31+noise+stripe,65+noise+stripe,26+noise,255],i*4);
  }
  grassContext.putImageData(grassPixels,0,0);
  const grassMap=keep(new THREE.CanvasTexture(grassCanvas));grassMap.colorSpace=THREE.SRGBColorSpace;grassMap.anisotropy=4;
  const infield=new THREE.Mesh(keep(new THREE.CircleGeometry(27.5,96)),keep(new THREE.MeshStandardMaterial({map:grassMap,roughness:1})));
  infield.rotation.x=-Math.PI/2;infield.position.y=-.20;infield.receiveShadow=true;scene.add(infield);
  const tuftGeometry=keep(new THREE.BufferGeometry());
  tuftGeometry.setAttribute('position',new THREE.Float32BufferAttribute([-.055,0,0,.055,0,0,.025,.32,0,0,0,-.055,0,0,.055,0,.24,-.02],3));tuftGeometry.computeVertexNormals();
  const tufts=keep(new THREE.InstancedMesh(tuftGeometry,keep(new THREE.MeshStandardMaterial({color:'#628749',roughness:1,side:THREE.DoubleSide})),420));
  const tuftMatrix=new THREE.Matrix4();
  for(let i=0;i<420;i++){
    const a=i*2.3999632297,r=27*Math.sqrt((i+.5)/420);
    tuftMatrix.makeRotationY(a);tuftMatrix.setPosition(Math.cos(a)*r,-.19,Math.sin(a)*r);tufts.setMatrixAt(i,tuftMatrix);
  }
  scene.add(tufts);

  // Peripheral seat/rail fragments establish the fan's viewpoint without
  // putting a crowd member over the cars. They leave as the camera takes off.
  const fanFrame=new THREE.Group();camera.add(fanFrame);scene.add(camera);
  const fanMaterial=keep(new THREE.MeshBasicMaterial({color:'#14222e',transparent:true,opacity:1,depthWrite:false,fog:false}));
  const railMaterial=keep(new THREE.MeshBasicMaterial({color:'#607681',transparent:true,opacity:1,depthWrite:false,fog:false}));
  for(const side of [-1,1]){
    const seat=box(fanFrame,.45,.23,.09,side*.99,-.64,-1.5,fanMaterial);seat.castShadow=seat.receiveShadow=false;
    const rail=box(fanFrame,.50,.028,.035,side*1.03,-.46,-1.5,railMaterial);rail.castShadow=rail.receiveShadow=false;
  }

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
  const wallWhite=sceneryMaterial(material("#edf0e6",.5)),wallRed=sceneryMaterial(material("#e54b3e",.5));
  for(let i=0;i<64;i++) {
    const a=i*Math.PI/32;
    const wall=box(scene,2.9,.8,.75,Math.cos(a)*57,2.25,Math.sin(a)*57,i%4===0?wallRed:wallWhite);
    wall.rotation.y=-a+Math.PI/2;
  }

  const banner=(text:string,width:number,height:number,color:string)=>{
    const canvas=document.createElement("canvas");canvas.width=1024;canvas.height=128;
    const c=canvas.getContext("2d")!;c.fillStyle=color;c.fillRect(0,0,1024,128);
    c.fillStyle="#f5f6ef";c.font="italic 900 75px Arial";c.textAlign="center";c.textBaseline="middle";c.fillText(text,512,68,990);
    const map=keep(new THREE.CanvasTexture(canvas));map.colorSpace=THREE.SRGBColorSpace;
    const bannerMaterial=sceneryMaterial(keep(new THREE.MeshBasicMaterial({map,side:THREE.FrontSide})));
    const bannerGeometry=keep(new THREE.PlaneGeometry(width,height)),group=new THREE.Group();
    const front=new THREE.Mesh(bannerGeometry,bannerMaterial),back=new THREE.Mesh(bannerGeometry,bannerMaterial);
    front.position.z=.005;back.position.z=-.005;back.rotation.y=Math.PI;group.add(front,back);return group;
  }
  for(let i=0;i<9;i++) {
    const a=-1.6+i*.28;
    const sign=banner(i%2?"C3  /  GRAND PRIX":"WEST CAPITAL LENDING",13,1.65,i%2?"#183637":"#172634");
    sign.position.set(Math.cos(a)*57.5,2.3,Math.sin(a)*57.5);sign.rotation.y=Math.PI/2-a;scene.add(sign);
  }
  // A real stepped grandstand outside the far bend, with instanced crowd geometry.
  const standMat=sceneryMaterial(material("#52656f",.85)), roofMat=sceneryMaterial(material("#1d303c",.55));
  const crowdCount=13*48, crowd=new THREE.InstancedMesh(keep(new THREE.BoxGeometry(.45,.65,.42)),sceneryMaterial(material("#dce2dd")),crowdCount);
  const heads=new THREE.InstancedMesh(keep(new THREE.SphereGeometry(.18,6,5)),sceneryMaterial(material("#d6b7a0")),crowdCount);
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
  const lampMat=sceneryMaterial(keep(new THREE.MeshBasicMaterial({color:"#e8f8ff"})));
  for(const a of [-2.4,-1.8,-.8,.1,1.8,2.7]) {
    const r=91, x=Math.cos(a)*r,z=Math.sin(a)*r;
    box(scene,.45,22,.45,x,11,z,steel);box(scene,7,.7,1,x,22,z,lampMat);
  }
  for(let i=0;i<22;i++) {
    const a=i*Math.PI*2/22;
    const hill=new THREE.Mesh(keep(new THREE.ConeGeometry(22+(i%4)*8,18+(i%5)*6,6)),sceneryMaterial(material(i%2?"#526663":"#4a5c5c",1)));
    hill.position.set(Math.cos(a)*175,2,Math.sin(a)*175);scene.add(hill);
  }

  let redrawWraps=()=>{};
  const grid=raceGrid(options.drivers);
  const transitions=new Map(planRaceTransition(options.before??null,options.drivers,options.focusId).map(t=>[t.id,t]));
  const allPlans=Array.from(transitions.values());
  // Spotlight keeps ONE car in shot. raceCameraSubjects deliberately widens
  // to the rivals of a pass, which is right for a transfer's race and wrong
  // for a corner panel: there it just pulls the lens back off everybody.
  const spotlit=options.spotlight?allPlans.filter(p=>p.id===options.focusId):[];
  const subjects=spotlit.length?spotlit:raceCameraSubjects(allPlans,options.focusId);
  const framingRadius=raceCameraRadius(subjects);
  const startAngle=raceCameraStartAngle(subjects);
  const racers=grid.map(driver=>{
    const model=keep(createTvCarModel({appearance:driver.car,rank:driver.rank,focus:driver.id===options.focusId,
      maxAnisotropy:renderer.capabilities.getMaxAnisotropy(),onTextureReady:()=>redrawWraps()}));
    const {root,wheels,boost,chassis,frontSteering}=model;scene.add(root);
    const tied=grid.filter(p=>p.gap===driver.gap).length;
    root.scale.setScalar(Math.min(1,16/Math.max(1,tied)/2.7));
    return {driver,root,wheels,boost,chassis,frontSteering};
  });

  // Every driver is named. Screen-space placement keeps nearby nameplates readable.
  // Spotlight names the car being followed AND the two nearest it on track:
  // one plate says who you are watching, three say who they are racing
  // (owner, 16 Sep 2026 — "the name on more cars than the one in first").
  // Every car, all the time, is what made the panel unreadable.
  const spotlightNames=3;
  const named=options.spotlight?(()=>{
    const focus=racers.find(r=>r.driver.id===options.focusId)??racers[0];
    if(!focus)return racers.slice(0,spotlightNames);
    const others=racers.filter(r=>r!==focus)
      .sort((a,b)=>Math.abs(a.driver.distance-focus.driver.distance)-Math.abs(b.driver.distance-focus.driver.distance));
    return [focus,...others.slice(0,spotlightNames-1)];
  })():racers;
  const tags=named.map(r=>{
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

  let start:number|undefined, previous=0, reported=-1, reportedShot="", draw:(now:number)=>void;
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
    // The cars keep lapping for the whole run; the camera walks its flight
    // over cameraSeconds. Separating them is what lets the corner race be a
    // two-minute shot without the cars crawling round in slow motion.
    const runFor=options.runSeconds??11.8, flightFor=options.cameraSeconds??12;
    const elapsed=options.reduced?4.6:Math.min(runFor,(now-start)/1000);
    const cameraTime=options.reduced?12:Math.min(12,elapsed*12/flightFor);
    if(!options.reduced && now-previous<32){frame=requestAnimationFrame(draw);return;}
    previous=now;
    const motionTime=options.reduced?4.6:elapsed;
    const speed=options.reduced?RACE_BASE_ANGULAR_SPEED:RACE_BASE_ANGULAR_SPEED*RACE_SPEED_MULTIPLIER;
    const lead=startAngle+motionTime*speed;
    let focusPose:{angle:number;lane:number}|undefined;
    for(const {driver,root,wheels,boost,chassis,frontSteering} of racers) {
      const transition=transitions.get(driver.id)!;
      const position=interpolateRaceTransition(transition,options.reduced?12:elapsed);
      const point=raceTrackPoint(lead-position.distance/42,position.lane);
      if(options.spotlight&&driver.id===(options.focusId??racers[0]?.driver.id))focusPose={angle:lead-position.distance/42,lane:position.lane};
      const dynamics=sampleRaceDynamics({transition,elapsed,driverId:driver.id,speed,reduced:options.reduced});
      root.position.set(point.x,point.y,point.z);root.rotation.set(0,point.yaw+dynamics.yawOffset,Math.atan(.075));
      chassis.rotation.set(dynamics.pitch,0,dynamics.roll);chassis.position.y=dynamics.heave;
      for(const steering of frontSteering)steering.rotation.y=dynamics.steering;
      boost.visible=!options.reduced&&transition.scored&&position.progress>.15&&position.progress<.85;
      for(const wheel of wheels)wheel.rotation.x=dynamics.wheelAngle;
    }
    const shot=options.spotlight&&focusPose
      ? cornerCameraPose(elapsed,focusPose)
      : raceCameraPose(subjects,cameraTime,lead,camera.aspect,framingRadius,options.reduced);
    if(camera.fov!==shot.fov){camera.fov=shot.fov;camera.updateProjectionMatrix();}
    camera.position.set(shot.position.x,shot.position.y,shot.position.z);
    camera.lookAt(shot.target.x,shot.target.y,shot.target.z);
    camera.rotateZ(options.reduced?0:shot.roll);
    const fanOpacity=options.reduced?0:Math.max(0,Math.min(1,(1.8-elapsed)/.6));
    fanFrame.visible=fanOpacity>0;fanMaterial.opacity=railMaterial.opacity=fanOpacity;
    // Wide TV shots retreat from the field; atmosphere belongs behind the
    // racers, not between the lens and their cars.
    const shotDistance=Math.hypot(shot.position.x-shot.target.x,shot.position.y-shot.target.y,shot.position.z-shot.target.z);
    raceFog.near=Math.max(105,shotDistance+60);raceFog.far=Math.max(230,raceFog.near+125);
    const sceneryClip=raceSceneryClipPlane(shot.position,shot.target,racers.map(r=>r.root.position));
    sceneryPlane.normal.set(sceneryClip.normal.x,sceneryClip.normal.y,sceneryClip.normal.z);sceneryPlane.constant=sceneryClip.constant;
    const shotLabel=options.reduced?raceBroadcastShot(12,true):shot.shot;
    if(shotLabel.id!==reportedShot){reportedShot=shotLabel.id;options.onShot?.(shotLabel);}
    const progressTick=options.reduced?120:Math.floor(elapsed*5);
    if(progressTick!==reported){reported=progressTick;options.onProgress?.(options.reduced?12:elapsed);}
    try {renderer.render(scene,camera);}catch{fail();return;}
    const anchors=[];
    for(const {element,line,racer,width,height} of tags) {
      vector.copy(racer.root.position);vector.y+=2.2;vector.project(camera);
      // In the corner the name is an occasional caption, not a permanent
      // label: four seconds on, sixteen off, so the panel is cars almost all
      // of the time and still tells you who you are watching.
      const named_now=!options.spotlight||(elapsed%18)<7;
      const visible=named_now&&vector.z>-1&&vector.z<1&&Math.abs(vector.x)<1&&Math.abs(vector.y)<.95;
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
    if(!options.reduced&&elapsed<runFor)frame=requestAnimationFrame(draw);
  };
  // A late picture also updates a reduced-motion (single-frame) TV without
  // starting another animation loop or changing its fixed race pose.
  redrawWraps=()=>{if(!disposed){try{renderer.render(scene,camera);}catch{fail();}}};
  frame=requestAnimationFrame(draw);
  return cleanup;
  } catch(error) { cleanup();throw error; }
}
