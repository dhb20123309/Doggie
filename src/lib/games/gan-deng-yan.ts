// 干瞪眼：每人5张，公共牌堆。轮流出"比桌面大1或同点"的牌（可出多张同点），出完即过。
// 支持 2-4 人；牌堆摸完仍无人出完则比手牌少。
import type { GameSpec, GAction, GView } from "./types";
import { shuffle, randInt } from "./types";
import { makeStandard, cardLabel, type PCard } from "./cards";

type S = { hands: PCard[][]; deck: PCard[]; table: PCard[]; turn: number; over: boolean; winner: number; plies: number; seats: number; stucks: number };
const rankOf = (c: PCard) => c.rank; // 2..14
const seatName = (seat: number) => (seat === 0 ? "你" : seat === 1 ? "TA" : `小机 ${seat - 1}`);
const canBeat = (c: PCard, top: PCard | undefined) => !top || c.rank === top.rank || c.rank === top.rank + 1 || (top.rank === 14 && c.rank === 2);

const spec: GameSpec<S> = {
  id: "gan-deng-yan",
  name: "干瞪眼",
  category: "card",
  players: "2-4人",
  ruleSummary: "接牌只能大一点或同点，先出完手牌赢",
  simplified: "本版本采用简化规则：每人发5张、公共牌堆按人数留量；可一次出多张同点数；2 与 A 视为相邻可互接；连续全员过牌且牌堆空时手牌最少者胜。",
  undoable: false,
  maxTurns: 120,
  minSeats: 2,
  maxSeats: 4,
  create: (seatsRaw, rng) => {
    const seats = Math.max(2, Math.min(4, Math.floor(seatsRaw || 2)));
    const d = shuffle(makeStandard(), rng);
    return { hands: Array.from({ length: seats }, (_, i) => d.slice(i * 5, i * 5 + 5)), deck: d.slice(seats * 5, seats * 5 + 18), table: [], turn: 0, over: false, winner: -1, plies: 0, seats, stucks: 0 };
  },
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over) return [];
    const acts: GAction[] = [];
    const hand = s.hands[s.turn];
    const top = s.table[s.table.length - 1];
    const groups = new Map<number, PCard[]>();
    for (const c of hand) { const k = c.rank; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(c); }
    for (const [r, cs] of groups) {
      if (!top || r === top.rank || r === top.rank + 1 || (top.rank === 14 && r === 2)) {
        for (let n = 1; n <= cs.length; n++) acts.push({ kind: "play", s: JSON.stringify(cs.slice(0, n).map((c) => c.id)), label: cs.slice(0, n).map(cardLabel).join(" ") });
      }
    }
    if (s.deck.length) acts.push({ kind: "draw", label: "摸一张" });
    else acts.push({ kind: "pass", label: "不出" });
    return acts;
  },
  apply: (s, a) => {
    if (s.over) return null;
    const hands = s.hands.map((h) => h.slice());
    let deck = s.deck.slice(), table = s.table.slice(), turn = s.turn, over = false, winner = -1, stucks = s.stucks;
    if (a.kind === "play" && a.s) {
      const ids = new Set(JSON.parse(a.s) as string[]);
      const cards = hands[turn].filter((c) => ids.has(c.id));
      if (cards.length !== ids.size) return null;
      const top = table[table.length - 1];
      const rs = [...new Set(cards.map(rankOf))];
      if (rs.length !== 1) return null;
      if (top && !(rs[0] === top.rank || rs[0] === top.rank + 1 || (top.rank === 14 && rs[0] === 2))) return null;
      hands[turn] = hands[turn].filter((c) => !ids.has(c.id));
      table.push(...cards);
      stucks = 0;
      if (!hands[turn].length) { over = true; winner = turn; }
      else turn = (turn + 1) % s.seats;
    } else if (a.kind === "draw") {
      if (!deck.length) return null;
      hands[turn].push(deck.shift()!);
      // 摸牌换手，避免无限摸
      turn = (turn + 1) % s.seats;
    } else if (a.kind === "pass") {
      if (deck.length) return null;
      stucks++;
      // 连续所有家都过 → 结束，比手牌最少
      if (stucks >= s.seats) {
        over = true;
        let best = 0;
        for (let i = 1; i < s.seats; i++) if (hands[i].length < hands[best].length) best = i;
        const minLen = hands[best].length;
        winner = hands.filter((h) => h.length === minLen).length > 1 && minLen > 0 ? -1 : best;
      } else turn = (turn + 1) % s.seats;
    } else return null;
    return { ...s, hands, deck, table, turn, over, winner, plies: s.plies + 1, stucks };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === -1 ? "draw" : s.winner === seat ? "win" : "lose"),
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    const plays = acts.filter((a) => a.kind === "play");
    if (plays.length) {
      const scored = plays.map((p) => ({ p, n: (JSON.parse(p.s!) as string[]).length }));
      scored.sort((a, b) => b.n - a.n);
      return Math.random() < 0.75 ? scored[0].p : plays[randInt(Math.random, plays.length)];
    }
    return acts[0] ?? null;
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.hands) && o.hands.length >= 2 && o.hands.length === (o.seats ?? o.hands.length) ? o : null; },
  view: (s) => ({
    kind: "cards",
    hands: s.hands.map((h, i) => ({ seat: i, cards: h.map((c) => ({ id: c.id, token: String(c.suit), label: cardLabel(c) })) })),
    tableCards: s.table.slice(-6).map((c) => ({ id: c.id, token: String(c.suit), label: cardLabel(c) })),
    notes: [`牌堆 ${s.deck.length} 张 · ${s.seats}人局 · 桌面${s.table.length ? `【${cardLabel(s.table[s.table.length - 1])}】` : "空"} · 你剩 ${s.hands[0].length} 张`],
  }),
  acceptDraw: () => false,
  endLine: (s, name) => (s.winner === 0 ? `${name} 干瞪眼看你出完了牌` : s.winner === 1 ? `${name} 先出完，你干瞪眼了` : s.winner > 1 ? `小机把 ${name} 和你都瞪输了` : "干瞪眼平局"),
};

export default spec;
