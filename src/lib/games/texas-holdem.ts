// 德州扑克（单挑简化）：翻前/翻后四轮下注，52张牌比最佳五张牌型。固定盲注、无限注封顶底池。
import type { GameSpec, GAction, GView } from "./types";
import { shuffle, randInt } from "./types";
import { makeStandard, holdemScore, cardLabel, type PCard } from "./cards";

type S = {
  hero: PCard[]; vill: PCard[]; board: PCard[]; deck: PCard[]; street: number; // 0翻前1翻牌2转牌3河牌4摊牌
  pot: number; bets: [number, number]; turn: number; over: boolean; winner: number; plies: number; lastRaise: number; folded: boolean[];
};
const BLIND = 10;
function newStreet(s: S): S {
  return { ...s, bets: [0, 0], lastRaise: 0, turn: 0 };
}

const spec: GameSpec<S> = {
  id: "texas-holdem",
  name: "德州扑克",
  category: "card",
  players: "2-6人",
  ruleSummary: "两张手牌配五张公共牌，最佳五张牌型赢底池",
  simplified: "本版本采用简化规则：两人单挑；固定大小盲(10/5)；每街跟注/加注(限底池)/弃牌三选一，无全下分边池；同一人连续两次行动且注额相同即过街。",
  undoable: false,
  maxTurns: 40,
  create: (_seats, rng) => {
    const d = shuffle(makeStandard(), rng);
    return { hero: [d[0], d[1]], vill: [d[2], d[3]], board: [], deck: d.slice(4), street: 0, pot: BLIND * 1.5, bets: [BLIND, BLIND * 0.5], turn: 0, over: false, winner: -1, plies: 0, lastRaise: BLIND, folded: [false, false] };
  },
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over || s.street > 3) return [];
    const me = s.bets[s.turn], foe = s.bets[1 - s.turn];
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
    const bets = [...s.bets] as [number, number];
    const folded = s.folded.slice();
    if (a.kind === "fold") { folded[turn] = true; return { ...s, pot, bets, turn, street, over: true, winner: 1 - turn, plies: plies + 1, lastRaise, folded }; }
    if (a.kind === "call" || a.kind === "check") {
      if (a.kind === "call") { const need = bets[1 - turn] - bets[turn]; bets[turn] += need; pot += need; }
      const even = bets[0] === bets[1];
      if (even && (a.kind === "check" || lastRaise === bets[turn])) {
        // 过街
        const deck = s.deck.slice();
        let board = s.board.slice();
        street++;
        if (street === 1) board = [...board, deck.shift()!, deck.shift()!, deck.shift()!];
        else if (street <= 3) board = [...board, deck.shift()!];
        if (street >= 4) return showdown({ ...s, board, deck, pot, bets, street, plies: plies + 1, lastRaise: 0, folded });
        return newStreet({ ...s, board, deck, pot, bets, street, plies: plies + 1, lastRaise: 0, folded });
      }
      turn = 1 - turn;
    } else if (a.kind === "raise") {
      const target = a.n ?? bets[1 - turn] + 10;
      const add = Math.max(target - bets[turn], 0);
      bets[turn] += add; pot += add; lastRaise = bets[turn]; turn = 1 - turn;
    } else return null;
    return { ...s, pot, bets, turn, street, plies: plies + 1, lastRaise, folded };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === -1 ? "draw" : s.winner === seat ? "win" : "lose"),
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    if (!acts.length) return null;
    const sc = holdemScore([...s.vill, ...s.board]);
    const strong = sc.rank >= 2;
    const call = acts.find((x) => x.kind === "call" || x.kind === "check");
    const raise = acts.find((x) => x.kind === "raise");
    const fold = acts.find((x) => x.kind === "fold");
    if (strong && raise && Math.random() < 0.6) return raise;
    if (sc.rank === 0 && s.bets[1] > s.bets[0] * 3 && fold && Math.random() < 0.4) return fold;
    return call ?? acts[randInt(Math.random, acts.length)];
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.hero) && o.hero.length === 2 ? o : null; },
  view: (s) => ({
    kind: "cards",
    hands: [
      { seat: 0, cards: s.hero.map((c) => ({ id: c.id, token: String(c.suit), label: cardLabel(c) })) },
      { seat: 1, cards: s.vill.map((c) => ({ id: c.id, token: s.over || s.street > 3 ? String(c.suit) : "back", label: s.over || s.street > 3 ? cardLabel(c) : "" })) },
    ],
    tableCards: s.board.map((c) => ({ id: c.id, token: String(c.suit), label: cardLabel(c) })),
    notes: [`底池 ${Math.round(s.pot)} · ${["翻前", "翻牌", "转牌", "河牌", "摊牌"][Math.min(s.street, 4)]}${s.over && !s.folded.some(Boolean) ? ` · 你:${tierName(holdemScore([...s.hero, ...s.board]).rank)} TA:${tierName(holdemScore([...s.vill, ...s.board]).rank)}` : ""}`],
  }),
  acceptDraw: () => false,
  endLine: (s, name) => (s.folded[1] ? `${name} 在德扑里弃牌了，你收下底池` : s.folded[0] ? `${name} 逼得你在德扑弃了牌` : s.winner === 0 ? `${name} 的德扑被你比牌赢了` : s.winner === 1 ? `${name} 德扑摊牌赢了你` : "德扑平分底池"),
};
function showdown(s: S): S {
  const a = holdemScore([...s.hero, ...s.board]), b = holdemScore([...s.vill, ...s.board]);
  const cmpv = a.rank !== b.rank ? a.rank - b.rank : a.tie.join().localeCompare(b.tie.join());
  return { ...s, over: true, winner: cmpv > 0 ? 0 : cmpv < 0 ? 1 : -1, street: 4 };
}
function tierName(r: number): string {
  return ["高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺"][r];
}

export default spec;
