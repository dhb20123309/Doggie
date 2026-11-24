// 德州扑克：翻前/翻后四轮下注，52张牌比最佳五张牌型。固定盲注、限注封顶底池，支持 2-6 人。
import type { GameSpec, GAction, GView } from "./types";
import { shuffle, randInt } from "./types";
import { makeStandard, holdemScore, cardLabel, type PCard } from "./cards";

type S = {
  hands: PCard[][]; board: PCard[]; deck: PCard[]; street: number; // 0翻前1翻牌2转牌3河牌4摊牌
  pot: number; bets: number[]; turn: number; over: boolean; winner: number; plies: number; lastRaise: number; folded: boolean[]; seats: number; acted: boolean[];
};
const BLIND = 10;
function aliveOf(s: { folded: boolean[] }): number[] {
  return s.folded.map((f, i) => (!f ? i : -1)).filter((i) => i >= 0);
}
function nextAlive(s: S, from: number): number {
  for (let k = 1; k <= s.seats; k++) { const i = (from + k) % s.seats; if (!s.folded[i]) return i; }
  return from;
}
function newStreet(s: S): S {
  return { ...s, bets: Array(s.seats).fill(0), lastRaise: 0, turn: nextAlive(s, s.seats - 1), acted: Array(s.seats).fill(false) };
}

const spec: GameSpec<S> = {
  id: "texas-holdem",
  name: "德州扑克",
  category: "card",
  players: "2-6人",
  ruleSummary: "两张手牌配五张公共牌，最佳五张牌型赢底池",
  simplified: "本版本采用简化规则：固定大小盲(10/5)；每街跟注/加注(限底池)/弃牌/过牌，无全下分边池；存活各家本轮注额持平且都行动过即过街；摊牌取最强一家赢池。",
  undoable: false,
  maxTurns: 80,
  minSeats: 2,
  maxSeats: 6,
  create: (seatsRaw, rng) => {
    const seats = Math.max(2, Math.min(6, Math.floor(seatsRaw || 2)));
    const d = shuffle(makeStandard(), rng);
    const hands: PCard[][] = [];
    for (let i = 0; i < seats; i++) hands.push([d[i * 2], d[i * 2 + 1]]);
    const bets = Array(seats).fill(0);
    bets[0] = BLIND;
    bets[1 % seats] = BLIND * 0.5;
    return { hands, board: [], deck: d.slice(seats * 2), street: 0, pot: BLIND * 1.5, bets, turn: 0, over: false, winner: -1, plies: 0, lastRaise: BLIND, folded: Array(seats).fill(false), seats, acted: Array(seats).fill(false) };
  },
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over || s.street > 3) return [];
    const me = s.bets[s.turn];
    const foe = Math.max(...s.bets);
    const acts: GAction[] = [];
    if (me < foe) acts.push({ kind: "call", label: `跟 ${foe - me}` });
    else acts.push({ kind: "check", label: "过牌" });
    const raiseMax = Math.max(foe * 2 + 10, foe + 10);
    acts.push({ kind: "raise", n: Math.min(raiseMax, s.pot + foe), label: `加注到 ${Math.min(raiseMax, s.pot + foe)}` });
    acts.push({ kind: "fold", label: "弃牌" });
    return acts;
  },
  apply: (s, a) => {
    if (s.over) return null;
    let { pot, turn, street, plies, lastRaise } = s;
    const bets = s.bets.slice();
    const folded = s.folded.slice();
    const acted = s.acted.slice();
    if (a.kind === "fold") {
      folded[turn] = true; acted[turn] = true;
      const alive = folded.map((f, i) => (!f ? i : -1)).filter((i) => i >= 0);
      if (alive.length === 1) return { ...s, pot, bets, street, over: true, winner: alive[0], plies: plies + 1, lastRaise, folded, acted };
      return { ...s, pot, bets, turn: nextAlive({ ...s, folded }, turn), street, plies: plies + 1, lastRaise, folded, acted };
    }
    if (a.kind === "call" || a.kind === "check") {
      if (a.kind === "call") { const need = Math.max(...bets) - bets[turn]; bets[turn] += need; pot += need; }
      acted[turn] = true;
      const alive = aliveOf({ folded });
      const even = alive.every((i) => bets[i] === bets[alive[0]]);
      const allActed = alive.every((i) => acted[i]);
      if (even && allActed) {
        // 过街
        const deck = s.deck.slice();
        let board = s.board.slice();
        street++;
        if (street === 1) board = [...board, deck.shift()!, deck.shift()!, deck.shift()!];
        else if (street <= 3) board = [...board, deck.shift()!];
        const ns: S = { ...s, board, deck, pot, bets, street, plies: plies + 1, lastRaise: 0, folded, acted: Array(s.seats).fill(false) };
        if (street >= 4) return showdown(ns);
        return newStreet(ns);
      }
      turn = nextAlive({ ...s, folded }, turn);
    } else if (a.kind === "raise") {
      const target = a.n ?? Math.max(...bets) + 10;
      const add = Math.max(target - bets[turn], 0);
      bets[turn] += add; pot += add; lastRaise = bets[turn]; acted[turn] = true;
      // 有人加注，其余人需重新行动
      for (let i = 0; i < s.seats; i++) if (i !== turn && !folded[i]) acted[i] = bets[i] >= target ? acted[i] : false;
      turn = nextAlive({ ...s, folded }, turn);
    } else return null;
    return { ...s, pot, bets, turn, street, plies: plies + 1, lastRaise, folded, acted };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === -1 ? "draw" : s.winner === seat ? "win" : "lose"),
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    if (!acts.length) return null;
    const sc = holdemScore([...s.hands[s.turn], ...s.board]);
    const strong = sc.rank >= 2;
    const call = acts.find((x) => x.kind === "call" || x.kind === "check");
    const raise = acts.find((x) => x.kind === "raise");
    const fold = acts.find((x) => x.kind === "fold");
    if (strong && raise && Math.random() < 0.6) return raise;
    if (sc.rank === 0 && Math.max(...s.bets) > s.bets[s.turn] * 3 && fold && Math.random() < 0.4) return fold;
    return call ?? acts[randInt(Math.random, acts.length)];
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.hands) && o.hands.length >= 2 && o.hands.length === (o.seats ?? o.hands.length) ? o : null; },
  view: (s) => ({
    kind: "cards",
    hands: s.hands.map((h, i) => ({ seat: i, cards: h.map((c) => ({ id: c.id, token: i !== 0 && !(s.over || s.street > 3) ? "back" : String(c.suit), label: i !== 0 && !(s.over || s.street > 3) ? "" : cardLabel(c) })) })),
    tableCards: s.board.map((c) => ({ id: c.id, token: String(c.suit), label: cardLabel(c) })),
    notes: [`底池 ${Math.round(s.pot)} · ${["翻前", "翻牌", "转牌", "河牌", "摊牌"][Math.min(s.street, 4)]} · ${s.seats}人局${s.over && !s.folded.some(Boolean) ? ` · 你:${tierName(holdemScore([...s.hands[0], ...s.board]).rank)}` : ""}`],
  }),
  acceptDraw: () => false,
  endLine: (s, name) => (s.folded[1] ? `${name} 在德扑里弃牌了，你收下底池` : s.folded[0] ? `${name} 逼得你在德扑弃了牌` : s.winner === 0 ? `${name} 的德扑被你比牌赢了` : s.winner === 1 ? `${name} 德扑摊牌赢了你` : s.winner > 1 ? `小机抢下了这局德扑底池` : "德扑平分底池"),
};
function showdown(s: S): S {
  const alive = aliveOf(s);
  let best = alive[0];
  let bestScore = holdemScore([...s.hands[best], ...s.board]);
  for (const i of alive.slice(1)) {
    const sc = holdemScore([...s.hands[i], ...s.board]);
    const c = sc.rank !== bestScore.rank ? sc.rank - bestScore.rank : sc.tie.join().localeCompare(bestScore.tie.join());
    if (c > 0) { best = i; bestScore = sc; }
  }
  return { ...s, over: true, winner: best, street: 4 };
}
function tierName(r: number): string {
  return ["高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺"][r];
}

export default spec;
