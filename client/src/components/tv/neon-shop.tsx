import { useId, useState } from "react";
import { ArrowUpRight, Check, Clock3, Loader2, MessageSquare, Phone, Radio, Search, Sparkles, Trophy } from "lucide-react";
import { SHOP_TIERS, formatShopBalance, shopCurrencyLabel, shopHatLook, shopPassengerLook, type ShopBalances, type ShopCurrency, type ShopItem, type ShopTier } from "@shared/tv-car-shop";
import "./neon-shop.css";

export type ShopResponse = {
  catalog: Array<ShopItem & { owned: boolean; equipped: boolean; affordable: boolean; priceLabel: string; resale?: { amount: number; currency: ShopCurrency; receipt: string } | null; timesPurchased?: number }>;
  balances: ShopBalances; earned: ShopBalances; spent: ShopBalances; owned: string[]; garageDailySeconds?: number;
};
const currencies: ShopCurrency[] = ["dialpad_calls", "texts", "calltools_seconds", "transfers"];
const icons = { dialpad_calls: Phone, texts: MessageSquare, calltools_seconds: Clock3, transfers: Trophy };
const colors = { Street: "#80a8bd", Rare: "#47e6ff", Epic: "#b68aff", Legendary: "#ffcd69" };

export function NeonItemArt({ item }: { item: ShopItem }) {
  const id = useId().replace(/:/g, "");
  const c = item.preview.to, motif = item.preview.motif;
  return <svg viewBox="0 0 280 160" role="img" aria-label={`${item.name} preview`} className="neon-item-art" data-testid="tv-car-shop-preview">
    <defs>
      <radialGradient id={id}><stop stopColor={c} stopOpacity=".25"/><stop offset="1" stopColor="#080d1c" stopOpacity="0"/></radialGradient>
      <filter id={`${id}g`} x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="4"/></filter>
      <linearGradient id={`${id}metal`} x2=".8" y2="1"><stop stopColor="#748099"/><stop offset=".4" stopColor="#252f46"/><stop offset="1" stopColor="#101827"/></linearGradient>
    </defs>
    <ellipse cx="140" cy="90" rx="125" ry="75" fill={`url(#${id})`}/>
    <g stroke={c} opacity=".13"><path d="M0 130H280M0 145H280M50 160L110 90M230 160L170 90M140 160V90"/></g>
    <ellipse cx="140" cy="132" rx="83" ry="8" fill={c} opacity=".25" filter={`url(#${id}g)`}/>
    {motif === "rims" ? <g>{[102,179].map((x,i)=><g key={x} transform={`translate(${x} ${i ? 80 : 91})`}>
      <ellipse rx="38" ry="44" fill="#090d16" stroke="#26324b" strokeWidth="9"/>
      <ellipse rx="29" ry="35" fill="none" stroke={c} strokeWidth="3"/>
      {[0,60,120,180,240,300].map(r=><path key={r} d="M0 0L9 -28L0 -33Z" fill={`url(#${id}metal)`} stroke={c} strokeWidth=".7" transform={`rotate(${r})`}/>)}
      <circle r="8" fill={c}/></g>)}</g>
    : motif === "passenger" ? (() => {
      // Drawn from the same look table the 3D model reads, so a new character
      // is a row of data rather than another branch in this chain.
      const look = shopPassengerLook(item.id);
      if (!look) return <g><ellipse cx="138" cy="112" rx="42" ry="26" fill={c}/><circle cx="142" cy="75" r="28" fill={c}/></g>;
      const headY = look.neck ? 49 : 75;
      const face = look.head ?? look.body;
      return <g>
        <ellipse cx="138" cy="112" rx="42" ry="26" fill={look.body}/>
        {look.neck && <path d={`M136 109V${headY + 12}`} stroke={look.body} strokeWidth="17"/>}
        {look.fin && <path d="M112 96L96 62L126 84Z" fill={look.fin}/>}
        {look.ears && (look.pointedEars
          ? <g fill={look.ears}><path d={`M124 ${headY - 24}L118 ${headY - 52}L142 ${headY - 30}Z`}/><path d={`M160 ${headY - 24}L172 ${headY - 50}L176 ${headY - 22}Z`}/></g>
          : <g fill={look.ears}><circle cx="122" cy={headY - 24} r="11"/><circle cx="163" cy={headY - 24} r="11"/></g>)}
        {look.hair && <g fill={look.hair}><circle cx="113" cy={headY - 4} r="14"/><circle cx="172" cy={headY - 4} r="14"/></g>}
        <circle cx="142" cy={headY} r="28" fill={face}/>
        {look.patches && <g fill={look.patches}><ellipse cx="132" cy={headY - 5} rx="9" ry="11"/><ellipse cx="154" cy={headY - 5} rx="9" ry="11"/></g>}
        {look.beak && <path d={look.neck ? "M160 48L193 59L160 65Z" : "M160 74L197 87L161 94Z"} fill={look.beak}/>}
        {look.antenna && <g stroke="#8d97a3" strokeWidth="4"><path d={`M142 ${headY - 28}V${headY - 46}`}/><circle cx="142" cy={headY - 52} r="7" fill={look.antenna} stroke="none"/></g>}
        {look.eyes === "visor"
          ? <rect x="119" y={headY - 10} width="49" height="15" rx="6" fill="#111a30"/>
          : <g fill="#101827"><ellipse cx="134" cy={headY - 5} rx={look.eyes === "big" ? 10 : 4} ry={look.eyes === "big" ? 14 : 4}/><ellipse cx="154" cy={headY - 5} rx={look.eyes === "big" ? 10 : 4} ry={look.eyes === "big" ? 14 : 4}/></g>}
        {look.nose && <circle cx="144" cy={headY + 12} r="8" fill={look.nose}/>}
        {look.wave && <path d="M171 112L192 78" stroke={look.body} strokeWidth="13" strokeLinecap="round"/>}
      </g>;
    })()
    : motif === "hat" ? (() => {
      const look = shopHatLook(item.id);
      const crown = look?.crown ?? c, band = look?.band ?? c;
      return <g>
        {/* A head to wear it on, so the shape reads at tile size. */}
        <circle cx="140" cy="108" r="30" fill="#2a3448"/>
        {look?.shape === "cone" ? <>
          <path d="M140 18L168 80H112Z" fill={crown}/><circle cx="140" cy="16" r="9" fill={band}/>
        </> : look?.shape === "wide" ? <>
          <ellipse cx="140" cy="78" rx="64" ry="12" fill={crown}/>
          <path d="M116 78Q118 36 140 34Q162 36 164 78Z" fill={crown}/>
          <rect x="116" y="64" width="48" height="10" fill={band}/>
        </> : look?.shape === "points" ? <>
          <rect x="112" y="58" width="56" height="20" rx="4" fill={crown}/>
          <g fill={band}>{[0, 1, 2, 3].map(n => <path key={n} d={`M${114 + n * 17} 58L${122 + n * 17} 34L${130 + n * 17} 58Z`}/>)}</g>
        </> : <>
          <ellipse cx="140" cy="78" rx="52" ry="10" fill={crown}/>
          <rect x="116" y="22" width="48" height="56" fill={crown}/>
          <rect x="116" y="62" width="48" height="12" fill={band}/>
        </>}
      </g>;
    })()
    : motif === "wing" ? <g fill={`url(#${id}metal)`} stroke={c} strokeWidth="3">
      {item.id==="angel-wing"?<>{[-1,1].map(side=><g key={side} transform={`translate(140 110) scale(${side} 1)`}>{[0,1,2,3,4].map(n=><path key={n} d={`M0 0Q${30+n*14} ${-80+n*8} ${53+n*13} ${-61+n*12}L${24+n*7} 8Z`} fill={c}/>)}</g>)}</>:<><path d="M96 120V83M185 120V75"/><path d={item.id==="ducktail-spoiler"?"M59 101L214 87L225 107L72 122Z":"M48 66L216 46L237 66L67 89Z"}/>{item.id==="double-decker-wing"&&<path d="M48 97L216 77L237 97L67 120Z"/>}</>}
    </g>
    : motif === "body" ? <g stroke={c} strokeWidth="2">
      {item.id.includes("stock")?<><path d={item.id.includes("80s")?"M45 98L95 92L110 53L172 53L199 88L238 94V124H45Z":"M42 107L87 90Q135 25 191 82L239 98L232 124H44Z"} fill={`url(#${id}metal)`}/><path d="M111 86L123 63H169L189 86Z" fill={c} opacity=".6"/></>:<><path d={item.id.includes("60s")?"M44 108Q112 69 199 98L240 115L63 126Z":"M42 113L69 79L108 84L136 67L167 78L197 108L246 115L227 126H51Z"} fill={`url(#${id}metal)`}/>{!item.id.includes("60s")&&<path d="M44 69H93M223 120H252" strokeWidth="8"/>}</>}
      {[79,205].map(x=><circle key={x} cx={x} cy="119" r="18" fill="#0a1020" strokeWidth="6"/>)}
    </g>
    : motif === "garage" ? <g fill="none" stroke={c} strokeWidth="3"><circle cx="140" cy="79" r="40" strokeDasharray="170 80"/><path d="M140 47V80L159 91"/><text x="140" y="141" textAnchor="middle" fill={c} stroke="none" fontSize="16" fontWeight="800">+5 MINUTES</text></g>
    : motif === "fin" ? <g><path d="M95 123L129 43L177 115L191 125Z" fill={`url(#${id}metal)`} stroke={c} strokeWidth="2"/><path d="M129 43L139 24L149 56L163 38L171 96" fill="none" stroke={c} strokeWidth="4"/></g>
    : motif === "exhaust" ? <g>{[105,177].map(x=><g key={x}><path d={`M${x-24} 68l15-24h35l10 55-12 23h-40z`} fill={`url(#${id}metal)`}/><ellipse cx={x} cy="98" rx="23" ry="29" fill="#080d1c" stroke={c} strokeWidth="5"/><ellipse cx={x} cy="98" rx="11" ry="16" fill={c} opacity=".8"/></g>)}</g>
    : <g>
      {motif === "plume" && <g stroke={c} strokeWidth="4" opacity=".8"><path d="M35 85L108 94M18 102L101 104M28 120L113 115"/></g>}
      {motif === "underglow" && <ellipse cx="151" cy="117" rx="87" ry="14" fill="none" stroke={c} strokeWidth="5"/>}
      <path d="M66 95L103 77L171 71L197 89L224 99L220 114L77 125L59 113Z" fill={`url(#${id}metal)`} stroke="#6d829e" strokeWidth="1.5"/>
      <path d="M112 79L169 76L188 91L110 99Z" fill={motif === "cabin" ? c : "#0c172c"} stroke={c} strokeWidth="1.5"/>
      <ellipse cx="90" cy="119" rx="16" ry="18" fill="#080b13" stroke="#44516b" strokeWidth="4"/>
      <ellipse cx="201" cy="108" rx="16" ry="18" fill="#080b13" stroke="#44516b" strokeWidth="4"/>
      {motif === "headlights" && <path d="M217 96L238 87M221 103L253 101" stroke={c} strokeWidth="5"/>}
      {motif === "hood" && <path d="M66 91L68 71L119 66L120 76L64 83" fill={c} opacity=".8"/>}
      {motif === "number" && <text x="145" y="115" fill={c} fontSize="19" fontWeight="900">01</text>}
      {motif === "rain-light" && <path d="M65 104L76 108" stroke={c} strokeWidth="7"/>}
      {motif === "mirrors" && <path d="M112 87L96 84M180 83L192 77" stroke={c} strokeWidth="5"/>}
    </g>}
    <path d="M16 30V16H30M250 16H264V30M16 130V144H30M250 144H264V130" fill="none" stroke={c} opacity=".5"/>
  </svg>;
}

export function NeonShop({ data, loading, error, purchaseError, notice, pendingId, onBuy, onEquip, onSell, onRetry }: {
  data?: ShopResponse; loading: boolean; error?: string; purchaseError?: string; notice: string | null;
  pendingId?: string; onBuy: (id: string) => void; onEquip: (id: string, equipped: boolean) => void; onSell: (id: string, receipt: string) => void; onRetry: () => void;
}) {
  const [selling, setSelling] = useState<string | null>(null);
  const [category, setCategory] = useState("all");
  const [tier, setTier] = useState<ShopTier | "All">("All");
  const [currency, setCurrency] = useState<ShopCurrency | "all">("all");
  const [collection, setCollection] = useState("all");
  const [search, setSearch] = useState("");
  const items = (data?.catalog ?? []).filter(i => (category === "all" || i.preview.motif === category) && (tier === "All" || i.tier === tier) && (currency === "all" || i.currency === currency) && (collection === "all" || (collection === "owned" ? i.owned : i.affordable)) && `${i.name} ${i.description}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="neon-shop" aria-label="Garage shop" data-testid="tv-car-shop">
    <div className="neon-shop-hero">
      <div><p className="neon-eyebrow"><Radio size={13}/> C3 CUSTOMS / ITEM SHOP</p><h2>Earn your glow.</h2><p className="neon-intro">Every call. Every text. Every hour. Every transfer.<br/>Your all-time work fuels your next upgrade.</p><div className="neon-hero-tags"><span><Sparkles size={14}/> 4 tiers to collect</span><span><Check size={14}/> {data?.owned.length ?? 0} upgrades owned</span></div></div>
      <div className="neon-feature"><span className="neon-eyebrow">THE LEGENDARY COLLECTION</span>{data?.catalog.find(i=>i.id==='prism-rims') && <NeonItemArt item={data.catalog.find(i=>i.id==='prism-rims')!}/>}<strong>Built to stand out.</strong><span>Prism wheels · Solar crown · Hyperdrive</span></div>
    </div>
    <div className="neon-wallet" data-testid="tv-car-shop-balances">{currencies.map(c=>{const Icon=icons[c];return <div key={c}><p><Icon size={15}/>{shopCurrencyLabel(c)}</p><strong>{loading ? "…" : data ? formatShopBalance(c,data.balances[c]) : "—"}</strong><span>Available to spend</span><small>All-time: {data ? formatShopBalance(c,data.earned[c]) : "—"}</small><small>Spent: {data ? formatShopBalance(c,data.spent[c]) : "—"}</small></div>})}</div>
    <div className="neon-shop-body">
      <div className="neon-section-heading"><div><p className="neon-eyebrow">THE UPGRADE COLLECTION</p><h3>Pick your next flex.</h3></div><span>{items.length} items</span></div>
      <div className="neon-tier-tabs" role="group" aria-label="Item tier">{(["All",...SHOP_TIERS] as const).map(t=><button key={t} type="button" aria-pressed={tier===t} onClick={()=>setTier(t)} style={{"--tier":t==='All'?'#eff7ff':colors[t]} as React.CSSProperties}>{t==='All'?'All tiers':t}<span>{t==='All'?'✦':t==='Street'?'I':t==='Rare'?'II':t==='Epic'?'III':'IV'}</span></button>)}</div>
      <div className="neon-filters"><label className="neon-search"><Search size={16}/><input aria-label="Search upgrades" placeholder="Find your upgrade…" value={search} onChange={e=>setSearch(e.target.value)}/></label><select aria-label="Part category" value={category} onChange={e=>setCategory(e.target.value)}><option value="all">All parts</option><option value="body">Car bodies</option><option value="wing">Wings & spoilers</option><option value="passenger">Passengers</option><option value="hat">Hats</option></select><select aria-label="Currency" value={currency} onChange={e=>setCurrency(e.target.value as typeof currency)}><option value="all">All currencies</option>{currencies.map(c=><option key={c} value={c}>{shopCurrencyLabel(c)}</option>)}</select><select aria-label="Collection" value={collection} onChange={e=>setCollection(e.target.value)}><option value="all">All items</option><option value="affordable">Ready to buy</option><option value="owned">My collection</option></select></div>
      {error && <div role="alert" className="neon-error">Shop could not load. {error} <button type="button" onClick={onRetry}>Try again</button></div>}
      {purchaseError && <p role="alert" className="neon-error">Shop update failed: {purchaseError}</p>}
      {notice && <p role="status" className="neon-notice">{notice}</p>}
      {loading ? <p role="status" className="neon-loading"><Loader2 className="animate-spin"/> Loading your all-time balances…</p> : <div className="neon-item-grid">{items.map(item=>{
        const balance=data?.balances[item.currency]??0, owned=item.owned&&!item.consumable;
        const progress=Math.min(100,balance/item.price*100), need=Math.max(0,item.price-balance);
        return <article key={item.id} className="neon-item" style={{"--tier":colors[item.tier]} as React.CSSProperties} data-testid={`tv-car-shop-item-${item.id}`}>
          <div className="neon-item-top"><span>{item.tier}</span><span>{owned?<><Check size={12}/> Owned</>:item.consumable?'REBUYABLE':'COLLECTIBLE'}</span></div>
          <NeonItemArt item={item}/><div className="neon-item-copy"><h4>{item.name}</h4><p>{item.description}</p></div>
          <div className="neon-item-bottom"><strong>{item.priceLabel}</strong><div className="neon-progress" aria-label={`${Math.round(progress)}% of price available`}><i style={{width:`${owned?100:progress}%`}}/></div><small>{owned?(item.equipped?'Equipped on your race car':'Owned · ready to equip'):need>0?`${formatShopBalance(item.currency,need)} to go`:`After purchase: ${formatShopBalance(item.currency,balance-item.price)}`}</small>
          <button type="button" disabled={(!owned&&!item.affordable)||!!pendingId||!!error} onClick={()=>owned?onEquip(item.id,!item.equipped):onBuy(item.id)} data-testid={`${owned?"equip":"buy"}-tv-car-shop-${item.id}`} aria-pressed={owned?item.equipped:undefined}>
            {pendingId===item.id?<><Loader2 size={15} className="animate-spin"/>Saving…</>:owned?<><Check size={15}/> {item.equipped?"Unequip":"Equip on car"}</>:item.affordable?<>{item.consumable?'Buy +5 min boost':'Unlock upgrade'}<ArrowUpRight size={15}/></>:'Keep earning'}
          </button>
          {owned&&item.resale&&<div className="neon-resale">{selling===item.id?<><small>Sell {item.name}? It leaves your collection and car.</small><button type="button" disabled={!!pendingId} onClick={()=>{onSell(item.id,item.resale!.receipt);setSelling(null);}}>Confirm sale · {formatShopBalance(item.resale.currency,item.resale.amount)}</button><button type="button" disabled={!!pendingId} onClick={()=>setSelling(null)}>Keep item</button></>:<button type="button" disabled={!!pendingId||!!error} onClick={()=>setSelling(item.id)}>Sell for {formatShopBalance(item.resale.currency,item.resale.amount)}</button>}</div>}
          </div>
        </article>})}</div>}
      {!loading&&!error&&items.length===0&&<p className="neon-loading">No upgrades match. Try another tier or filter.</p>}
      <footer>All-time earnings minus net shop spending. Sell owned cosmetics for half the price you paid, refunded in the original currency (rounded down). Used garage boosts cannot be sold. Purchases never reduce your performance stats. Equip owned parts to choose your look. Equipping a variant replaces the current part in that slot. Unequipped parts stay in your collection. Unequip a car body to return to the original shape. Garage boosts add 5 minutes for today only.{data?.garageDailySeconds ? ` Today's garage allowance: ${Math.round(data.garageDailySeconds/60)} minutes.`:''}</footer>
    </div>
  </section>;
}
