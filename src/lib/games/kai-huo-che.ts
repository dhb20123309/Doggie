// 开火车（接龙出牌）：每人持一张"接头卡"，公共牌堆轮流出牌凑同点，出完摸补；牌堆空且无人能出即结束比剩牌。支持 2-6 人。
import type { GameSpec, GAction, GView } from "./types";
import { shuffle, randInt } from "./types";
import { makeStandard, cardLabel, type PCard } from "./cards";

type S = { hands: PCard[][]; deck: PCard[]; head: number[]; pile: PCard[]; turn: number; over: boolean; winner: number; plies: number; seats: number; stucks: number };
// head[seat] = 该座位当前"火车头"点数；打出等于头点数的牌即收走并换新头
const seatName = (seat: number) => (seat === 0 ? "你" : seat === 1 ? "TA" : `小机 ${seat - 1}`);

const spec: GameSpec<S> = {
  id: "kai-huo-che",
  name: "开火车",
  category: "card",
  players: "2-6人",
  ruleSummary: "打出的牌与自己的车头点数相同即可收牌，先出完手牌赢",
  simplified: "本版本采用简化规则：每人8张、公共池剩余牌；一次可连续打出多张同点头牌；无万能王；公共池摸完且全员接不动时手牌最少者胜。",
  undoable: false,
  maxTurns: 160,
  minSeats: 2,
  maxSeats: 6,
  create: (seatsRaw, rng) => {
    const seats = Math.max(2, Math.min(6, Math.floor(seatsRaw || 2)));
    const d = shuffle(makeStandard(), rng);
    return {
      hands: Array.from({ length: seats }, (_, i) => d.slice(i * 8, i * 8 + 8)),
      deck: d.slice(seats * 8),
      head: Array.from({ length: seats }, (_, i) => d[seats * 8 + i]?.rank ?? 7),
      pile: [], turn: 0, over: false, winner: -1, plies: 0, seats, stucks: 0,
    };
  },
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over) return [];
    const acts: GAction[] = [];
    const hand = s.hands[s.turn], h = s.head[s.turn];
    const match = hand.filter((c) => c.rank === h);
    for (let n = 1; n <= Math.min(match.length, 4); n++) acts.push({ kind: "play", s: JSON.stringify(match.slice(0, n).map((c) => c.id)), label: `出 ${match.slice(0, n).map(cardLabel).join(" ")}` });
    if (s.deck.length) acts.push({ kind: "draw", label: "摸牌过牌" });
    else acts.push({ kind: "pass", label: "过" });
    return acts;
  },
  apply: (s, a) => {
    if (s.over) return null;
    const hands = s.hands.map((h) => h.slice());
    let deck = s.deck.slice(), head = s.head.slice(), pile = s.pile.slice(), over = false, winner = -1, stucks = s.stucks;
    if (a.kind === "play" && a.s) {
      const ids = new Set(JSON.parse(a.s) as string[]);
      const cards = hands[s.turn].filter((c) => ids.has(c.id));
      if (!cards.length || cards.length !== ids.size || !cards.every((c) => c.rank === head[s.turn])) return null;
      hands[s.turn] = hands[s.turn].filter((c) => !ids.has(c.id));
      pile.push(...cards);
      stucks = 0;
      // 新头 = 下一张牌堆顶
      if (deck.length) head[s.turn] = deck[0].rank, deck = deck.slice(1);
      if (!hands[s.turn].length) { over = true; winner = s.turn; }
    } else if (a.kind === "draw") {
      if (!deck.length) return null;
      hands[s.turn].push(deck.shift()!);
      if (deck.length) head[s.turn] = deck[0].rank;
    } else if (a.kind === "pass") {
      if (deck.length) return null;
      stucks++;
      // 全员连续过 → 结束比剩牌
      if (stucks >= s.seats) {
        let best = 0;
        for (let i = 1; i < s.seats; i++) if (hands[i].length < hands[best].length) best = i;
        const minLen = hands[best].length;
        winner = hands.filter((h) => h.length === minLen).length > 1 ? -1 : best;
        over = true;
      }
    } else return null;
    return { ...s, hands, deck, head, pile, turn: (s.turn + 1) % s.seats, over, winner, plies: s.plies + 1, stucks };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === -1 ? "draw" : s.winner === seat ? "win" : "lose"),
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    const plays = acts.filter((a) => a.kind === "play");
    if (plays.length) return Math.random() < 0.85 ? plays[plays.length - 1] : plays[randInt(Math.random, plays.length)];
    return acts[0] ?? null;
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.hands) && o.hands.length >= 2 && o.hands.length === (o.seats ?? o.hands.length) ? o : null; },
  view: (s) => ({
    kind: "cards",
    hands: s.hands.map((h, i) => ({ seat: i, cards: h.map((c) => ({ id: c.id, token: String(c.suit), label: cardLabel(c) })) })),
    tableCards: s.pile.slice(-5).map((c) => ({ id: c.id, token: String(c.suit), label: cardLabel(c) })),
    notes: [`你的车头【${cardLabel({ id: "", rank: s.head[0], suit: 0 })}】 · ${s.seats}人局 · 牌堆 ${s.deck.length}`],
  }),
  acceptDraw: () => false,
  endLine: (s, name) => (s.winner === 0 ? `${name} 的火车还没到站，你先出完了` : s.winner === 1 ? `${name} 开火车先到站了` : s.winner > 1 ? `小机的火车先到站` : "开火车双双抛锚，平局"),
};

export default spec;
