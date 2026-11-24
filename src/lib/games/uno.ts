// UNO：108张牌（颜色数字+功能牌）。同色/同数字/同符号可出；跳过、反转、+2、万能变色+2。手牌出完即胜。
import type { GameSpec, GAction, GView } from "./types";
import { shuffle, randInt } from "./types";

type UCard = { id: string; color: 0 | 1 | 2 | 3 | 4 /* 4=黑 */; text: string; kind: "num" | "skip" | "rev" | "draw2" | "wild" | "wild4"; num?: number };
type S = { hands: UCard[][]; pile: UCard[]; deck: UCard[]; turn: number; dir: number; top: UCard | null; over: boolean; winner: number; plies: number; pendingDraw: number };
const COLORS = ["红", "黄", "蓝", "绿"];

export function unoCreate(rng: () => number): S {
  const cards: UCard[] = []; let n = 0;
  for (let c = 0; c < 4; c++) {
    cards.push({ id: `u${n++}`, color: c as 0 | 1 | 2 | 3, text: "跳过", kind: "skip" });
    cards.push({ id: `u${n++}`, color: c as 0 | 1 | 2 | 3, text: "反转", kind: "rev" });
    cards.push({ id: `u${n++}`, color: c as 0 | 1 | 2 | 3, text: "+2", kind: "draw2" });
    for (let k = 0; k <= 9; k++) { cards.push({ id: `u${n++}`, color: c as 0 | 1 | 2 | 3, text: String(k), kind: "num", num: k }); if (k > 0) cards.push({ id: `u${n++}`, color: c as 0 | 1 | 2 | 3, text: String(k), kind: "num", num: k }); }
  }
  for (let i = 0; i < 4; i++) { cards.push({ id: `u${n++}`, color: 4, text: "万能", kind: "wild" }); cards.push({ id: `u${n++}`, color: 4, text: "+4", kind: "wild4" }); }
  const deck = shuffle(cards, rng);
  const hands = [deck.slice(0, 7), deck.slice(7, 14), deck.slice(14, 21)];
  const rest = deck.slice(21);
  let top = rest[0];
  while (top && (top.kind === "wild" || top.kind === "wild4")) { rest.push(rest.shift()!); top = rest[0]; }
  return { hands, pile: [], deck: rest.slice(1), turn: 0, dir: 1, top: top ?? null, over: false, winner: -1, plies: 0, pendingDraw: 0 };
}
function playable(s: S, seat: number): UCard[] {
  const t = s.top!;
  const effColor = t.color === 4 ? (t.num ?? 0) : t.color; // wild 存了指定色在 num
  return s.hands[seat].filter((c) => c.color === 4 || c.color === effColor || (t.kind === "num" && c.kind === "num" && c.num === t.num) || (c.kind !== "num" && c.kind === t.kind));
}
function nextSeat(s: S, skip = 0): number {
  const seats = s.hands.length;
  return (s.turn + s.dir * (1 + skip) + seats * 10) % seats;
}
function drawFrom(s: S, seat: number, cnt: number): { hands: UCard[][]; deck: UCard[] } {
  const hands = s.hands.map((h) => h.slice());
  let deck = s.deck.slice();
  for (let i = 0; i < cnt; i++) {
    if (!deck.length) { deck = shuffle(s.pile.filter((c) => c.id !== s.top?.id), Math.random); if (!deck.length) break; }
    hands[seat].push(deck.shift()!);
  }
  return { hands, deck };
}

const spec: GameSpec<S> = {
  id: "uno",
  name: "UNO",
  category: "card",
  players: "2-6人",
  ruleSummary: "同色或同数字/符号跟牌，先出完手牌者胜",
  simplified: "本版本采用简化规则：三人局（你/TA/小机）；万能牌打出后固定指定为下一家可用最多的颜色（自动）；+2/+4不叠加，直接摸并跳过该家；无 UNO 喊叫罚牌。",
  undoable: false,
  maxTurns: 120,
  create: (_seats, rng) => unoCreate(rng),
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over) return [];
    const acts: GAction[] = playable(s, s.turn).map((c) => ({ kind: "play", s: c.id, label: `${c.color === 4 ? "" : COLORS[c.color]}${c.text}` }));
    acts.push({ kind: "draw", label: "摸牌" });
    return acts;
  },
  apply: (s, a) => {
    if (s.over) return null;
    if (a.kind === "draw") {
      const { hands, deck } = drawFrom(s, s.turn, 1);
      const got = hands[s.turn][hands[s.turn].length - 1];
      const canPlay = got && playable({ ...s, hands }, s.turn).some((c) => c.id === got.id);
      if (canPlay) return { ...s, hands, deck, plies: s.plies + 1 }; // 摸到能出的可以不转
      return { ...s, hands, deck, turn: nextSeat(s), plies: s.plies + 1 };
    }
    if (a.kind !== "play" || !a.s) return null;
    const card = s.hands[s.turn].find((c) => c.id === a.s);
    if (!card || !playable(s, s.turn).some((c) => c.id === card.id)) return null;
    const hands = s.hands.map((h) => h.slice());
    hands[s.turn] = hands[s.turn].filter((c) => c.id !== card.id);
    const top: UCard = card.color === 4 ? { ...card, num: pickWildColor(hands, (s.turn + s.dir + hands.length) % hands.length) } : card;
    const pile = [...s.pile, s.top!];
    if (!hands[s.turn].length) return { ...s, hands, pile, top, over: true, winner: s.turn, plies: s.plies + 1 };
    let dir = s.dir, skip = 0, drawCnt = 0;
    if (card.kind === "skip") skip = 1;
    else if (card.kind === "rev") { dir = -dir; if (hands.length === 2) skip = 1; }
    else if (card.kind === "draw2") drawCnt = 2;
    else if (card.kind === "wild4") drawCnt = 4;
    let ns: S = { ...s, hands, pile, top, dir, plies: s.plies + 1 };
    if (drawCnt) {
      const d = drawFrom(ns, (ns.turn + dir + hands.length) % hands.length, drawCnt);
      ns = { ...ns, hands: d.hands, deck: d.deck };
      skip = 1;
    }
    ns.turn = (ns.turn + dir * (1 + skip) + hands.length * 10) % hands.length;
    return ns;
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === -1 ? "draw" : s.winner === seat ? "win" : "lose"),
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    const plays = acts.filter((a) => a.kind === "play");
    if (!plays.length) return acts.find((a) => a.kind === "draw") ?? null;
    const hand = s.hands[s.turn];
    const scored = plays.map((p) => { const c = hand.find((x) => x.id === p.s)!; let v = c.kind === "num" ? c.num! : c.kind === "wild4" ? 50 : c.kind === "wild" ? 40 : 30; if (c.color === 4) v -= 20; return { p, v }; });
    scored.sort((a, b) => a.v - b.v);
    if (Math.random() < 0.1 && plays.length > 1) return plays[randInt(Math.random, plays.length)];
    return scored[0]?.p ?? null;
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.hands) && o.hands.length >= 2 && o.top ? o : null; },
  view: (s) => ({
    kind: "cards",
    hands: s.hands.map((h, i) => ({ seat: i, cards: h.map((c) => ({ id: c.id, token: String(c.color), label: `${c.color === 4 ? "★" : COLORS[c.color]}${c.text}` })) })),
    tableCards: s.top ? [{ id: s.top.id, token: String(s.top.color), label: `${s.top.color === 4 ? "★指定" + COLORS[s.top.num ?? 0] : ""}${COLORS[s.top.color] || ""}${s.top.text}` }] : [],
    hiddenCount: {},
    notes: [`余牌 ${s.deck.length} · ${["你", "TA", "小机"][s.turn]}的回合`],
  }),
  acceptDraw: () => false,
  endLine: (s, name) => (s.winner === 0 ? `${name} 的 UNO 被你打空赢了` : s.winner === 1 ? `${name} 先出完，UNO 输了` : `小机抢下了这局 UNO，你和 ${name} 都剩牌`),
};
function pickWildColor(hands: UCard[][], seat: number): number {
  const cnt = [0, 0, 0, 0];
  for (const c of hands[seat]) if (c.color < 4) cnt[c.color]++;
  return cnt.indexOf(Math.max(...cnt));
}

export default spec;
