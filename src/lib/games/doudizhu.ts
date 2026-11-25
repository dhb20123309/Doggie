// 斗地主：seat0=玩家，其余为角色/人机；叫分定地主后地主对众农民，先出完手牌的一方胜。
import type { GameSpec, GAction, GView } from "./types";
import { shuffle, randInt } from "./types";
import { makeDeck, comboOf, beats, cardLabel, type PCard, type Combo } from "./cards";

type S = {
  hands: PCard[][]; last: PCard[] | null; lastOwner: number; turn: number; passes: number;
  landlord: number; phase: "call" | "play"; over: boolean; winner: number; plies: number; bottom: PCard[]; seats: number;
};

const sortHand = (h: PCard[]) => h.slice().sort((a, b) => a.rank - b.rank || a.suit - b.suit);

function combosFrom(hand: PCard[], mustBeat: Combo | null): PCard[][] {
  const out: PCard[][] = [];
  const byRank = new Map<number, PCard[]>();
  for (const c of hand) { const k = c.rank; if (!byRank.has(k)) byRank.set(k, []); byRank.get(k)!.push(c); }
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  // 单张/对子/三张/炸弹/火箭
  for (const r of ranks) {
    const g = byRank.get(r)!;
    if (g.length >= 1) out.push([g[0]]);
    if (g.length >= 2) out.push(g.slice(0, 2));
    if (g.length === 3) out.push(g.slice());
    if (g.length === 4) out.push(g.slice());
    if (g.length === 3) for (const r2 of ranks) if (r2 !== r) out.push([...g, byRank.get(r2)![0]]);
  }
  const jokers = hand.filter((c) => c.rank >= 16);
  if (jokers.length === 2) out.push(jokers);
  // 顺子（≥5 连续单）与连对（≥3 连续对），不含 2/王
  const plain = ranks.filter((r) => r <= 14);
  for (let len = 5; len <= Math.min(12, plain.length); len++) {
    for (let i = 0; i + len <= plain.length; i++) {
      const seg = plain.slice(i, i + len);
      if (seg[seg.length - 1] - seg[0] === len - 1) out.push(seg.map((r) => byRank.get(r)![0]));
    }
  }
  for (let len = 3; len * 2 <= plain.length; len++) {
    for (let i = 0; i + len <= plain.length; i++) {
      const seg = plain.slice(i, i + len);
      if (seg[seg.length - 1] - seg[0] === len - 1 && seg.every((r) => (byRank.get(r)!.length >= 2))) {
        out.push(seg.flatMap((r) => byRank.get(r)!.slice(0, 2)));
      }
    }
  }
  // 三带二
  for (const r of ranks) if (byRank.get(r)!.length === 3) for (const r2 of ranks) if (r2 !== r && byRank.get(r2)!.length >= 2) out.push([...byRank.get(r)!, ...byRank.get(r2)!.slice(0, 2)]);
  if (!mustBeat) return out.filter((cs) => comboOf(cs).kind !== "invalid");
  return out.filter((cs) => { const co = comboOf(cs); return co.kind !== "invalid" && beats(co, mustBeat); });
}

/** 经典三人用整副 54 张；人更多时只用一副牌（rank 天然唯一，避免多副重复 id/同点异花歧义），发牌均分 */
function deckFor(seats: number, rng: () => number): { deck: PCard[]; per: number; bottomN: number } {
  if (seats <= 3) return { deck: shuffle(makeDeck(true), rng), per: 17, bottomN: 3 };
  const deck = makeDeck(true); // 54 张：6 人各 8 张 + 6 张底牌
  const per = Math.floor((deck.length - 3) / seats);
  return { deck: shuffle(deck, rng), per, bottomN: deck.length - per * seats };
}

const spec: GameSpec<S> = {
  id: "doudizhu",
  name: "斗地主",
  category: "card",
  players: "3-6人",
  ruleSummary: "叫分定地主，先出完手牌者胜",
  simplified: "本版本采用简化规则：地主对众农民；叫分只比谁抢地主（有炸弹即抢）；不出牌即过，其余各家全过则重出；无春天翻倍结算；超过 3 人时自动并入第二副牌。",
  undoable: false,
  maxTurns: 160,
  minSeats: 3,
  maxSeats: 6,
  create: (seatsRaw, rng) => {
    const seats = Math.max(3, Math.min(6, Math.floor(seatsRaw || 3)));
    const { deck, per, bottomN } = deckFor(seats, rng);
    const hands: PCard[][] = [];
    for (let i = 0; i < seats; i++) hands.push(sortHand(deck.slice(i * per, i * per + per)));
    const bottom = deck.slice(seats * per, seats * per + bottomN);
    // 简化叫分：从 seat0 起第一个有炸弹者当地主，都没有则随机
    const hasBomb = (h: PCard[]) => [...new Set(h.map((c) => c.rank))].some((r) => h.filter((c) => c.rank === r).length === 4);
    let landlord = -1;
    for (let i = 0; i < seats; i++) if (hasBomb(hands[i])) { landlord = i; break; }
    if (landlord < 0 || (seats <= 3 && bottom.some((c) => c.rank === 17))) landlord = randInt(rng, seats);
    for (const c of bottom) hands[landlord].push(c);
    hands[landlord] = sortHand(hands[landlord]);
    return { hands, last: null, lastOwner: -1, turn: landlord, passes: 0, landlord, phase: "play", over: false, winner: -1, plies: 0, bottom, seats };
  },
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over) return [];
    const acts: GAction[] = [];
    const opts = combosFrom(s.hands[s.turn], s.last && s.lastOwner !== s.turn ? comboOf(s.last) : null);
    // 限制候选数量防爆（挑每种型最小的几个）
    const uniq = new Map<string, PCard[]>();
    for (const cs of opts) { const co = comboOf(cs); const key = `${co.kind}:${co.main}:${cs.length}`; if (!uniq.has(key)) uniq.set(key, cs); }
    for (const cs of [...uniq.values()].slice(0, 24)) acts.push({ kind: "play", s: JSON.stringify(cs.map((c) => c.id)), label: cs.map(cardLabel).join(" ") });
    if (s.last && s.lastOwner !== s.turn) acts.push({ kind: "pass", label: "不出" });
    return acts;
  },
  apply: (s, a) => {
    if (s.over) return null;
    const hands = s.hands.map((h) => h.slice());
    if (a.kind === "pass") {
      if (!s.last || s.lastOwner === s.turn) return null;
      const passes = s.passes + 1;
      if (passes >= s.seats - 1) return { ...s, turn: (s.turn + 1) % s.seats, last: null, lastOwner: -1, passes: 0, plies: s.plies + 1 };
      return { ...s, turn: (s.turn + 1) % s.seats, passes, plies: s.plies + 1 };
    }
    if (a.kind !== "play" || !a.s) return null;
    const ids = new Set(JSON.parse(a.s) as string[]);
    const cards = hands[s.turn].filter((c) => ids.has(c.id));
    if (cards.length !== ids.size) return null;
    const co = comboOf(cards);
    if (co.kind === "invalid") return null;
    if (s.last && s.lastOwner !== s.turn && !beats(co, comboOf(s.last))) return null;
    hands[s.turn] = hands[s.turn].filter((c) => !ids.has(c.id));
    if (!hands[s.turn].length) return { ...s, hands, last: cards, lastOwner: s.turn, over: true, winner: s.turn, plies: s.plies + 1 };
    return { ...s, hands, last: cards, lastOwner: s.turn, passes: 0, turn: (s.turn + 1) % s.seats, plies: s.plies + 1 };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => {
    if (!s.over) return "draw";
    const winSideLand = s.winner === s.landlord;
    const iAmLand = seat === s.landlord;
    return iAmLand === winSideLand ? "win" : "lose";
  },
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    if (!acts.length) return null;
    const plays = acts.filter((a) => a.kind === "play");
    if (!plays.length) return acts.find((a) => a.kind === "pass") ?? null;
    // 贪心：出最小能压的；剩一手能走完直接出
    const me = s.hands[s.turn];
    for (const p of plays) { const ids = new Set(JSON.parse(p.s!) as string[]); if (me.every((c) => ids.has(c.id) || false) && ids.size === me.length) return p; }
    const scored = plays.map((p) => { const cs = JSON.parse(p.s!) as string[]; const co = comboOf(me.filter((c) => cs.includes(c.id))); return { p, v: co.main * 10 + cs.length * 2 + (co.kind === "bomb" || co.kind === "rocket" ? 200 : 0) }; });
    scored.sort((a, b) => a.v - b.v);
    if (s.lastOwner !== s.turn && Math.random() < 0.12 && acts.some((a) => a.kind === "pass")) return acts.find((a) => a.kind === "pass")!;
    return scored[0]?.p ?? null;
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.hands) && o.hands.length >= 3 && o.hands.length === (o.seats ?? o.hands.length) ? o : null; },
  view: (s, _sel, hints) => {
    void hints;
    return {
      kind: "cards",
      hands: s.hands.map((h, i) => ({ seat: i, cards: h.map((c) => ({ id: c.id, token: c.rank >= 16 ? "joker" : String(c.suit), label: cardLabel(c) })) })),
      tableCards: s.last ? s.last.map((c) => ({ id: c.id, token: c.rank >= 16 ? "joker" : String(c.suit), label: cardLabel(c) })) : [],
      notes: [`地主：${seatName(s.landlord)} · 你的手牌 ${s.hands[0].length} 张 · ${s.seats} 人局`],
    } as GView;
  },
  acceptDraw: () => false,
  endLine: (s, name) => {
    if (!s.over) return "";
    const landWin = s.winner === s.landlord;
    return landWin ? (s.landlord === 0 ? `斗地主：你当地主赢了，${name} 认输` : `${name}${s.landlord === 1 ? " 当地主" : ""}赢了斗地主`) : (s.landlord === 0 ? "斗地主：你的地主位输了" : `${name} 的地主位输了，农民家一起赢`);
  },
};

function seatName(seat: number): string {
  return seat === 0 ? "你" : seat === 1 ? "TA" : `小机 ${seat - 1}`;
}

export default spec;
