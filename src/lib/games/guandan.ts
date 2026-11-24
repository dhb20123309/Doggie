// 掼蛋（简化单挑版）：基于斗地主牌型 + 级牌概念。当前级牌为2，逢人配(红桃级牌)作万能。
import type { GameSpec, GAction, GView } from "./types";
import { shuffle, randInt } from "./types";
import { makeDeck, cardLabel, comboOf, beats, type PCard, type Combo } from "./cards";

type S = { hands: PCard[][]; table: Combo | null; leader: number; turn: number; passes: number; over: boolean; winner: number; plies: number };
const levelRank = 2; // 固定级牌2

function gdCombo(cs: PCard[]): Combo | null {
  const base = comboOf(cs);
  if (base.kind === "invalid") return null;
  return { ...base, cards: cs, typeName: TYPE_CN[base.kind] ?? base.kind };
}
const TYPE_CN: Record<string, string> = { single: "单张", pair: "对子", triple: "三张", triple1: "三带一", triple2: "三带二", straight: "顺子", pairStraight: "连对", bomb: "炸弹", rocket: "王炸", quad2: "四带二" };

const spec: GameSpec<S> = {
  id: "guandan",
  name: "掼蛋",
  category: "card",
  players: "4人",
  ruleSummary: "两副牌跟牌，牌型同斗地主但级牌(2)仅次于王，先出完者胜",
  simplified: "本版本采用简化规则：两人局各13张（你 vs TA）；级牌固定为2（比A大、比小王小）；不做进贡还贡与双下升级；无同花顺最大设定，按普通顺子计。",
  undoable: false,
  maxTurns: 80,
  create: (_seats, rng) => {
    const d = shuffle(makeDeck(true), rng);
    return { hands: [d.slice(0, 13), d.slice(13, 26)], table: null, leader: 0, turn: 0, passes: 0, over: false, winner: -1, plies: 0 };
  },
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over) return [];
    const hand = s.hands[s.turn];
    const acts: GAction[] = [];
    const cands: PCard[][] = [];
    const byRank = new Map<number, PCard[]>();
    for (const c of hand) { const k = c.rank === levelRank ? 90 : c.rank; if (!byRank.has(k)) byRank.set(k, []); byRank.get(k)!.push(c); }
    for (const [, g] of byRank) {
      if (g.length >= 1) cands.push([g[0]]);
      if (g.length >= 2) cands.push(g.slice(0, 2));
      if (g.length >= 3) cands.push(g.slice(0, 3));
      if (g.length >= 4) cands.push(g.slice(0, 4));
    }
    // 三连对（简化：两组相邻对子）
    const pairs = [...byRank.entries()].filter(([, g]) => g.length >= 2).sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < pairs.length - 1; i++) {
      const [r1, g1] = pairs[i], [r2, g2] = pairs[i + 1];
      if (Math.abs(r1 - r2) === 1 || (r1 === 90 && r2 === 3) || (r2 === 90 && r1 === 14)) cands.push([g1[0], g1[1], g2[0], g2[1]]);
    }
    // 顺子5张
    const ranks = [...new Set(hand.map((c) => (c.rank === levelRank ? 15 : Math.min(c.rank, 14))))].sort((a, b) => a - b);
    for (let i = 0; i + 4 < ranks.length; i++) {
      if (ranks[i + 4] - ranks[i] === 4) {
        const cs: PCard[] = [];
        for (let k = 0; k < 5; k++) { const rr = ranks[i + k] === 15 ? levelRank : ranks[i + k]; const c = hand.find((x) => (x.rank === levelRank ? 15 : x.rank) === rr && !cs.includes(x)); if (c) cs.push(c); }
        if (cs.length === 5) cands.push(cs);
      }
    }
    for (const cs of cands) {
      const cb = gdCombo(cs);
      if (!cb) continue;
      if (s.table && !beats(cb, s.table, levelRank)) continue;
      acts.push({ kind: "play", s: JSON.stringify(cs.map((c) => c.id)), label: `${cb.typeName} ${cs.map(cardLabel).join(" ")}` });
      if (acts.length > 20) break;
    }
    if (s.table) acts.push({ kind: "pass", label: "不要" });
    else if (!acts.length) acts.push({ kind: "play", s: JSON.stringify([hand[0].id]), label: `出 ${cardLabel(hand[0])}` });
    return acts;
  },
  apply: (s, a) => {
    if (s.over) return null;
    const hands = s.hands.map((h) => h.slice());
    if (a.kind === "pass") {
      if (!s.table) return null;
      const passes = s.passes + 1;
      if (passes >= 1) return { ...s, table: null, leader: s.turn, turn: s.turn, passes: 0, plies: s.plies + 1 };
      return { ...s, turn: 1 - s.turn, passes, plies: s.plies + 1 };
    }
    if (a.kind !== "play" || !a.s) return null;
    const ids = new Set(JSON.parse(a.s) as string[]);
    const cards = hands[s.turn].filter((c) => ids.has(c.id));
    if (cards.length !== ids.size) return null;
    const cb = gdCombo(cards);
    if (!cb || (s.table && !beats(cb, s.table, levelRank))) return null;
    hands[s.turn] = hands[s.turn].filter((c) => !ids.has(c.id));
    if (!hands[s.turn].length) return { ...s, hands, over: true, winner: s.turn, plies: s.plies + 1 };
    return { ...s, hands, table: cb, leader: s.turn, turn: 1 - s.turn, passes: 0, plies: s.plies + 1 };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === -1 ? "draw" : s.winner === seat ? "win" : "lose"),
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    if (!acts.length) return null;
    const plays = acts.filter((a) => a.kind === "play");
    if (!plays.length) return acts.find((a) => a.kind === "pass") ?? null;
    if (s.table && s.turn !== s.leader && Math.random() < 0.25) return acts.find((a) => a.kind === "pass")!;
    return plays[randInt(Math.random, Math.min(2, plays.length))];
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.hands) && o.hands.length === 2 ? o : null; },
  view: (s) => ({
    kind: "cards",
    hands: s.hands.map((h, i) => ({ seat: i, cards: h.map((c) => ({ id: c.id, token: String(c.suit), label: cardLabel(c) })) })),
    tableCards: s.table?.cards ? s.table.cards.map((c) => ({ id: c.id, token: String(c.suit), label: cardLabel(c) })) : [],
    notes: [`级牌【2】 · ${s.table ? `桌面${s.table.typeName}` : "自由出牌"} · 你剩 ${s.hands[0].length} 张 TA剩 ${s.hands[1].length} 张`],
  }),
  acceptDraw: () => false,
  endLine: (s, name) => (s.winner === 0 ? `${name} 的掼蛋被你抢光了手牌` : s.winner === 1 ? `${name} 掼蛋先出完，把你剩在手里` : "掼蛋平局"),
};

export default spec;
