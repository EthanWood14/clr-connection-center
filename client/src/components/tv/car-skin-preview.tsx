import { useEffect, useRef, useState, type PointerEvent } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import type { TvCarAppearance } from "@shared/tv-car";
import { CAR_SKIN_PANELS, PANEL_HEIGHT, PANEL_WIDTH, skinPanelRgba, type CarSkinPanel } from "@shared/tv-car-skin";
import { createTvCarModel, type TvCarModel } from "./car-model";

type PreviewControl = { setAppearance: (appearance: TvCarAppearance) => void; setAngle: (yaw: number, pitch: number) => void; dispose: () => void };
export const CAR_SKIN_PREVIEW_VIEWS = [
  { label: "3/4", yaw: Math.PI / 4, pitch: .42 }, { label: "Front", yaw: 0, pitch: .12 },
  { label: "Left", yaw: -Math.PI / 2, pitch: .15 }, { label: "Right", yaw: Math.PI / 2, pitch: .15 },
  { label: "Rear", yaw: Math.PI, pitch: .15 }, { label: "Top", yaw: 0, pitch: Math.PI / 2 - .001 },
];

/** Keep the complete front wing and rear tires inside narrow mobile previews. */
export function setCarSkinPreviewCamera(camera: THREE.PerspectiveCamera, yaw: number, pitch: number): void {
  const distance = Math.max(9.4, 10.5 / Math.max(.1, camera.aspect));
  camera.position.set(Math.sin(yaw) * Math.cos(pitch) * distance, .65 + Math.sin(pitch) * distance, Math.cos(yaw) * Math.cos(pitch) * distance);
  camera.lookAt(0, .65, .15);
}

function FlatPanel({ appearance, panel }: { appearance: TvCarAppearance; panel: CarSkinPanel }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!appearance.skin) return;
    const context = canvas.current?.getContext("2d");
    if (context) context.putImageData(new ImageData(new Uint8ClampedArray(skinPanelRgba(appearance.skin, panel, appearance.bodyColor)), PANEL_WIDTH, PANEL_HEIGHT), 0, 0);
  }, [appearance, panel]);
  return <canvas ref={canvas} width={PANEL_WIDTH} height={PANEL_HEIGHT} className="w-full rounded border border-white/10" style={{ imageRendering: "pixelated" }} aria-label={`${panel} skin panel`} />;
}

/** Static until you drag: no spinning, idle animation or reduced-motion surprise. */
export function CarSkinPreview({ appearance, name }: { appearance: TvCarAppearance; name: string }) {
  const host = useRef<HTMLDivElement>(null), control = useRef<PreviewControl | null>(null);
  const latest = useRef(appearance); latest.current = appearance;
  const angle = useRef({ yaw: CAR_SKIN_PREVIEW_VIEWS[0].yaw, pitch: CAR_SKIN_PREVIEW_VIEWS[0].pitch });
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [view, setView] = useState("3/4");

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    // The page lazy-loads this whole component. Static imports inside that
    // lazy chunk let the bundler discard the unused Three.js exports.
    if (!host.current) return;
    const element = host.current;
    let renderer: InstanceType<typeof THREE.WebGLRenderer> | undefined;
    let observer: ResizeObserver | undefined, model: TvCarModel | undefined, disposed = false;
    let removeContextListener = () => {};
    const resources = new Set<{ dispose: () => void }>();
    const keep = <T extends { dispose: () => void }>(resource: T) => { resources.add(resource); return resource; };
    const scene = new THREE.Scene();
    const dispose = () => {
      if (disposed) return;
      disposed = true; observer?.disconnect(); removeContextListener(); model?.dispose();
      resources.forEach(resource => resource.dispose()); resources.clear(); scene.clear();
      renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove();
    };
    cleanup = dispose;
    const failed = () => { dispose(); if (!cancelled) setStatus("unavailable"); };
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
      renderer.domElement.style.cssText = "width:100%;height:100%;display:block;pointer-events:none";
      renderer.domElement.setAttribute("aria-hidden", "true"); element.appendChild(renderer.domElement);
      const camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
      const render = () => {
        if (disposed) return;
        setCarSkinPreviewCamera(camera, angle.current.yaw, angle.current.pitch);
        try { renderer!.render(scene, camera); } catch { failed(); }
      };
      const pmrem = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
      try { const environment = keep(pmrem.fromScene(room, .04)); scene.environment = environment.texture; }
      finally { room.dispose(); pmrem.dispose(); }
      scene.add(new THREE.HemisphereLight("#d5ecff", "#24313b", 2.1));
      const light = new THREE.DirectionalLight("#ffffff", 3); light.position.set(-3, 7, 5); light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024); light.shadow.normalBias = .04; keep(light.shadow); scene.add(light);
      const floor = new THREE.Mesh(keep(new THREE.CircleGeometry(4.3, 64)), keep(new THREE.MeshStandardMaterial({ color: "#101c2b", roughness: .8, metalness: .2 })));
      floor.rotation.x = -Math.PI / 2; floor.position.y = -.03; floor.receiveShadow = true; scene.add(floor);
      const rim = new THREE.Mesh(keep(new THREE.RingGeometry(4.28, 4.33, 64)), keep(new THREE.MeshBasicMaterial({ color: "#31c4cc", transparent: true, opacity: .35, side: THREE.DoubleSide })));
      rim.rotation.x = -Math.PI / 2; rim.position.y = -.025; scene.add(rim);
      const next: PreviewControl = {
        setAppearance(value) {
          if (disposed) return;
          try {
            if (model?.updateSkin(value)) { render(); return; }
            const replacement = createTvCarModel({ appearance: value, maxAnisotropy: renderer!.capabilities.getMaxAnisotropy(), onTextureReady: render });
            model?.dispose(); model = replacement; scene.add(model.root); render();
          } catch { failed(); }
        },
        setAngle(yaw, pitch) { angle.current = { yaw, pitch }; render(); },
        dispose,
      };
      const resize = () => {
        if (disposed) return;
        const width = Math.max(1, element.clientWidth), height = Math.max(1, element.clientHeight);
        renderer!.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); render();
      };
      const contextLost = (event: Event) => { event.preventDefault(); failed(); };
      renderer.domElement.addEventListener("webglcontextlost", contextLost);
      removeContextListener = () => renderer?.domElement.removeEventListener("webglcontextlost", contextLost);
      control.current = next;
      observer = new ResizeObserver(resize); observer.observe(element); resize();
      next.setAppearance(latest.current);
      if (!disposed) setStatus("ready");
    } catch { failed(); }
    return () => { cancelled = true; control.current = null; cleanup(); };
  }, []);

  useEffect(() => { control.current?.setAppearance(appearance); }, [appearance]);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (status !== "ready" || event.button !== 0) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current; if (!start || start.id !== event.pointerId) return;
    const yaw = angle.current.yaw - (event.clientX - start.x) * .012;
    const pitch = Math.max(.05, Math.min(Math.PI / 2 - .001, angle.current.pitch + (event.clientY - start.y) * .009));
    drag.current = { ...start, x: event.clientX, y: event.clientY };
    control.current?.setAngle(yaw, pitch); setView("Custom");
  };
  const stopDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <div data-testid="car-skin-preview" className="overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(ellipse_at_top,#203a53,#08111e_70%)]">
    <div className="flex items-center justify-between gap-3 px-4 pt-4"><div><p className="text-xs font-semibold uppercase tracking-[.22em] text-cyan-300">3D skin preview</p><h3 className="mt-1 font-bold text-white">{name}'s race car</h3></div><span className="text-xs text-slate-400">Same model as the TV</span></div>
    <div className="relative">
      <div ref={host} role="img" aria-label={`${name}'s 3D race car. Drag to rotate, or choose a camera angle below.`} className="h-[300px] w-full cursor-grab touch-none active:cursor-grabbing sm:h-[340px]" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={() => { drag.current = null; }} />
      {status === "loading" && <p role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-300">Building your 3D car…</p>}
      {status === "unavailable" && <div role="status" className="absolute inset-0 overflow-auto p-5"><p className="mb-3 text-sm text-slate-300">3D is unavailable on this device. Your saved skin still works on the TV.</p>{appearance.skin ? <div className="grid grid-cols-3 gap-3">{CAR_SKIN_PANELS.map(({ id, label }) => <div key={id}><FlatPanel appearance={appearance} panel={id} /><p className="mt-1 text-center text-xs text-slate-300">{label}</p></div>)}</div> : <div className="mx-auto h-24 w-44 rounded-2xl border border-white/20" style={{ backgroundColor: appearance.bodyColor }}><p className="pt-9 text-center text-xs font-bold" style={{ color: appearance.accentColor }}>YOUR BASE PAINT</p></div>}</div>}
    </div>
    <div className="flex flex-wrap justify-center gap-1.5 px-3 pb-3">{CAR_SKIN_PREVIEW_VIEWS.map(item => <button key={item.label} type="button" disabled={status !== "ready"} aria-pressed={view === item.label} onClick={() => { control.current?.setAngle(item.yaw, item.pitch); setView(item.label); }} className={`rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${view === item.label ? "border-cyan-300/60 bg-cyan-400/15 text-cyan-100" : "border-white/10 text-slate-300 hover:bg-white/10"}`}>{item.label}</button>)}</div>
    <p className="px-4 pb-4 text-center text-xs text-slate-400">Drag to inspect every panel. The preview stays still until you move it.</p>
  </div>;
}

export default CarSkinPreview;
