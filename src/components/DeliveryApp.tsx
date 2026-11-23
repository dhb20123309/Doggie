// 外卖 App：店铺列表 → 选品下单（送到 TA 那里 / 包装成礼物）→ 订单历史；礼物精选直接下单
import { useState } from "react";
import { ChevronLeft, Coffee, CupSoda, Flower2, Gift, Heart, History, IceCreamCone, MapPin, Minus, Moon, Pizza, Plus, Salad, ShoppingBag, Star, Store, UtensilsCrossed, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCharacters } from "@/lib/chat-store";
import { displayName, type Character } from "@/lib/chat-types";
import { readWallet, walletUserSend } from "@/lib/wallet-store";
import { SHOPS, GIFTS, useDeliveryOrders, addDeliveryOrder, orderItemsText, type Shop, type MenuItem } from "@/lib/delivery-store";

interface Props {
  /** 从聊天页进入时预选的角色 id */
  charId?: string;
  onBack: () => void;
  /** 下单成功：把订单卡发到该角色会话；goChat=true 时顺带跳回聊天页 */
  onSend: (charId: string, order: { kind: "delivery" | "gift"; shop: string; items: { name: string; qty: number; price: number }[]; amount: number; note?: string }, goChat: boolean) => void;
}

type View = "list" | "shop" | "history";
type Mode = "delivery" | "gift";

const INK = "text-[oklch(0.36_0.045_80)]";
const SUB = "text-[oklch(0.5_0.04_80)]";

/** 店铺 emoji → lucide 图标（沙箱/部分设备缺 emoji 字体时仍可靠渲染） */
const SHOP_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  yidian: CupSoda, jizha: Pizza, maocai: UtensilsCrossed, riliao: Salad, tianpin: IceCreamCone, shaokao: Pizza, shuiguo: Salad, coffee: Coffee,
};
function ShopIcon({ id, className }: { id: string; className?: string }) {
  const C = SHOP_ICON[id] ?? ShoppingBag;
  return <C className={className} />;
}

/** 礼物 emoji → lucide 图标 */
const GIFT_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  g1: Gift, g2: Coffee, g3: IceCreamCone, g4: Salad, g5: Star, g6: Heart, g7: Flower2, g8: Moon,
};
function GiftIcon({ id, className }: { id: string; className?: string }) {
  const C = GIFT_ICON[id] ?? Gift;
  return <C className={className} />;
}

export function DeliveryApp({ charId, onBack, onSend }: Props) {
  const [characters] = useCharacters();
  const [view, setView] = useState<View>("list");
  const [shopId, setShopId] = useState<string | null>(null);
  const [tab, setTab] = useState<"takeout" | "gift">("takeout");
  const [orders] = useDeliveryOrders();
  const [whoIdx, setWhoIdx] = useState(() => {
    const i = characters.findIndex((c) => c.id === charId);
    return i >= 0 ? i : 0;
  });
  const target = characters[Math.min(whoIdx, characters.length - 1)];
  const balance = readWallet().userBalance;

  const pickShop = (shop: Shop) => <ShopOrder key={shop.id} shop={shop} target={target} balance={balance} onBack={() => setView("list")} onSend={onSend} />;

  if (view === "history") {
    return (
      <div className="flex h-full flex-col bg-[oklch(0.97_0.02_85)]">
        <Header title="订单记录" onBack={() => setView("list")} />
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {orders.length === 0 ? (
            <p className={`pt-16 text-center text-xs ${SUB}`}>还没有下过单，去给 TA 点杯奶茶吧～</p>
          ) : (
            <ol className="space-y-2">
              {orders.map((o) => (
                <li key={o.id} className="glass rounded-2xl px-3.5 py-2.5 shadow-sm">
                  <div className="flex items-center gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#f7b267]/25 to-[#e56b6f]/25 text-[#d1545a]">{o.kind === "gift" ? <Gift className="size-4" /> : <UtensilsCrossed className="size-4" />}</span>
                    <span className={`min-w-0 flex-1 truncate text-[12px] font-semibold ${INK}`}>{o.shopName}</span>
                    <span className="text-[12px] font-bold text-orange-500">¥{o.amount.toFixed(2)}</span>
                  </div>
                  <p className={`mt-1 truncate text-[10.5px] ${SUB}`}>{o.kind === "gift" ? "礼物 · " : ""}{o.itemsText} → 送给 {o.to}</p>
                  <p className="mt-0.5 text-[9.5px] text-muted-foreground">{new Date(o.at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 已送达</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    );
  }

  if (view === "list") {
    return (
      <div className="flex h-full flex-col bg-[oklch(0.97_0.02_85)]">
        <Header title="饿了么恋人" onBack={onBack} action={<button type="button" onClick={() => setView("history")} aria-label="订单记录" className="jelly-icon text-muted-foreground hover:text-foreground"><History className="size-4" /></button>} />
        {/* 送达对象选择 */}
        <div className="glass mx-3 mt-2 flex items-center gap-2 rounded-2xl px-3 py-2">
          <MapPin className="size-3.5 shrink-0 text-primary" />
          <span className={`shrink-0 text-[10.5px] ${SUB}`}>送到</span>
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
            {characters.map((c, i) => (
              <button key={c.id} type="button" onClick={() => setWhoIdx(i)} className={`jelly-btn shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-medium ${i === whoIdx ? "bg-primary text-primary-foreground" : "bg-white/70 " + SUB}`}>
                {displayName(c)}
              </button>
            ))}
          </div>
          <span className="shrink-0 text-[9.5px] text-muted-foreground">余额 ¥{balance.toFixed(0)}</span>
        </div>
        {/* 外卖 / 礼物 页签 */}
        <div className="mx-3 mt-2 flex gap-1.5">
          {([["takeout", "点外卖", UtensilsCrossed], ["gift", "送礼物", Gift]] as const).map(([k, label, Icon]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`jelly-btn flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-[12px] font-semibold ${tab === k ? "bg-gradient-to-br from-[#f7b267] to-[#e56b6f] text-white shadow-md" : "glass " + INK}`}>
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {tab === "takeout" ? (
            <ul className="space-y-2.5">
              {SHOPS.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => { setShopId(s.id); setView("shop"); }} className="jelly-btn glass flex w-full items-center gap-3 rounded-2xl p-2.5 text-left shadow-sm transition-transform active:scale-[0.98]">
                    <span className="flex size-14 shrink-0 items-center justify-center rounded-xl text-white/95" style={{ background: `linear-gradient(135deg, ${s.grad[0]}, ${s.grad[1]})` }}><ShopIcon id={s.id} className="size-7" /></span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-[13px] font-bold ${INK}`}>{s.name}</span>
                      <span className={`mt-0.5 block text-[10px] ${SUB}`}><Star className="mr-0.5 inline size-2.5 fill-amber-400 text-amber-400" />{s.rating} · 月售 {s.sales.replace("月售 ", "")} · {s.category}</span>
                      <span className="mt-0.5 block text-[10px] text-orange-500">约 {s.eta} 分钟送达</span>
                    </span>
                    <ShoppingBag className="size-4 shrink-0 text-primary/60" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="grid grid-cols-2 gap-2.5">
              {GIFTS.map((g) => (
                <li key={g.id}>
                  <button type="button" disabled={!target} onClick={() => sendGift(g.id)} className="jelly-btn glass flex h-full w-full flex-col rounded-2xl p-3 text-left shadow-sm active:scale-[0.98]">
                    <span className="flex size-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#f7b267]/25 to-[#e56b6f]/25 text-[#d1545a]"><GiftIcon id={g.id} className="size-6" /></span>
                    <span className={`mt-1.5 text-[12px] font-bold ${INK}`}>{g.name}</span>
                    <span className={`mt-0.5 text-[9.5px] ${SUB}`}>{g.desc}</span>
                    <span className="mt-2 flex items-center justify-between">
                      <span className="text-[13px] font-bold text-orange-500">¥{g.price}</span>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[9.5px] text-primary">送出</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  if (view === "shop" && shopId) {
    const shop = SHOPS.find((s) => s.id === shopId);
    if (!shop) return null;
    return <ShopOrder shop={shop} target={target} balance={balance} onBack={() => setView("list")} onSend={onSend} />;
  }

  function sendGift(id: string) {
    if (!target) return;
    const g = GIFTS.find((x) => x.id === id)!;
    const ok = walletUserSend(target.id, g.price, `礼物·${g.name}`, displayName(target));
    if (!ok) { alert("零花钱不够啦，先去设置里看看余额吧"); return; }
    addDeliveryOrder({ id: `d${Date.now()}`, at: Date.now(), shopName: g.name, emoji: g.emoji, itemsText: `${g.name}x1`, amount: g.price, to: displayName(target), kind: "gift" });
    onSend(target.id, { kind: "gift", shop: g.name, items: [{ name: g.name, qty: 1, price: g.price }], amount: g.price, note: "给你的小惊喜" }, true);
  }
}

/* ---------- 店内点单（与父组件紧耦合，内联本文件） ---------- */
function ShopOrder({ shop, target, balance, onBack, onSend }: { shop: Shop; target?: Character; balance: number; onBack: () => void; onSend: Props["onSend"] }) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<Mode>("delivery");
  const [note, setNote] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const items = Object.entries(cart).filter(([, q]) => q > 0);
  const total = Math.round(items.reduce((n, ent) => n + (shop.menu.find((m) => m.id === ent[0])?.price ?? 0) * ent[1], 0) * 100) / 100;
  const eta = shop.eta;
  const bump = (m: MenuItem, d: number) => setCart((c) => ({ ...c, [m.id]: Math.max(0, (c[m.id] ?? 0) + d) }));

  const submit = () => {
    if (!target || items.length === 0) return;
    const picked = items.map((ent) => { const m = shop.menu.find((x) => x.id === ent[0])!; return { name: m.name, qty: ent[1], price: m.price }; });
    if (!walletUserSend(target.id, total, mode === "gift" ? "礼物·" + shop.name : `外卖·${shop.name}`, displayName(target))) {
      alert("零花钱不够啦");
      return;
    }
    addDeliveryOrder({ id: `d${Date.now()}`, at: Date.now(), shopName: shop.name, emoji: shop.emoji, itemsText: orderItemsText(picked), amount: total, to: displayName(target), kind: mode });
    onSend(target.id, { kind: mode, shop: shop.name, items: picked, amount: total, note: note.trim() || undefined }, true);
  };

  return (
    <div className="relative flex h-full flex-col bg-[oklch(0.97_0.02_85)]">
      <Header title={shop.name} onBack={onBack} />
      {/* 店招 */}
      <div className="mx-3 mt-2 flex items-center gap-3 rounded-2xl p-3 text-white shadow-md" style={{ background: `linear-gradient(135deg, ${shop.grad[0]}, ${shop.grad[1]})` }}>
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/20"><ShopIcon id={shop.id} className="size-6" /></span>
        <div className="min-w-0">
          <p className="text-[14px] font-bold">{shop.name}</p>
          <p className="mt-0.5 flex items-center text-[10.5px] opacity-90"><Star className="mr-1 inline size-2.5 fill-white" />{shop.rating} · {shop.sales} · 约 {eta} 分钟送达</p>
        </div>
      </div>
      <ul className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {shop.menu.map((m) => {
          const q = cart[m.id] ?? 0;
          return (
            <li key={m.id} className="glass flex items-center gap-2.5 rounded-2xl px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className={`truncate text-[12.5px] font-semibold ${INK}`}>{m.name}{m.tag && <span className="ml-1.5 rounded bg-orange-100 px-1 py-0.5 align-middle text-[8.5px] font-normal text-orange-500">{m.tag}</span>}</p>
                <p className="mt-0.5 text-[12px] font-bold text-orange-500">¥{m.price}</p>
              </div>
              {q > 0 && (
                <button type="button" onClick={() => bump(m, -1)} aria-label="减少" className="jelly-icon flex size-6 items-center justify-center rounded-full border border-border bg-white text-muted-foreground"><Minus className="size-3" /></button>
              )}
              {q > 0 && <span className={`w-4 text-center text-[12px] font-bold tabular-nums ${INK}`}>{q}</span>}
              <button type="button" onClick={() => bump(m, 1)} aria-label="增加" className="jelly-icon flex size-6 items-center justify-center rounded-full bg-gradient-to-br from-[#f7b267] to-[#e56b6f] text-white"><Plus className="size-3" /></button>
            </li>
          );
        })}
      </ul>
      {/* 结算条 */}
      <div className="glass-strong mx-2 mb-3 flex items-center gap-2 rounded-2xl px-3 py-2 shadow-lg">
        <span className="text-[11px] text-muted-foreground">{items.length ? `共 ${items.reduce((n, ent) => n + ent[1], 0)} 件` : "未选购"}</span>
        <span className="text-[15px] font-bold text-orange-500">¥{total.toFixed(2)}</span>
        <button type="button" disabled={!items.length} onClick={() => setSheetOpen(true)} className="jelly-btn ml-auto rounded-xl bg-gradient-to-br from-[#f7b267] to-[#e56b6f] px-4 py-2 text-[12px] font-bold text-white disabled:opacity-40">
          立即下单
        </button>
      </div>
      {/* 下单方式弹层 */}
      {sheetOpen && (
        <div className="absolute inset-0 z-[60] flex items-end bg-black/40" onClick={() => setSheetOpen(false)}>
          <div className="drawer-panel w-full rounded-t-3xl bg-white p-4 pb-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <p className={`text-[13px] font-bold ${INK}`}>送给 {target ? displayName(target) : "TA"}</p>
              <button type="button" onClick={() => setSheetOpen(false)} aria-label="关闭" className="jelly-icon text-muted-foreground"><X className="size-4" /></button>
            </div>
            <div className="mt-3 flex gap-2">
              {([["delivery", "点外卖直达", UtensilsCrossed], ["gift", "包装成礼物", Gift]] as const).map(([k, label, Icon]) => (
                <button key={k} type="button" onClick={() => setMode(k)} className={`jelly-btn flex flex-1 items-center justify-center gap-1 rounded-xl border py-2 text-[11.5px] font-semibold ${mode === k ? "border-orange-400 bg-orange-50 text-orange-500" : "border-border bg-white text-muted-foreground"}`}><Icon className="size-3.5" />{label}</button>
              ))}
            </div>
            <Input value={note} onChange={(e) => setNote(e.target.value.slice(0, 20))} maxLength={20} placeholder={mode === "gift" ? "随礼附一句（可选）" : "备注：不要香菜之类的（可选）"} className="mt-2.5 h-9 rounded-xl bg-muted/40 text-[12px]" />
            <p className="mt-2 text-[10.5px] text-muted-foreground">
              {orderItemsText(items.map((ent) => ({ name: shop.menu.find((m) => m.id === ent[0])!.name, qty: ent[1] })))}
            </p>
            <button type="button" onClick={submit} disabled={!target} className="jelly-btn mt-3 h-10 w-full rounded-xl bg-gradient-to-br from-[#f7b267] to-[#e56b6f] text-[13px] font-bold text-white disabled:opacity-40">
              支付 ¥{total.toFixed(2)} 并发送{total > balance ? "（余额不足）" : ""}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Header({ title, onBack, action }: { title: string; onBack: () => void; action?: React.ReactNode }) {
  return (
    <div className="glass-nav flex items-center justify-between px-2 py-2">
      <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onBack} aria-label="返回">
        <ChevronLeft className="size-5" />
      </Button>
      <span className={`flex items-center gap-1.5 text-sm font-semibold ${INK}`}><Store className="size-3.5 text-primary" />{title}</span>
      <div className="flex min-w-8 justify-end">{action ?? null}</div>
    </div>
  );
}
