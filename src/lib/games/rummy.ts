// 拉密（Rummikub）：106张数字牌(1-13×4色+2鬼)。摆出组(同数3-5色/同色连续≥3)即可，先出完手牌胜。支持 2-5 人。
import type { GameSpec, GAction, GView } from "./types";
import { shuffle, randInt } from "./types";

type RCard = { id: string; num: number; suit: number }; // suit 0-3, -1=鬼
type S = { hands: RCard[][]; table: RCard[][]; deck: RCard[]; turn: number; over: boolean; winner: number; plies: number; seats: number };
const SUIT_CH = ["🔴", "🟡", "🔵", "⚫"];
const label = (c: RCard) => (c.suit < 0 ? "★鬼" : SUIT_CH[c.suit] + c.num);
const seatName = (seat: number) => (seat === 0 ? "你" : seat === 1 ? "TA" : `小机 ${seat - 1}`);

function validGroup(g: RCard[]): boolean {
  if (g.length < 3) return false;
  const wilds = g.filter((c) => c.suit < 0).length, real = g.filter((c) => c.suit >= 0);
  if (real.length === 0) return g.length <= 5;
  if (new Set(real.map((c) => c.suit)).size === real.length && new Set(real.map((c) => c.num)).size === 1) return g.length <= 5;
  if (new Set(real.map((c) => c.suit)).size === 1) {
    const ns = [...new Set(real.map((c) => c.num))].sort((a, b) => a - b);
    if (ns[ns.length - 1] - ns[0] !== ns.length - 1) return false;
    return ns.length + wilds === g.length && g.length <= 5 && ns[0] >= 1 && ns[ns.length - 1] <= 13;
  }
  return false;
}

const spec: GameSpec<S> = {
  id: "rummy",
  name: "拉密",
  category: "card",
  players: "2-5人",
  ruleSummary: "凑同色顺子或异色同数(≥3张)摆到桌面，先出完手牌赢",
  simplified: "本版本采用简化规则：每人12张；每回合只能新摆一组合法牌（不拆重组桌面）；无牌可摆则摸一张过牌；牌堆空后比手牌少者胜。",
  undoable: false,
  maxTurns: 160,
  minSeats: 2,
  maxSeats: 5,
  create: (seatsRaw, rng) => {
    const seats = Math.max(2, Math.min(5, Math.floor(seatsRaw || 2)));
    const cards: RCard[] = []; let n = 0;
    for (let s = 0; s < 4; s++) for (let k = 1; k <= 13; k++) cards.push({ id: `r${n++}`, num: k, suit: s });
    cards.push({ id: `r${n++}`, num: 0, suit: -1 }, { id: `r${n++}`, num: 0, suit: -1 });
    const d = shuffle(cards, rng);
    return { hands: Array.from({ length: seats }, (_, i) => d.slice(i * 12, i * 12 + 12)), table: [], deck: d.slice(seats * 12), turn: 0, over: false, winner: -1, plies: 0, seats };
  },
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over) return [];
    const acts: GAction[] = [];
    const hand = s.hands[s.turn];
    // 枚举所有3-5张组合找合法组（限规模：按同num/同suit分组内取）
    const byNum = new Map<number, RCard[]>(), bySuit = new Map<string, RCard[]>();
    for (const c of hand) {
      if (c.suit >= 0) { if (!byNum.has(c.num)) byNum.set(c.num, []); byNum.get(c.num)!.push(c); }
      const k = `${c.suit}`;
      if (!bySuit.has(k)) bySuit.set(k, []);
      bySuit.get(k)!.push(c);
    }
    for (const [, g] of byNum) if (g.length >= 3) for (let i = 0; i < g.length - 2; i++) acts.push({ kind: "lay", s: JSON.stringify(g.slice(i, i + 3).map((c) => c.id)), label: g.slice(i, i + 3).map(label).join(" ") });
    for (const [sk, g] of bySuit) {
      if (sk === "-1") continue;
      const sorted = g.sort((a, b) => a.num - b.num);
      for (let len = 3; len <= Math.min(5, sorted.length); len++) {
        for (let i = 0; i + len <= sorted.length; i++) {
          const seg = sorted.slice(i, i + len);
          if (seg[seg.length - 1].num - seg[0].num === len - 1 && new Set(seg.map((c) => c.num)).size === len) acts.push({ kind: "lay", s: JSON.stringify(seg.map((c) => c.id)), label: seg.map(label).join(" ") });
        }
      }
    }
    // 带鬼补组：任意2真+1鬼 / 顺子断点补鬼——简化为鬼并入已有候选
    const wilds = hand.filter((c) => c.suit < 0);
    if (wilds.length) {
      const uniq = new Map(acts.map((a) => [a.s, a]));
      for (const w of wilds) for (const c of hand) {
        if (c.suit < 0) continue;
        const same = hand.filter((x) => x.suit >= 0 && x.num === c.num && x.id !== c.id).slice(0, 2);
        if (same.length >= 2) { const ids = [c.id, ...same.map((x) => x.id), w.id]; const key = JSON.stringify(ids); if (!uniq.has(key) && validGroup(ids.map((id) => hand.find((h) => h.id === id)!))) { uniq.set(key, { kind: "lay", s: key, label: ids.map((id) => label(hand.find((h) => h.id === id)!)).join(" ") }); } }
      }
      acts.length = 0; acts.push(...uniq.values());
    }
    acts.push({ kind: "draw", label: "摸牌" });
    return acts;
  },
  apply: (s, a) => {
    if (s.over) return null;
    const hands = s.hands.map((h) => h.slice());
    let table = s.table.map((g) => g.slice()), deck = s.deck.slice(), over = false, winner = -1;
    if (a.kind === "lay" && a.s) {
      const ids = JSON.parse(a.s) as string[];
      const group = hands[s.turn].filter((c) => ids.includes(c.id));
      if (group.length !== ids.length || !validGroup(group)) return null;
      hands[s.turn] = hands[s.turn].filter((c) => !ids.includes(c.id));
      table.push(group);
      if (!hands[s.turn].length) { over = true; winner = s.turn; }
    } else if (a.kind === "draw") {
      if (deck.length) hands[s.turn].push(deck.shift()!);
      else {
        over = true;
        let best = 0;
        for (let i = 1; i < s.seats; i++) if (hands[i].length < hands[best].length) best = i;
        const minLen = hands[best].length;
        winner = hands.filter((h) => h.length === minLen).length > 1 ? -1 : best;
      }
    } else return null;
    return { ...s, hands, table, deck, turn: (s.turn + 1) % s.seats, over, winner, plies: s.plies + 1 };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === -1 ? "draw" : s.winner === seat ? "win" : "lose"),
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    const lays = acts.filter((a) => a.kind === "lay");
    if (lays.length && Math.random() < 0.9) {
      let best = lays[0], bn = 0;
      for (const l of lays) { const n = (JSON.parse(l.s!) as string[]).length; if (n > bn) { bn = n; best = l; } }
      return best;
    }
    return acts.find((a) => a.kind === "draw") ?? acts[randInt(Math.random, acts.length)];
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.hands) && o.hands.length >= 2 && o.hands.length === (o.seats ?? o.hands.length) ? o : null; },
  view: (s) => ({
    kind: "cards",
    hands: s.hands.map((h, i) => ({ seat: i, cards: h.map((c) => ({ id: c.id, token: String(c.suit), label: label(c) })) })),
    tableCards: s.table.flat().map((c) => ({ id: c.id, token: String(c.suit), label: label(c) })),
    notes: [`桌面 ${s.table.length} 组 · 牌堆 ${s.deck.length} · ${s.seats}人局 · 你剩 ${s.hands[0].length} 张`],
  }),
  acceptDraw: () => false,
  endLine: (s, name) => (s.winner === 0 ? `${name} 的拉密还没理完，你先出清了` : s.winner === 1 ? `${name} 拉密先出清了手牌` : s.winner > 1 ? `小机先出清了这局拉密` : "拉密摸完牌堆打平"),
};

export default spec;
