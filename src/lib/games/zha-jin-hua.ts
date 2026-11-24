// 炸金花（三张牌扑克）：下底注→每人3张→比牌。牌型：豹子>顺金>金花>顺子>对子>单张。
import type { GameSpec, GAction, GView } from "./types";
import { shuffle, randInt } from "./types";
import { makeStandard, cardLabel, type PCard } from "./cards";

type S = { hands: PCard[][]; pot: number; turn: number; phase: "bet" | "show" | "over"; over: boolean; winner: number; plies: number; seen: boolean[] };
const RANK_ORDER = (r: number) => (r === 14 ? 15 : r); // A 最大

function handScore(cs: PCard[]): { tier: number; hi: number[] } {
  const rs = cs.map((c) => RANK_ORDER(c.rank)).sort((a, b) => a - b);
  const flush = new Set(cs.map((c) => c.suit)).size === 1;
  const straight = rs[2] - rs[0] === 2 && rs[1] - rs[0] === 1;
  const wheel = rs.join() === "12,13,15"; // QKA? 不算；A23 顺：rs=[2,3,14]→映射后 [2,3,15] 非顺，简化不认
  void wheel;
  if (rs[0] === rs[1] && rs[1] === rs[2]) return { tier: 6, hi: rs };
  if (straight && flush) return { tier: 5, hi: rs };
  if (flush) return { tier: 4, hi: rs };
  if (straight) return { tier: 3, hi: rs };
  if (rs[0] === rs[1] || rs[1] === rs[2]) { const p = rs[0] === rs[2] ? rs[0] : rs[1] === rs[2] ? rs[1] : rs[0]; const k = rs.find((x) => x !== p)!; return { tier: 2, hi: [p, k] }; }
  return { tier: 1, hi: [...rs].reverse() };
}
function cmp(a: { tier: number; hi: number[] }, b: { tier: number; hi: number[] }): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  for (let i = 0; i < Math.min(a.hi.length, b.hi.length); i++) if (a.hi[i] !== b.hi[i]) return a.hi[i] - b.hi[i];
  return 0;
}

const spec: GameSpec<S> = {
  id: "zha-jin-hua",
  name: "炸金花",
  category: "card",
  players: "2-6人",
  ruleSummary: "三张比牌型，豹子最大，敢跟到底者赢底池",
  simplified: "本版本采用简化规则：两人局；无看牌加注倍数差异与闷牌加倍；固定三轮下注（每轮双方各跟 10），随后强制比牌；不分边池。",
  undoable: false,
  maxTurns: 20,
  create: (_seats, rng) => {
    const d = shuffle(makeStandard(), rng);
    return { hands: [[d[0], d[1], d[2]], [d[3], d[4], d[5]]], pot: 20, turn: 0, phase: "bet", over: false, winner: -1, plies: 0, seen: [false, false] };
  },
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over) return [];
    if (s.phase === "bet") {
      const acts: GAction[] = [{ kind: "call", label: "跟注 10" }];
      if (s.plies >= 2) acts.push({ kind: "compare", label: "比牌" });
      acts.push({ kind: "fold", label: "弃牌" });
      if (!s.seen[s.turn]) acts.push({ kind: "see", label: "看牌" });
      return acts;
    }
    return [];
  },
  apply: (s, a) => {
    if (s.over) return null;
    let pot = s.pot, turn = s.turn, phase = s.phase, over: boolean = s.over, winner = s.winner, plies = s.plies;
    const seen = s.seen.slice();
    if (a.kind === "see") { seen[turn] = true; return { ...s, seen, plies }; }
    if (a.kind === "call") { pot += 10; plies++; turn = 1 - turn; if (plies >= 6) phase = "show"; }
    else if (a.kind === "fold") { over = true; winner = 1 - turn; pot += 0; }
    else if (a.kind === "compare") { phase = "show"; }
    if (phase === "show" && !over) {
      const sa = handScore(s.hands[0]), sb = handScore(s.hands[1]);
      over = true; winner = cmp(sa, sb) >= 0 ? 0 : 1;
    }
    return { ...s, pot, turn, phase, over, winner, plies, seen };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === -1 ? "draw" : s.winner === seat ? "win" : "lose"),
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    const sc = handScore(s.hands[s.turn]);
    const strong = sc.tier >= 3;
    if (acts.some((a) => a.kind === "compare") && (strong || s.plies > 4)) return acts.find((a) => a.kind === "compare")!;
    if (!strong && s.plies > 3 && Math.random() < 0.3) return acts.find((a) => a.kind === "fold") ?? acts[0];
    return acts.find((a) => a.kind === "call") ?? acts[randInt(Math.random, acts.length)];
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.hands) && o.hands.length === 2 ? o : null; },
  view: (s) => ({
    kind: "cards",
    hands: s.hands.map((h, i) => ({ seat: i, cards: h.map((c) => ({ id: c.id, token: i === 1 && !s.seen[1] && !s.over ? "back" : String(c.suit), label: i === 1 && !s.seen[1] && !s.over ? "" : cardLabel(c) })) })),
    notes: [`底池 ${s.pot} · 第${Math.floor(s.plies / 2) + 1}轮 · ${s.over ? `胜者【${["你", "TA"][s.winner]}】` : ["你的牌型：" + tierName(handScore(s.hands[0])), ""].join(" ")}`],
  }),
  acceptDraw: () => false,
  endLine: (s, name) => (s.winner === 0 ? `${name} 在炸金花里跟你比了牌，输了底池 ${s.pot}` : s.winner === 1 ? `${name} 的炸金花赢走了底池 ${s.pot}` : "炸金花平局"),
};
function tierName(x: { tier: number }): string {
  return ["", "单张", "对子", "顺子", "金花", "顺金", "豹子"][x.tier];
}

export default spec;
