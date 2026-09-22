import { NeonShop, type ShopResponse } from "@/components/tv/neon-shop";
import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Check, CheckCircle2, Flag, ImagePlus, Loader2, Palette, RotateCcw, Save, ShoppingBag, Trash2, Upload } from "lucide-react";
import { useAuth, type AuthUser } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { defaultTvCarAppearance, isSafeTvCarWrapUrl, normalizeTvCarAppearance, validateTvCarAppearance, type TvCarAppearance } from "@shared/tv-car";
import { prepareTvCarWrap, type PreparedTvCarWrap } from "@/lib/tv-car-wrap";
import { isTvCarParticipant } from "@shared/tv-race-participation";
import { createBlankCarSkin, type TvCarSkin } from "@shared/tv-car-skin";
import { formatTvCarRemaining, TV_CAR_TICK_MS, type TvCarBudget } from "@shared/tv-car-budget";
import { CarSkinEditor } from "@/components/tv/car-skin-editor";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

const CarSkinPreview = lazy(() => import("@/components/tv/car-skin-preview"));

type CarResponse = { appearance: TvCarAppearance; budget?: TvCarBudget };
const COLOR_PRESETS = [
  { name: "Papaya", color: "#ef6a35" },
  { name: "Sky", color: "#49b8ec" },
  { name: "Gold", color: "#f1d552" },
  { name: "Lime", color: "#97d765" },
  { name: "Violet", color: "#a993ff" },
  { name: "Rose", color: "#ef5e84" },
  { name: "Mint", color: "#56d4ba" },
  { name: "Pearl", color: "#f4f2e8" },
  { name: "Navy", color: "#142332" },
];
const LIVERIES: { value: TvCarAppearance["livery"]; label: string; description: string }[] = [
  { value: "stripe", label: "Classic stripe", description: "One bold center line" },
  { value: "double-stripe", label: "Twin stripes", description: "Two racing lines" },
  { value: "solid", label: "Solid", description: "Clean, uninterrupted paint" },
];

function sameAppearance(a: TvCarAppearance, b: TvCarAppearance) {
  return a.bodyColor.toLowerCase() === b.bodyColor.toLowerCase()
    && a.accentColor.toLowerCase() === b.accentColor.toLowerCase()
    && a.livery === b.livery;
}

/** Lightweight top-down paint preview; never starts the TV's animation loop. */
function CarPreview({ appearance, name, picturePreview }: { appearance: TvCarAppearance; name: string; picturePreview?: string }) {
  const id = useId().replace(/:/g, "");
  const { bodyColor, accentColor, livery } = appearance;
  const wrapUrl = picturePreview ?? (isSafeTvCarWrapUrl(appearance.wrapUrl) ? appearance.wrapUrl : undefined);
  return (
    <svg viewBox="0 0 560 300" role="img" aria-label={`${name}'s race car with ${livery} paint style${wrapUrl ? " and a custom picture wrap" : ""}`} className="w-full drop-shadow-2xl" data-testid="tv-car-preview">
      <defs>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity=".4" />
          <stop offset=".45" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity=".28" />
        </linearGradient>
        <clipPath id={`${id}-paint`}>
          <path d="M116 108 Q125 97 166 96 L232 100 L275 118 L421 134 Q445 137 445 150 Q445 163 421 166 L275 182 L232 200 L166 204 Q125 203 116 192 Z" />
        </clipPath>
      </defs>
      <ellipse cx="282" cy="164" rx="205" ry="85" fill="#000000" opacity=".3" />
      <g stroke="#101923" strokeWidth="4" strokeLinejoin="round">
        <path d="M149 85 L149 215 M394 86 L394 214" stroke="#72828c" strokeWidth="9" />
        {[126, 374].map(x => <g key={x}>
          <rect x={x} y="58" width="47" height="50" rx="10" fill="#10151c" stroke="#47505a" />
          <rect x={x} y="192" width="47" height="50" rx="10" fill="#10151c" stroke="#47505a" />
          <path d={`M${x + 8} 67h31m-31 31h31m-31 103h31m-31 31h31`} stroke="#606771" strokeWidth="2" />
        </g>)}
        <rect x="93" y="81" width="26" height="138" rx="5" fill={bodyColor} />
        <rect x="94" y="82" width="8" height="136" rx="3" fill="#273745" stroke="none" />
        <rect x="429" y="90" width="23" height="120" rx="5" fill={bodyColor} />
        <rect x="445" y="92" width="7" height="116" rx="2" fill="#273745" stroke="none" />
        <path d="M116 108 Q125 97 166 96 L232 100 L275 118 L421 134 Q445 137 445 150 Q445 163 421 166 L275 182 L232 200 L166 204 Q125 203 116 192 Z" fill={bodyColor} />
        <g clipPath={`url(#${id}-paint)`} stroke="none">
          {wrapUrl && <image href={wrapUrl} x="116" y="96" width="329" height="108" preserveAspectRatio="xMidYMid slice" data-testid="tv-car-wrap-preview" />}
          {livery === "stripe" && <rect x="115" y="140" width="332" height="20" fill={accentColor} />}
          {livery === "double-stripe" && <>
            <rect x="115" y="133" width="332" height="10" fill={accentColor} />
            <rect x="115" y="157" width="332" height="10" fill={accentColor} />
          </>}
          <rect x="110" y="90" width="340" height="120" fill={`url(#${id}-shine)`} />
        </g>
        <path d="M184 112 L230 119 L253 133 L253 167 L230 181 L184 188 Z" fill="#182d3b" />
        <path d="M226 123 L249 137 L249 163 L226 177" fill="#52758a" stroke="none" />
        <ellipse cx="213" cy="150" rx="17" ry="19" fill={accentColor} />
        <path d="M216 135 L228 139 L228 160 L216 164" fill="#1c2836" strokeWidth="2" />
        <path d="M238 124 Q270 150 238 176 M263 150 H282" fill="none" stroke="#aab9c4" strokeWidth="5" />
      </g>
    </svg>
  );
}

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const id = useId();
  const valid = /^#[0-9a-f]{6}$/i.test(value);
  return (
    <div className="space-y-3">
      <Label htmlFor={`${id}-hex`} className="text-sm font-semibold">{label}</Label>
      <div className="flex flex-wrap gap-2" role="group" aria-label={`${label} presets`}>
        {COLOR_PRESETS.map(preset => (
          <button
            key={preset.color} type="button" aria-label={`${label}: ${preset.name}`} title={preset.name}
            aria-pressed={value.toLowerCase() === preset.color}
            onClick={() => onChange(preset.color)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-black/20 shadow-sm transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            style={{ backgroundColor: preset.color }}
          >
            {value.toLowerCase() === preset.color && <Check className="h-5 w-5 rounded-full bg-black/70 p-0.5 text-white" />}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <input type="color" aria-label={`Choose custom ${label.toLowerCase()}`} value={valid ? value : "#142332"} onChange={event => onChange(event.target.value)} className="h-10 w-12 cursor-pointer rounded-md border bg-transparent p-1" />
        <Input id={`${id}-hex`} value={value} onChange={event => onChange(event.target.value)} maxLength={7} spellCheck={false} aria-invalid={!valid} aria-describedby={`${id}-hint`} className="max-w-[150px] font-mono text-sm uppercase" />
        <span className="text-xs text-muted-foreground">Custom color</span>
      </div>
      <p id={`${id}-hint`} className={valid ? "sr-only" : "text-xs text-destructive"}>Use a six-digit hex color, such as #49B8EC.</p>
    </div>
  );
}

function Garage({ user }: { user: AuthUser }) {
  const queryKey = ["/api/me/tv-car", user.orgId, user.id];
  const car = useQuery<CarResponse>({ queryKey, queryFn: () => apiRequest("GET", "/api/me/tv-car"), retry: 1 });
  // A draft stays separate from query data: background refreshes must not erase paint edits.
  const [draft, setDraft] = useState<TvCarAppearance | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [garageMode, setGarageMode] = useState<"skin" | "paint" | "shop">("skin");
  const [blankSkin] = useState(createBlankCarSkin);
  const [skinDraft, setSkinDraft] = useState<TvCarSkin | null>(null);
  const [skinNotice, setSkinNotice] = useState<string | null>(null);
  const [preparingSkin, setPreparingSkin] = useState(false);
  const [skinEditorEpoch, setSkinEditorEpoch] = useState(0);
  // Fifteen minutes a day in here, then it locks (shared/tv-car-budget.ts).
  // The server is the authority; this is the copy the page draws from, and
  // every save hands back a fresh one so the lock lands the moment it is due.
  const [budget, setBudget] = useState<TvCarBudget | null>(null);
  const [preparedWrap, setPreparedWrap] = useState<PreparedTvCarWrap | null>(null);
  const [preparingWrap, setPreparingWrap] = useState(false);
  const [wrapError, setWrapError] = useState<string | null>(null);
  const [wrapNotice, setWrapNotice] = useState<string | null>(null);
  const pictureInputId = useId();
  const pictureRequest = useRef(0);
  // Only cancel obsolete image decoding on unmount; never reseed paint from a refetch.
  useEffect(() => () => { pictureRequest.current += 1; }, []);
  const saved = normalizeTvCarAppearance(car.data?.appearance, user.id);
  const appearance = draft ?? saved;
  const preview = normalizeTvCarAppearance({ ...appearance, upgrades: saved.upgrades ?? [] }, user.id);
  const dirty = draft !== null && !sameAppearance(draft, saved);
  const valid = validateTvCarAppearance({ bodyColor: appearance.bodyColor, accentColor: appearance.accentColor, livery: appearance.livery }) !== null;
  const takeBudget = (result: CarResponse | undefined) => { if (result?.budget) setBudget(result.budget); };
  const save = useMutation<CarResponse, Error, TvCarAppearance>({
    mutationFn: next => apiRequest("PATCH", "/api/me/tv-car", {
      bodyColor: next.bodyColor, accentColor: next.accentColor, livery: next.livery,
    }),
    onMutate: () => queryClient.cancelQueries({ queryKey, exact: true }),
    onSuccess: data => {
      takeBudget(data);
      queryClient.setQueryData(queryKey, data);
      setDraft(null);
      setSavedNotice(true);
    },
  });
  const wrap = useMutation<CarResponse, Error, { action: "upload"; picture: PreparedTvCarWrap } | { action: "remove" }>({
    mutationFn: async change => {
      if (change.action === "remove") return apiRequest("DELETE", "/api/me/tv-car/wrap");
      const response = await fetch("/api/me/tv-car/wrap", {
        method: "POST", credentials: "include", headers: { "Content-Type": "image/png" }, body: change.picture.blob,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Your picture could not be uploaded. Please try again.");
      return result as CarResponse;
    },
    onMutate: async () => {
      setWrapError(null); setWrapNotice(null); setSavedNotice(false);
      await queryClient.cancelQueries({ queryKey, exact: true });
    },
    onSuccess: (data, change) => {
      takeBudget(data);
      queryClient.setQueryData(queryKey, data);
      // Uploading a picture is independent of unsaved paint. Keep those color
      // edits while adopting the server's new (or removed) image reference.
      setDraft(current => current ? { ...current, wrapUrl: data.appearance.wrapUrl } : null);
      setPreparedWrap(null);
      setWrapNotice(change.action === "upload" ? "Picture wrap saved. It will show on TV after the next refresh." : "Picture wrap removed. Your paint and stripes are unchanged.");
    },
  });
  const skinSave = useMutation<CarResponse, Error, TvCarSkin | null>({
    mutationFn: next => next ? apiRequest("PUT", "/api/me/tv-car/skin", { skin: next }) : apiRequest("DELETE", "/api/me/tv-car/skin"),
    onMutate: async () => { setSkinNotice(null); await queryClient.cancelQueries({ queryKey, exact: true }); },
    onSuccess: (data, next) => {
      takeBudget(data);
      queryClient.setQueryData(queryKey, data);
      setDraft(current => current ? { ...current, skin: data.appearance.skin } : null);
      setSkinDraft(null);
      setSkinEditorEpoch(epoch => epoch + 1);
      setSkinNotice(next ? "Skin saved. Your TV car will wear it after the next refresh." : "Pixel skin removed. Your saved paint and picture wrap are back.");
    },
  });
  const shopQueryKey = ["/api/me/tv-car/shop", user.orgId, user.id];
  const shop = useQuery<ShopResponse>({
    queryKey: shopQueryKey,
    queryFn: () => apiRequest("GET", "/api/me/tv-car/shop"),
    retry: 1,
  });
  const [shopNotice, setShopNotice] = useState<string | null>(null);
  const buy = useMutation<any, Error, string>({
    mutationFn: (itemId) => apiRequest("POST", "/api/me/tv-car/shop/buy", { itemId }),
    onMutate: async () => { setShopNotice(null); await queryClient.cancelQueries({ queryKey: shopQueryKey, exact: true }); },
    onSuccess: (data) => {
      if (data?.shop) queryClient.setQueryData(shopQueryKey, data.shop);
      if (data?.appearance || data?.budget) {
        queryClient.setQueryData(queryKey, (current: CarResponse | undefined) => ({
          appearance: data.appearance ?? current?.appearance ?? saved,
          budget: data.budget ?? current?.budget,
        }));
        if (data?.budget) setBudget(data.budget);
      }
      setShopNotice(data?.message ?? "Purchased.");
      void shop.refetch();
      void car.refetch();
    },
  });
  const equip = useMutation<any, Error, { itemId: string; equipped: boolean }>({
    mutationFn: input => apiRequest("POST", "/api/me/tv-car/shop/equip", input),
    onMutate: async () => {
      setShopNotice(null);
      await Promise.all([queryClient.cancelQueries({ queryKey: shopQueryKey, exact: true }), queryClient.cancelQueries({ queryKey, exact: true })]);
    },
    onSuccess: data => {
      queryClient.setQueryData(shopQueryKey, data.shop);
      queryClient.setQueryData(queryKey, (current: CarResponse | undefined) => ({ ...current, appearance: data.appearance }));
      setDraft(current => current ? { ...current, upgrades: data.appearance.upgrades ?? [] } : null);
      setShopNotice(data.message);
    },
  });
  const liveBudget = budget ?? car.data?.budget ?? null;
  const locked = liveBudget?.locked ?? false;
  // A tick only while the tab is actually in front: time spent on a call with
  // the garage open behind the dialer is not time spent in the garage.
  useEffect(() => {
    if (locked) return;
    let stopped = false;
    const tick = () => {
      if (stopped || document.visibilityState !== "visible") return;
      void apiRequest("POST", "/api/me/tv-car/time")
        .then((result: any) => { if (!stopped && result?.budget) setBudget(result.budget); })
        .catch(() => {});
    };
    tick();
    const timer = window.setInterval(tick, TV_CAR_TICK_MS);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [locked]);
  const busy = locked || save.isPending || wrap.isPending || preparingWrap || skinSave.isPending || preparingSkin || buy.isPending;
  const editingSkin = skinDraft ?? saved.skin ?? blankSkin;
  const skinDirty = skinDraft !== null && JSON.stringify(skinDraft) !== JSON.stringify(saved.skin ?? blankSkin);
  const hasUnsaved = dirty || skinDirty || !!preparedWrap;
  useEffect(() => {
    if (!hasUnsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsaved]);

  async function choosePicture(file: File | undefined) {
    if (!file) return;
    const request = ++pictureRequest.current;
    setPreparingWrap(true); setPreparedWrap(null); setWrapError(null); setWrapNotice(null); wrap.reset();
    try {
      const picture = await prepareTvCarWrap(file);
      if (request === pictureRequest.current) setPreparedWrap(picture);
    } catch (error) {
      if (request === pictureRequest.current) setWrapError(error instanceof Error ? error.message : "Could not open this picture. Please try another file.");
    } finally {
      if (request === pictureRequest.current) setPreparingWrap(false);
    }
  }

  function update(next: Partial<TvCarAppearance>) {
    setDraft(current => ({ ...(current ?? saved), ...next }));
    setSavedNotice(false);
    save.reset();
  }

  if (car.isLoading) return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6" aria-busy="true" aria-label="Loading your TV car">
      <Skeleton className="h-10 w-56" /><Skeleton className="h-72 w-full" /><Skeleton className="h-48 w-full" />
    </div>
  );
  if (!car.data) return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Could not open your garage</AlertTitle>
        <AlertDescription>{car.error?.message ?? "Your car could not be loaded. Please try again."}</AlertDescription>
      </Alert>
      <Button variant="outline" className="mt-4" onClick={() => car.refetch()} disabled={car.isFetching}>Try again</Button>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-6" data-testid="tv-car-garage">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="mb-1 text-xs font-semibold uppercase tracking-[.2em] text-muted-foreground">Advanced Settings / Personal</p>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">My TV Car</h1>
          <p className="mt-2 text-sm text-muted-foreground">Your spot on the grid. Build a pixel skin, paint your car, add a picture wrap, or spend earned stats in the garage shop.</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge variant="outline" className="gap-1.5 px-3 py-1.5"><Flag className="h-3.5 w-3.5" /> C3 Grand Prix</Badge>
          {liveBudget && !locked && (
            <Badge variant="secondary" className="gap-1.5 px-3 py-1.5" data-testid="tv-car-time-left">
              Garage time: {formatTvCarRemaining(liveBudget.remaining)}
            </Badge>
          )}
        </div>
      </div>

      {locked && (
        <Alert data-testid="tv-car-locked">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Your garage is closed for today</AlertTitle>
          <AlertDescription>
            Everyone gets 15 minutes a day in here. Yours is used up, so your car is locked until tomorrow —
            it keeps whatever you last saved and still races on the wall. Come back in the morning to change it.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Garage workspace">
        <Button type="button" variant={garageMode === "skin" ? "default" : "outline"} aria-pressed={garageMode === "skin"} onClick={() => setGarageMode("skin")}>Pixel skin studio{skinDirty ? " •" : ""}</Button>
        <Button type="button" variant={garageMode === "paint" ? "default" : "outline"} aria-pressed={garageMode === "paint"} onClick={() => setGarageMode("paint")}>Paint & pictures{dirty || preparedWrap ? " •" : ""}</Button>
        <Button type="button" variant={garageMode === "shop" ? "default" : "outline"} aria-pressed={garageMode === "shop"} onClick={() => setGarageMode("shop")} data-testid="tv-car-shop-tab"><ShoppingBag className="mr-1.5 h-4 w-4" />Garage shop{(shop.data?.owned?.length ?? 0) > 0 ? ` · ${shop.data?.owned?.length}` : ""}</Button>
      </div>

      {garageMode === "skin" && <section className="grid items-start gap-5 xl:grid-cols-[minmax(300px,.78fr)_minmax(0,1.22fr)]" aria-label="Pixel skin studio">
        <div className="space-y-4 xl:sticky xl:top-5">
          <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 text-slate-100">
            <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3"><span className="text-xs font-semibold uppercase tracking-widest">Your car · Live 3D</span><Badge variant="outline" className="border-white/20 text-slate-200">{skinDirty ? "Unsaved skin" : saved.skin ? "Saved skin" : "Start painting"}</Badge></div>
            <Suspense fallback={<div className="flex h-80 items-center justify-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Opening the garage…</div>}><CarSkinPreview appearance={{ ...saved, skin: editingSkin }} name={user.name} /></Suspense>
            <div className="space-y-2 border-t border-white/10 px-4 py-4"><p className="font-semibold">{user.name}</p><p className="text-xs leading-relaxed text-slate-400">Drag to rotate. This is the same car used on the TV track. Each painted panel has its own place on the model.</p></div>
          </div>
          <div className="rounded-xl border bg-muted/25 p-4 text-xs leading-relaxed text-muted-foreground">
            <p>Like a pixel skin editor: choose a panel, pick a color, then paint. Transparent pixels show your saved body color. Your helmet keeps its accent color.</p>
            <p className="mt-2">Saving a skin hides—but does not delete—your picture wrap and racing stripes. Remove the skin to bring them back.</p>
            {dirty && <p className="mt-2 font-medium text-amber-700 dark:text-amber-300">You also have unsaved paint. Save it in Paint & pictures to use it underneath your skin.</p>}
          </div>
        </div>
        <div className="min-w-0 space-y-4">
          <CarSkinEditor key={skinEditorEpoch} skin={editingSkin} onChange={next => { setSkinDraft(next); setSkinNotice(null); skinSave.reset(); }} disabled={busy} onBusyChange={setPreparingSkin} bodyColor={saved.bodyColor} accentColor={saved.accentColor} />
          {skinSave.isError && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Your skin was not saved</AlertTitle><AlertDescription>{skinSave.error.message} Your draft is still here.</AlertDescription></Alert>}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
            <p role="status" aria-live="polite" className="max-w-sm text-xs text-muted-foreground">{skinNotice ?? (skinDirty ? "Preview only — save your skin to put it on the TV." : "Pixel skins are cosmetic. Your stats stay unchanged.")}</p>
            <div className="flex flex-wrap gap-2">
              {skinDirty && <Button type="button" variant="ghost" disabled={busy} onClick={() => { setSkinDraft(null); setSkinNotice(null); skinSave.reset(); setSkinEditorEpoch(epoch => epoch + 1); }}>Discard skin edits</Button>}
              <Button type="button" onClick={() => skinSave.mutate(editingSkin)} disabled={!skinDirty || busy} data-testid="save-tv-car-skin">{skinSave.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save skin</Button>
            </div>
          </div>
          {saved.skin && <AlertDialog><AlertDialogTrigger asChild><Button type="button" variant="outline" disabled={busy} data-testid="remove-tv-car-skin"><Trash2 className="mr-2 h-4 w-4" />Remove pixel skin</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Return to paint and pictures?</AlertDialogTitle><AlertDialogDescription>This removes your saved pixel skin and any unsaved skin edits. Export it first if you want a copy. Your body color, stripes, and saved picture wrap stay intact.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep skin</AlertDialogCancel><AlertDialogAction onClick={() => skinSave.mutate(null)}>Remove skin</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}
        </div>
      </section>}

      {garageMode === "paint" && <div className="grid items-start gap-6 lg:grid-cols-[1.05fr_1fr]">
        <section className="overflow-hidden rounded-2xl border border-slate-700 bg-[#101b2b] text-slate-100 shadow-lg lg:sticky lg:top-6" aria-label="Car preview">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-5 py-4">
            <span className="text-xs font-semibold uppercase tracking-[.18em] text-slate-300">Garage preview</span>
            <span className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-slate-200">{preparedWrap ? "Picture preview — not uploaded" : dirty ? "Unsaved paint" : "Current design"}</span>
          </div>
          <div className="relative px-4 py-10" style={{ backgroundImage: "radial-gradient(ellipse at center, #33445e 0%, #142132 55%, #101b2b 100%)" }}>
            <div className="absolute inset-x-7 top-1/2 border-t border-dashed border-white/10" aria-hidden="true" />
            <div className="relative">{preparedWrap ? <CarPreview appearance={preview} name={user.name} picturePreview={preparedWrap?.previewUrl} /> : <Suspense fallback={<Skeleton className="h-64 w-full" />}><CarSkinPreview appearance={preview} name={user.name} /></Suspense>}</div>
          </div>
          <div className="flex items-center gap-3 border-t border-white/10 px-5 py-5">
            <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: preview.bodyColor }} />
            <div className="min-w-0"><p className="truncate font-semibold">{user.name}</p><p className="mt-0.5 text-xs text-slate-400">{LIVERIES.find(item => item.value === appearance.livery)?.label} · TV race appearance</p></div>
          </div>
          <p className="px-5 pb-5 text-xs leading-relaxed text-slate-400">{saved.skin ? "A pixel skin is currently active on TV. This panel previews your saved paint and pictures underneath it; remove the skin in Pixel skin studio to reveal them." : "Your picture covers the body panels; your paint stays on the wings and your stripes stay on top. The TV car uses the same picture on its 3D panels."}</p>
        </section>

        <form className="space-y-5" onSubmit={event => { event.preventDefault(); if (dirty && valid && !busy && !preparedWrap) save.mutate(appearance); }}>
          <fieldset disabled={busy} className="min-w-0 space-y-5 disabled:opacity-70">
            <Card>
              <CardHeader className="pb-4"><CardTitle className="flex items-center gap-2 text-base"><ImagePlus className="h-4 w-4" /> Custom picture wrap</CardTitle><CardDescription>Add a photo, logo, or pattern to your car’s body.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <Label htmlFor={pictureInputId}>{saved.wrapUrl ? "Replace your picture" : "Choose a picture"}</Label>
                <Input id={pictureInputId} type="file" accept="image/png,image/jpeg,image/webp" aria-describedby={`${pictureInputId}-help ${pictureInputId}-status`} aria-invalid={!!wrapError} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void choosePicture(file); }} data-testid="tv-car-wrap-file" />
                <p id={`${pictureInputId}-help`} className="text-xs leading-relaxed text-muted-foreground">PNG, JPG, or WebP up to 8 MB. We resize to fit (up to 1024 × 1024). Wide pictures work well; the preview shows the body crop. Upload saves the picture immediately; paint changes save separately.</p>
                <div id={`${pictureInputId}-status`} role="status" aria-live="polite" className="text-xs text-muted-foreground">
                  {preparingWrap ? "Preparing your picture…" : preparedWrap ? `${preparedWrap.name} · ${preparedWrap.width} × ${preparedWrap.height} · Preview only until you upload.` : wrapNotice ?? (saved.wrapUrl ? "Your saved picture is on the car." : "No picture wrap yet. Your paint and stripes are still available.")}
                </div>
                {preparedWrap && <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={() => wrap.mutate({ action: "upload", picture: preparedWrap })} data-testid="upload-tv-car-wrap"><Upload className="mr-2 h-4 w-4" />{wrap.isPending ? "Uploading…" : "Upload wrap"}</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setPreparedWrap(null); setWrapError(null); wrap.reset(); }}>Discard picture</Button>
                </div>}
                {saved.wrapUrl && !preparedWrap && <Button type="button" variant="outline" size="sm" onClick={() => wrap.mutate({ action: "remove" })} data-testid="remove-tv-car-wrap"><Trash2 className="mr-2 h-3.5 w-3.5" />{wrap.isPending ? "Removing…" : "Remove picture wrap"}</Button>}
                {(wrapError || wrap.isError) && <p role="alert" className="text-sm text-destructive">{wrapError || wrap.error?.message} Your paint choices are kept; please try again.</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-5"><CardTitle className="flex items-center gap-2 text-base"><Palette className="h-4 w-4" /> Paint shop</CardTitle><CardDescription>Start with a favorite or mix your own.</CardDescription></CardHeader>
              <CardContent className="space-y-6">
                <ColorPicker label="Body color" value={appearance.bodyColor} onChange={bodyColor => update({ bodyColor })} />
                <div className="border-t" />
                <ColorPicker label="Accent color" value={appearance.accentColor} onChange={accentColor => update({ accentColor })} />
                <p className="text-xs leading-relaxed text-muted-foreground">Accent colors finish your helmet and racing stripes. Solid paint keeps the helmet accent.</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-4"><CardTitle className="text-base">Paint style</CardTitle><CardDescription>Pick the finish for your race car.</CardDescription></CardHeader>
              <CardContent><div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-label="Paint style">
                {LIVERIES.map(livery => (
                  <button type="button" key={livery.value} aria-pressed={appearance.livery === livery.value} onClick={() => update({ livery: livery.value })} className={`rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${appearance.livery === livery.value ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"}`}>
                    <span className="relative mb-3 block h-7 overflow-hidden rounded-md border border-black/15" style={{ backgroundColor: preview.bodyColor }} aria-hidden="true">
                      {livery.value === "stripe" && <span className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2" style={{ backgroundColor: preview.accentColor }} />}
                      {livery.value === "double-stripe" && <><span className="absolute inset-y-0 left-[38%] w-1.5" style={{ backgroundColor: preview.accentColor }} /><span className="absolute inset-y-0 right-[38%] w-1.5" style={{ backgroundColor: preview.accentColor }} /></>}
                    </span>
                    <span className="block text-xs font-semibold">{livery.label}</span><span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">{livery.description}</span>
                  </button>
                ))}
              </div></CardContent>
            </Card>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => update(defaultTvCarAppearance(user.id))}><RotateCcw className="mr-2 h-3.5 w-3.5" /> Reset paint to defaults</Button>
              {dirty && <Button type="button" variant="ghost" size="sm" onClick={() => { setDraft(null); setSavedNotice(false); save.reset(); }}>Discard changes</Button>}
            </div>
          </fieldset>

          {save.isError && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Your changes were not saved</AlertTitle><AlertDescription>{save.error.message} Your draft is still here; try saving again.</AlertDescription></Alert>}
          {car.isError && car.data && <p className="text-xs text-destructive" role="status">Could not refresh your saved design. Your current draft has been kept.</p>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="text-xs text-muted-foreground" role="status" aria-live="polite">
              {preparedWrap ? "Upload or discard your picture before saving paint." : savedNotice ? <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" /> Saved. Your car is ready for TV.</span> : dirty ? "Unsaved paint changes — save when you’re ready." : "Your saved car is ready for the grid."}
            </div>
            <Button type="submit" disabled={!dirty || !valid || busy || !!preparedWrap} data-testid="save-tv-car">
              {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}{save.isPending ? "Saving…" : "Save my car"}
            </Button>
          </div>
        </form>
      </div>}
      {garageMode === "shop" && <div className="space-y-4">
        <Card><CardHeader><CardTitle>Your equipped car</CardTitle><CardDescription>Use Equip on car or Unequip below. Parts save immediately, with no extra charge.</CardDescription></CardHeader>
          <CardContent><Suspense fallback={<Skeleton className="h-64 w-full" />}><CarSkinPreview appearance={saved} name={user.name} /></Suspense></CardContent>
        </Card>
        <NeonShop
        data={shop.data} loading={shop.isLoading} error={shop.isError ? shop.error.message : undefined}
        purchaseError={equip.isError ? equip.error.message : buy.isError ? buy.error.message : undefined} notice={shopNotice}
        pendingId={equip.isPending ? equip.variables.itemId : buy.isPending ? buy.variables : undefined} onEquip={(itemId, equipped) => equip.mutate({ itemId, equipped })} onBuy={id => buy.mutate(id)} onRetry={() => { void shop.refetch(); }}
      /></div>}
      <p className="flex items-start gap-2 rounded-xl border bg-muted/30 px-4 py-3 text-xs leading-relaxed text-muted-foreground"><Flag className="mt-0.5 h-4 w-4 shrink-0" /> This is a cosmetic change only. Your transfers, race position, speed, and ranking stay exactly the same. Resetting colors also needs Save my car.</p>
    </div>
  );
}

export default function TvCar() {
  const { user } = useAuth();
  const canCustomize = isTvCarParticipant(user);
  if (!canCustomize || !user) return (
    <div className="mx-auto max-w-3xl p-4 md:p-6"><Alert><Flag className="h-4 w-4" /><AlertTitle>My TV Car is for C3 race participants</AlertTitle><AlertDescription>Sign in with your active C3 race-participant account to customize your own race car.</AlertDescription></Alert></div>
  );
  // Keep cached data and unsaved edits isolated when an impersonated account changes.
  return <Garage key={`${user.orgId}:${user.id}`} user={user} />;
}
