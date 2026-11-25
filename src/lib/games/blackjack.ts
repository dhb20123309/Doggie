// 21点（Blackjack）：玩家 vs 庄家AI。发牌、要牌/停牌，爆点判负，点数近21者胜。
import type { GameSpec, GAction, GView } from "./types";
import { shuffle, randInt } from "./types";
import { makeStandard, bjValue, cardLabel, type PCard } from "./cards";

type S = { shoe: PCard[]; player: PCard[]; dealer: PCard[]; turn: number; over: boolean; winner: number; plies: number };
const draw = (s: S): [PCard | null, S] => { if (!s.shoe.length) return [null, s]; const shoe = s.shoe.slice(); const c = shoe.shift()!; return [c, { ...s, shoe }]; };
const push = (arr: PCard[], c: PCard): PCard[] => [...arr, c];

const spec: GameSpec<S> = {
  id: "blackjack",
  name: "21点",
  category: "card",
  players: "2-6人",
  ruleSummary: "与庄家比点数，不爆点更接近21者赢",
  simplified: "本版本采用简化规则：单副牌；无分注/加倍/分牌；庄家固定 16 点以下要牌、17 点以上停牌；平局退还。",
  undoable: false,
  maxTurns: 30,
  create: (_seats, rng) => {
    let s: S = { shoe: shuffle(makeStandard(), rng), player: [], dealer: [], turn: 0, over: false, winner: -1, plies: 0 };
    for (let i = 0; i < 2; i++) { const [c, ns] = draw(s); s = ns; if (c) s = { ...s, player: push(s.player, c) }; }
    for (let i = 0; i < 2; i++) { const [c, ns] = draw(s); s = ns; if (c) s = { ...s, dealer: push(s.dealer, c) }; }
    if (bjValue(s.player) === 21 || bjValue(s.dealer) === 21) s = settle(s);
    return s;
  },
  turnOf: (s) => s.turn,
  legalActions: (s) => (s.over ? [] : [{ kind: "hit", label: "要牌" }, { kind: "stand", label: "停牌" }]),
  apply: (s, a) => {
    if (s.over) return null;
    if (a.kind === "hit") {
      const [c, ns] = draw(s);
      if (!c) return settle(ns);
      ns.player = push(ns.player, c);
      if (bjValue(ns.player) > 21) return { ...ns, over: true, winner: 1, plies: s.plies + 1 };
      return { ...ns, plies: s.plies + 1 };
    }
    if (a.kind === "stand") return settle(dealDealer(s));
    return null;
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === -1 || s.winner === 2 ? "draw" : s.winner === seat ? "win" : "lose"),
  aiMove: (s) => {
    // 只在玩家座位被调用时兜底（正常由玩家操作）
    const v = bjValue(s.player);
    return v < 17 ? { kind: "hit" } : { kind: "stand" };
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.player) && Array.isArray(o.dealer) ? o : null; },
  view: (s) => ({
    kind: "cards",
    hands: [
      { seat: 0, cards: s.player.map((c) => ({ id: c.id, token: String(c.suit), label: cardLabel(c) })) },
      { seat: 1, cards: s.dealer.map((c, i) => ({ id: c.id, token: !s.over && i === 1 ? "back" : String(c.suit), label: !s.over && i === 1 ? "" : cardLabel(c) })) },
    ],
    notes: [`你 ${bjValue(s.player)} 点 · 庄家${s.over ? ` ${bjValue(s.dealer)} 点` : ` 明牌 ${bjValue([s.dealer[0]])} +?`} · 余牌 ${s.shoe.length}`],
  }),
  acceptDraw: () => false,
  endLine: (s, name) => (s.winner === 2 ? "21点通吃，你和庄家都到21" : s.winner === 0 ? `${name} 的21点输了（庄家点数更大）` : s.winner === 1 ? `${name} 在21点赢了你` : "21点平局"),
};

function dealDealer(s: S): S {
  const ns = { ...s, dealer: s.dealer.slice(), shoe: s.shoe.slice() };
  while (bjValue(ns.dealer) < 17 && ns.shoe.length) ns.dealer.push(ns.shoe.shift()!);
  return ns;
}
function settle(s: S): S {
  const p = bjValue(s.player), d = bjValue(s.dealer);
  let winner: number;
  if (p > 21) winner = 1;
  else if (d > 21) winner = 0;
  else if (p === 21 && s.player.length === 2) winner = 0;
  else if (d === 21 && s.dealer.length === 2) winner = 1;
  else winner = p > d ? 0 : p < d ? 1 : 2;
  void randInt;
  return { ...s, over: true, winner };
}

export default spec;
