// 四色牌（跑得快变体）：红黄蓝绿四色 1-10 各一张共40张，三人简化为两人各10张。
// 大压小单张跟打，同色连对/三连可甩，先出完者胜。
import type { GameSpec, GAction, GView } from "./types";
import { shuffle, randInt } from "./types";

type FC = { id: string; color: number; num: number }; // color 0-3, num 1-10
type S = { hands: FC[][]; table: FC[] | null; tableKind: string; turn: number; over: boolean; winner: number; plies: number };
const CN = ["红", "黄", "蓝", "绿"];
const fcLabel = (c: FC) => CN[c.color] + c.num;

function comboOf(cs: FC[]): { kind: string; key: number } | null {
  if (!cs.length) return null;
  if (cs.length === 1) return { kind: "single", key: cs[0].num };
  if (cs.length === 2 && cs[0].num === cs[1].num) return { kind: "pair", key: cs[0].num };
  if (cs.length === 3 && cs[0].num === cs[1].num && cs[1].num === cs[2].num) return { kind: "triple", key: cs[0].num };
  // 同色顺（连张≥3）
  if (new Set(cs.map((c) => c.color)).size === 1) {
    const ns = [...new Set(cs.map((c) => c.num))].sort((a, b) => a - b);
    if (ns.length === cs.length && ns[ns.length - 1] - ns[0] === ns.length - 1 && ns.length >= 3) return { kind: "run", key: ns[ns.length - 1] };
  }
  return null;
}
function beatsCombo(a: { kind: string; key: number }, b: { kind: string; key: number }, lenA: number, lenB: number): boolean {
  if (a.kind !== b.kind || lenA !== lenB) return false;
  return a.key > b.key;
}

const spec: GameSpec<S> = {
  id: "four-color",
  name: "四色牌",
  category: "card",
  players: "2-4人",
  ruleSummary: "四色数字牌，单/对/三张/同色顺，大同小，先出完赢",
  simplified: "本版本采用简化规则：两人局各发10张；只能出单张、同点对子、同点三张或同色连顺（3-5张）；必须压住桌面同类且更长/更大者才能跟牌；无人能接则由最后出牌方重新起手。",
  undoable: false,
  maxTurns: 60,
  create: (_seats, rng) => {
    const all: FC[] = [];
    for (let c = 0; c < 4; c++) for (let n = 1; n <= 10; n++) all.push({ id: `f${c}${n}`, color: c, num: n });
    const extra: FC[] = [];
    for (let c = 0; c < 4; c++) for (let n = 1; n <= 10; n++) extra.push({ id: `f2-${c}${n}`, color: c, num: n });
    const d = shuffle([...all, ...extra], rng);
    return { hands: [d.slice(0, 10), d.slice(10, 20)], table: null, tableKind: "", turn: 0, over: false, winner: -1, plies: 0 };
  },
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over) return [];
    const hand = s.hands[s.turn];
    const acts: GAction[] = [];
    const seen = new Set<string>();
    const push = (cs: FC[]) => {
      const cb = comboOf(cs);
      if (!cb) return;
      if (s.table) {
        const tb = comboOf(s.table);
        if (!tb || !beatsCombo(cb, tb, cs.length, s.table.length)) return;
      }
      const key = JSON.stringify(cs.map((c) => c.id));
      if (seen.has(key)) return;
      seen.add(key);
      acts.push({ kind: "play", s: key, label: cs.map(fcLabel).join(" ") });
    };
    for (const c of hand) push([c]);
    const byNum = new Map<number, FC[]>();
    for (const c of hand) { if (!byNum.has(c.num)) byNum.set(c.num, []); byNum.get(c.num)!.push(c); }
    for (const [, g] of byNum) { if (g.length >= 2) push(g.slice(0, 2)); if (g.length >= 3) push(g.slice(0, 3)); }
    const byColor = new Map<number, FC[]>();
    for (const c of hand) { if (!byColor.has(c.color)) byColor.set(c.color, []); byColor.get(c.color)!.push(c); }
    for (const [, g] of byColor) {
      const sorted = [...g].sort((a, b) => a.num - b.num);
      for (let len = 3; len <= 5; len++) for (let i = 0; i + len <= sorted.length; i++) {
        const seg = sorted.slice(i, i + len);
        if (seg[seg.length - 1].num - seg[0].num === len - 1 && new Set(seg.map((c) => c.num)).size === len) push(seg);
      }
    }
    if (s.table) acts.push({ kind: "pass", label: "不要" });
    if (!acts.length && !s.table) acts.push({ kind: "play", s: JSON.stringify([hand[0].id]), label: fcLabel(hand[0]) });
    return acts;
  },
  apply: (s, a) => {
    if (s.over) return null;
    const hands = s.hands.map((h) => h.slice());
    if (a.kind === "pass") {
      if (!s.table) return null;
      const foe = 1 - s.turn;
      // 两家都过 → 上一轮出牌方重开（此处记 foe 若也过则清空桌面）
      if (s.tableKind === "passed") return { ...s, hands, table: null, tableKind: "", turn: foe, plies: s.plies + 1 };
      return { ...s, hands, tableKind: "passed", turn: foe, plies: s.plies + 1 };
    }
    if (a.kind !== "play" || !a.s) return null;
    const ids = new Set(JSON.parse(a.s) as string[]);
    const cards = hands[s.turn].filter((c) => ids.has(c.id));
    if (cards.length !== ids.size) return null;
    const cb = comboOf(cards);
    if (!cb) return null;
    if (s.table) {
      const tb = comboOf(s.table);
      if (!tb || !beatsCombo(cb, tb, cards.length, s.table.length)) return null;
    }
    hands[s.turn] = hands[s.turn].filter((c) => !ids.has(c.id));
    if (!hands[s.turn].length) return { ...s, hands, table: cards, tableKind: "", over: true, winner: s.turn, plies: s.plies + 1 };
    return { ...s, hands, table: cards, tableKind: "", turn: 1 - s.turn, plies: s.plies + 1 };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === -1 ? "draw" : s.winner === seat ? "win" : "lose"),
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    if (!acts.length) return null;
    const plays = acts.filter((a) => a.kind === "play");
    if (!plays.length) return acts.find((a) => a.kind === "pass") ?? null;
    if (s.table && Math.random() < 0.2) { const p = acts.find((a) => a.kind === "pass"); if (p) return p; }
    let best = plays[0], bn = 0;
    for (const p of plays) { const n = (JSON.parse(p.s!) as string[]).length; if (n > bn) { bn = n; best = p; } }
    return Math.random() < 0.7 ? best : plays[randInt(Math.random, plays.length)];
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.hands) && o.hands.length === 2 ? o : null; },
  view: (s) => ({
    kind: "cards",
    hands: s.hands.map((h, i) => ({ seat: i, cards: h.map((c) => ({ id: c.id, token: String(c.color), label: fcLabel(c) })) })),
    tableCards: s.table ? s.table.map((c) => ({ id: c.id, token: String(c.color), label: fcLabel(c) })) : [],
    notes: [`桌面${s.table ? s.table.map(fcLabel).join(" ") + (s.tableKind === "passed" ? "（已有一家不要）" : "") : "空·自由出"} · 你剩 ${s.hands[0].length} 张 TA剩 ${s.hands[1].length} 张`],
  }),
  acceptDraw: () => false,
  endLine: (s, name) => (s.winner === 0 ? `${name} 的四色牌被你跑完了` : s.winner === 1 ? `${name} 四色牌跑得比你快` : "四色牌平局"),
};

export default spec;
