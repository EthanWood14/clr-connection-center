import React, { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Check, Download, Eraser, Grid2X2, PaintBucket, Pencil, Pipette, Redo2, RotateCcw, Sparkles, Undo2, Upload } from "lucide-react";
import {
  CAR_SKIN_PANELS, PANEL_WIDTH, PANEL_HEIGHT, createBlankCarSkin, fillCarSkin,
  paintCarSkin, presetCarSkin, sampleCarSkin, type TvCarSkin,
} from "@shared/tv-car-skin";
import {
  downloadTvCarSkin, importTvCarSkinFile, rememberCarSkin, stepCarSkinHistory, type CarSkinHistory,
} from "@/lib/tv-car-skin";

type Panel = keyof TvCarSkin["panels"];
type Tool = "pencil" | "erase" | "fill" | "sample";
const TOOLS = [
  { id: "pencil", label: "Pencil", icon: Pencil }, { id: "erase", label: "Erase", icon: Eraser },
  { id: "fill", label: "Fill", icon: PaintBucket }, { id: "sample", label: "Pick color", icon: Pipette },
] as const;
const checker = "repeating-conic-gradient(#182333 0% 25%,#263447 0% 50%)";
const button = "inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:opacity-40";
const idle = "border-white/15 bg-slate-900 text-slate-200 hover:bg-slate-800";
const active = "border-cyan-300/70 bg-cyan-300/15 text-cyan-100";

export function CarSkinEditor({ skin, onChange, onBusyChange, disabled = false, bodyColor, accentColor }: {
  skin: TvCarSkin; onChange: (skin: TvCarSkin) => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean; bodyColor: string; accentColor: string;
}) {
  const id = useId();
  const [panel, setPanel] = useState<Panel>("top");
  const [tool, setTool] = useState<Tool>("pencil");
  const [slot, setSlot] = useState(0);
  const [brush, setBrush] = useState<1 | 2 | 4>(1);
  const [mirror, setMirror] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [history, setHistory] = useState<CarSkinHistory>({ past: [], future: [] });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Choose a panel, pick a color, and make it yours.");
  const [error, setError] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const current = useRef(skin);
  const historyRef = useRef(history);
  const stroke = useRef<{ original: TvCarSkin; last: { x: number; y: number }; pointerId: number } | null>(null);
  const request = useRef(0);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  const blocked = disabled || busy;
  const panelLabel = CAR_SKIN_PANELS.find(item => item.id === panel)?.label ?? panel;

  useEffect(() => {
    if (JSON.stringify(current.current) !== JSON.stringify(skin)) {
      current.current = skin;
      stroke.current = null;
      const empty = { past: [], future: [] };
      historyRef.current = empty; setHistory(empty);
    }
  }, [skin]);
  useEffect(() => () => { request.current++; busyCallback.current?.(false); }, []);

  function updateHistory(next: CarSkinHistory) { historyRef.current = next; setHistory(next); }
  function publish(next: TvCarSkin) { current.current = next; onChange(next); }
  function commit(next: TvCarSkin, notice?: string) {
    if (JSON.stringify(next) === JSON.stringify(current.current)) return;
    updateHistory(rememberCarSkin(historyRef.current, current.current));
    publish(next); setError(null);
    if (notice) setMessage(notice);
  }
  function travel(direction: "undo" | "redo") {
    if (blocked || stroke.current) return;
    const result = stepCarSkinHistory(historyRef.current, current.current, direction);
    updateHistory(result.history); publish(result.skin);
    setMessage(direction === "undo" ? "Undid the last edit." : "Redid the last edit.");
  }
  function pick(x: number, y: number) {
    const color = sampleCarSkin(current.current, panel, x, y);
    if (color === ".") { setTool("erase"); setMessage("Picked transparency. Eraser selected."); }
    else { setSlot(parseInt(color, 16)); setTool("pencil"); setMessage(`Picked color ${parseInt(color, 16) + 1}.`); }
  }
  function apply(x: number, y: number, record = true) {
    if (tool === "sample") { pick(x, y); return; }
    const color = tool === "erase" ? "." : slot.toString(16);
    let next = tool === "fill"
      ? fillCarSkin(current.current, panel, x, y, color)
      : paintCarSkin(current.current, panel, x, y, color, brush, mirror);
    if (tool === "fill" && mirror) next = fillCarSkin(next, panel, PANEL_WIDTH - x - 1, y, color);
    if (record) commit(next, `${panelLabel} updated.`); else publish(next);
  }
  function atPointer(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(PANEL_WIDTH - 1, Math.floor((event.clientX - rect.left) / rect.width * PANEL_WIDTH))),
      y: Math.max(0, Math.min(PANEL_HEIGHT - 1, Math.floor((event.clientY - rect.top) / rect.height * PANEL_HEIGHT))) };
  }
  function focusCell(x: number, y: number) {
    setCursor({ x, y });
    grid.current?.querySelector<HTMLButtonElement>(`[data-pixel="${x}:${y}"]`)?.focus({ preventScroll: true });
  }
  function beginStroke(event: PointerEvent<HTMLDivElement>) {
    if (blocked || event.button !== 0 || stroke.current) return;
    event.preventDefault();
    const point = atPointer(event);
    focusCell(point.x, point.y);
    if (tool === "sample" || tool === "fill") { apply(point.x, point.y); return; }
    stroke.current = { original: current.current, last: point, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    apply(point.x, point.y, false);
  }
  function moveStroke(event: PointerEvent<HTMLDivElement>) {
    if (blocked || !stroke.current || stroke.current.pointerId !== event.pointerId) return;
    const point = atPointer(event), last = stroke.current.last;
    // Connect sparse pointer samples, so a fast drag never leaves dotted gaps.
    const steps = Math.max(Math.abs(point.x - last.x), Math.abs(point.y - last.y));
    for (let step = 1; step <= steps; step++) apply(Math.round(last.x + (point.x - last.x) * step / steps), Math.round(last.y + (point.y - last.y) * step / steps), false);
    stroke.current.last = point; setCursor(point);
  }
  function endStroke(event: PointerEvent<HTMLDivElement>) {
    if (!stroke.current || stroke.current.pointerId !== event.pointerId) return;
    const original = stroke.current.original;
    stroke.current = null;
    if (JSON.stringify(original) !== JSON.stringify(current.current)) updateHistory(rememberCarSkin(historyRef.current, original));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setMessage(`${panelLabel} stroke finished. Undo removes the whole stroke.`);
  }
  function gridKey(event: KeyboardEvent<HTMLDivElement>) {
    if (blocked) return;
    const target = event.target as HTMLElement;
    const cell = target.dataset.pixel?.split(":").map(Number);
    const point = cell ? { x: cell[0], y: cell[1] } : cursor;
    const movement: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (movement[event.key]) {
      event.preventDefault();
      const [dx, dy] = movement[event.key];
      focusCell(Math.max(0, Math.min(PANEL_WIDTH - 1, point.x + dx)), Math.max(0, Math.min(PANEL_HEIGHT - 1, point.y + dy)));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault(); focusCell(event.key === "Home" ? 0 : PANEL_WIDTH - 1, point.y);
    } else if (event.key === " " || event.key === "Enter") { event.preventDefault(); apply(point.x, point.y); }
  }
  function panelKey(event: KeyboardEvent<HTMLDivElement>) {
    if (blocked || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = CAR_SKIN_PANELS.findIndex(item => item.id === panel);
    const next = event.key === "Home" ? 0 : event.key === "End" ? CAR_SKIN_PANELS.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + CAR_SKIN_PANELS.length) % CAR_SKIN_PANELS.length;
    setPanel(CAR_SKIN_PANELS[next].id);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-panel="${CAR_SKIN_PANELS[next].id}"]`)?.focus();
  }
  async function importFile(file?: File) {
    if (!file || blocked) return;
    const ticket = ++request.current; setBusy(true); busyCallback.current?.(true); setError(null);
    try {
      const imported = await importTvCarSkinFile(file);
      if (ticket !== request.current) return;
      commit(imported, "Skin imported into your draft. Save your car when you're ready.");
    } catch (reason) { if (ticket === request.current) setError(reason instanceof Error ? reason.message : "Could not import that skin."); }
    finally { if (ticket === request.current) { setBusy(false); busyCallback.current?.(false); } }
  }
  async function exportFile(format: "png" | "json") {
    if (blocked) return;
    setError(null);
    try { await downloadTvCarSkin(current.current, format); setMessage(`${format.toUpperCase()} exported. Your saved car is unchanged.`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not export the skin."); }
  }

  return <section className="overflow-hidden rounded-xl border border-cyan-200/20 bg-[#0b1420] text-slate-100" data-testid="car-skin-editor"
    onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); travel(event.shiftKey ? "redo" : "undo"); } }}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-gradient-to-r from-cyan-300/10 to-transparent px-4 py-4">
      <div><p className="text-[10px] font-bold uppercase tracking-[.22em] text-cyan-300">C3 Pixel Workshop</p><h3 className="mt-1 text-lg font-bold">Build your own racing skin</h3></div>
      <span className="rounded border border-white/15 px-2 py-1 font-mono text-[10px] text-slate-400">6 PANELS · 16 COLORS</span>
    </div>
    <div className="space-y-4 p-4">
      <p className="text-xs leading-relaxed text-slate-400">Paint each side of your car, pixel by pixel. Transparent pixels show your body paint. A skin replaces your saved picture wrap until the skin is removed.</p>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Car skin panels" aria-orientation="horizontal" onKeyDown={panelKey}>
        {CAR_SKIN_PANELS.map(item => <button key={item.id} type="button" role="tab" id={`${id}-tab-${item.id}`} data-panel={item.id} aria-selected={panel === item.id} aria-controls={`${id}-panel`} tabIndex={panel === item.id ? 0 : -1} disabled={blocked}
          className={`${button} ${panel === item.id ? active : idle}`} onClick={() => setPanel(item.id)}>{item.label}</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Skin painting tools">
        {TOOLS.map(item => <button key={item.id} type="button" disabled={blocked} aria-pressed={tool === item.id} title={item.label} className={`${button} ${tool === item.id ? active : idle}`} onClick={() => setTool(item.id)}><item.icon className="h-3.5 w-3.5" />{item.label}</button>)}
        <span className="mx-1 h-6 w-px bg-white/15" aria-hidden="true" />
        <button type="button" disabled={blocked || !history.past.length} aria-label="Undo last skin edit" className={`${button} ${idle}`} onClick={() => travel("undo")}><Undo2 className="h-3.5 w-3.5" />Undo</button>
        <button type="button" disabled={blocked || !history.future.length} aria-label="Redo skin edit" className={`${button} ${idle}`} onClick={() => travel("redo")}><Redo2 className="h-3.5 w-3.5" />Redo</button>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
        <label className="flex items-center gap-2">Brush <select disabled={blocked} value={brush} aria-label="Brush size" onChange={event => setBrush(Number(event.target.value) as 1 | 2 | 4)} className="rounded border border-white/20 bg-slate-900 px-2 py-1.5"><option value={1}>1 pixel</option><option value={2}>2 pixels</option><option value={4}>4 pixels</option></select></label>
        <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" disabled={blocked} checked={mirror} onChange={event => setMirror(event.target.checked)} className="accent-cyan-300" />Mirror left / right</label>
        <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" disabled={blocked} checked={showGrid} onChange={event => setShowGrid(event.target.checked)} className="accent-cyan-300" /><Grid2X2 className="h-3.5 w-3.5" />Grid</label>
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${panel}`}>
        <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-slate-400"><span>{panelLabel} · 32 × 16</span><span>Column {cursor.x + 1} · Row {cursor.y + 1}</span></div>
        <div ref={grid} role="grid" aria-label={`${panelLabel} pixel canvas`} aria-rowcount={PANEL_HEIGHT} aria-colcount={PANEL_WIDTH} aria-describedby={`${id}-help`}
          className="touch-none select-none overflow-hidden rounded-md border-2 border-slate-600 shadow-inner" style={{ backgroundImage: checker, backgroundSize: "16px 16px", aspectRatio: "2 / 1" }}
          onPointerDown={beginStroke} onPointerMove={moveStroke} onPointerUp={endStroke} onPointerCancel={endStroke} onLostPointerCapture={endStroke} onKeyDown={gridKey}>
          {Array.from({ length: PANEL_HEIGHT }, (_, y) => <div key={y} role="row" className="grid h-[6.25%] grid-cols-[repeat(32,minmax(0,1fr))]">
            {Array.from({ length: PANEL_WIDTH }, (_, x) => {
              const color = skin.panels[panel][y * PANEL_WIDTH + x], selected = cursor.x === x && cursor.y === y;
              return <button key={x} type="button" role="gridcell" aria-rowindex={y + 1} aria-colindex={x + 1} aria-selected={selected} aria-label={`Row ${y + 1}, column ${x + 1}: ${color === "." ? "transparent" : skin.palette[parseInt(color, 16)]}`}
                data-pixel={`${x}:${y}`} tabIndex={selected ? 0 : -1} disabled={blocked} onFocus={() => setCursor({ x, y })}
                onClick={event => { if (event.detail === 0 && !blocked) apply(x, y); }}
                className={`min-h-0 min-w-0 p-0 focus:relative focus:z-10 focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-white ${showGrid ? "border-r border-b border-black/20" : "border-0"}`}
                style={{ backgroundColor: color === "." ? "transparent" : skin.palette[parseInt(color, 16)], cursor: tool === "sample" ? "crosshair" : "cell" }} />;
            })}
          </div>)}
        </div>
        <p id={`${id}-help`} className="mt-2 text-[11px] leading-relaxed text-slate-400">Drag to paint. Keyboard: arrow keys move, Space or Enter paints, Ctrl / ⌘ Z undoes. Each drag is one undo step.</p>
      </div>
      <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold">Your 16-color palette</p><span className="text-[10px] text-slate-400">Editing a slot recolors every pixel using it.</span></div>
        <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-[repeat(16,minmax(0,1fr))]">
          {skin.palette.map((color, index) => <button key={index} type="button" disabled={blocked} aria-label={`Select color ${index + 1}: ${color}`} aria-pressed={slot === index} className={`relative aspect-square min-h-7 rounded border ${slot === index ? "border-white ring-2 ring-cyan-300 ring-offset-2 ring-offset-slate-950" : "border-white/15"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white`} style={{ backgroundColor: color }} onClick={() => { setSlot(index); if (tool === "erase" || tool === "sample") setTool("pencil"); }}>{slot === index && <Check className="absolute inset-0 m-auto h-4 w-4 rounded bg-black/60 text-white" />}</button>)}
        </div>
        <div className="mt-3 flex items-center gap-3"><label className="flex items-center gap-2 text-xs" htmlFor={`${id}-color`}>Edit color {slot + 1}<input id={`${id}-color`} type="color" disabled={blocked} value={skin.palette[slot]} aria-label={`Edit palette color ${slot + 1}`} onChange={event => { const palette = [...current.current.palette]; palette[slot] = event.target.value; commit({ ...current.current, palette }, `Palette color ${slot + 1} updated.`); }} className="h-8 w-10 cursor-pointer rounded border border-white/20 bg-transparent p-1" /></label><code className="text-xs uppercase text-slate-400">{skin.palette[slot]}</code><span className="ml-auto text-[10px] text-slate-500">Use Erase for transparency</span></div>
      </div>
      <div className="flex flex-wrap items-center gap-2"><span className="mr-1 text-xs text-slate-400"><Sparkles className="mr-1 inline h-3.5 w-3.5" />Start with</span>
        {(["racer", "checker", "flames"] as const).map(name => <button key={name} type="button" disabled={blocked} className={`${button} ${idle} capitalize`} onClick={() => commit(presetCarSkin(name, bodyColor, accentColor), `${name} starter applied. Undo brings your design back.`)}>{name}</button>)}
        <button type="button" disabled={blocked} className={`${button} ${idle}`} onClick={() => commit(createBlankCarSkin(), "Started a transparent skin. Undo brings your design back.")}><RotateCcw className="h-3.5 w-3.5" />Blank</button>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
        <input ref={upload} type="file" accept=".png,.json,image/png,application/json" className="sr-only" tabIndex={-1} aria-label="Import a car skin file" disabled={blocked} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void importFile(file); }} />
        <button type="button" disabled={blocked} className={`${button} ${idle}`} onClick={() => upload.current?.click()}><Upload className="h-3.5 w-3.5" />{busy ? "Importing…" : "Import skin"}</button>
        <button type="button" disabled={blocked} className={`${button} ${idle}`} onClick={() => void exportFile("png")}><Download className="h-3.5 w-3.5" />Export PNG</button>
        <button type="button" disabled={blocked} className={`${button} ${idle}`} onClick={() => void exportFile("json")}><Download className="h-3.5 w-3.5" />Export JSON</button>
        <span className="text-[10px] text-slate-500">PNG template: 64 × 48 · Max 128 KB</span>
      </div>
      <p className="text-[10px] text-slate-500">PNG atlas rows: Top / Left side · Right side / Nose · Rear / Wings. Export JSON to preserve your exact color slots.</p>
      {error && <p role="alert" className="rounded-md border border-rose-300/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
      <p role="status" aria-live="polite" className="text-xs text-cyan-200/90">{message}</p>
      <p className="text-[10px] text-slate-500">These are draft changes. Use the garage's Save button to put your skin on the TV.</p>
    </div>
  </section>;
}

export default CarSkinEditor;
