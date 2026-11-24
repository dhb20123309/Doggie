// 炸金花（三张牌扑克）：下底注→每人3张→比牌。牌型：豹子>顺金>金花>顺子>对子>单张。支持 2-6 人。
import type { GameSpec, GAction, GView } from "./types";
import { shuffle, randInt } from "./types";
import { makeStandard, cardLabel, type PCard } from "./cards";

type S = { hands: PCard[][]; pot: number; turn: number; phase: "bet" | "show" | "over"; over: boolean; winner: number; plies: number; seen: boolean[]; seats: number; folded: boolean[] };
const RANK_ORDER = (r: number) => (r === 14 ? 15 : r); // A 最大

function handScore(cs: PCard[]): { tier: number; hi: number[] } {
  const rs = cs.map((c) => RANK_ORDER(c.rank)).sort((a, b) => a - b);
  const flush = new Set(cs.map((c) => c.suit)).size === 1;
  const straight = rs[2] - rs[0] === 2 && rs[1] - rs[0] === 1;
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
const aliveOf = (s: { folded: boolean[] }) => s.folded.map((f, i) => (!f ? i : -1)).filter((i) => i >= 0);
function nextAlive(s: S, from: number): number {
  for (let k = 1; k <= s.seats; k++) { const i = (from + k) % s.seats; if (!s.folded[i]) return i; }
  return from;
}

const spec: GameSpec<S> = {
  id: "zha-jin-hua",
  name: "炸金花",
  category: "card",
  players: "2-6人",
  ruleSummary: "三张比牌型，豹子最大，敢跟到底者赢底池",
  simplified: "本版本采用简化规则：固定每轮各跟 10，两轮后人人可要求比牌；只剩一家未弃即直接赢池；比牌时按存活各家两两取最强者胜；不分边池。",
  undoable: false,
  maxTurns: 40,
  minSeats: 2,
  maxSeats: 6,
  create: (seatsRaw, rng) => {
    const seats = Math.max(2, Math.min(6, Math.floor(seatsRaw || 2)));
    const d = shuffle(makeStandard(), rng);
    const hands: PCard[][] = [];
    for (let i = 0; i < seats; i++) hands.push([d[i * 3], d[i * 3 + 1], d[i * 3 + 2]]);
    return { hands, pot: 10 * seats, turn: 0, phase: "bet", over: false, winner: -1, plies: 0, seen: Array(seats).fill(false), seats, folded: Array(seats).fill(false) };
  },
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over || s.phase !== "bet") return [];
    const acts: GAction[] = [{ kind: "call", label: "跟注 10" }];
    if (s.plies >= 2) acts.push({ kind: "compare", label: "比牌" });
    acts.push({ kind: "fold", label: "弃牌" });
    if (!s.seen[s.turn]) acts.push({ kind: "see", label: "看牌" });
    return acts;
  },
  apply: (s, a) => {
    if (s.over) return null;
    let pot = s.pot, turn = s.turn, over: boolean = s.over, winner = s.winner, plies = s.plies;
    const seen = s.seen.slice();
    const folded = s.folded.slice();
    if (a.kind === "see") { seen[turn] = true; return { ...s, seen, plies }; }
    if (a.kind === "call") { pot += 10; plies++; turn = nextAlive(s, turn); }
    else if (a.kind === "fold") {
      folded[turn] = true; plies++;
      const alive = folded.map((f, i) => (!f ? i : -1)).filter((i) => i >= 0);
      if (alive.length === 1) { over = true; winner = alive[0]; }
      else turn = nextAlive({ ...s, folded }, turn);
    } else if (a.kind === "compare") {
      // 比牌：存活者两两比较取最强
      const alive = aliveOf({ folded });
      let best = alive[0];
      for (const i of alive) if (cmp(handScore(s.hands[i]), handScore(s.hands[best])) > 0) best = i;
      over = true; winner = best; plies++;
    }
    if (!over && plies >= 6 * s.seats) {
      const alive = aliveOf({ folded });
      let best = alive[0];
      for (const i of alive) if (cmp(handScore(s.hands[i]), handScore(s.hands[best])) > 0) best = i;
      over = true; winner = best;
    }
    return { ...s, pot, turn, phase: over ? "over" : "bet", over, winner, plies, seen, folded };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === -1 ? "draw" : s.winner === seat ? "win" : "lose"),
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    if (!acts.length) return null;
    const sc = handScore(s.hands[s.turn]);
    const strong = sc.tier >= 3;
    if (acts.some((a) => a.kind === "compare") && (strong || s.plies > s.seats * 2)) return acts.find((a) => a.kind === "compare")!;
    if (!strong && s.plies > s.seats && Math.random() < 0.3) return acts.find((a) => a.kind === "fold") ?? acts[0];
    return acts.find((a) => a.kind === "call") ?? acts[randInt(Math.random, acts.length)];
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.hands) && o.hands.length >= 2 && o.hands.length === (o.seats ?? o.hands.length) ? o : null; },
  view: (s) => ({
    kind: "cards",
    hands: s.hands.map((h, i) => ({ seat: i, cards: h.map((c) => ({ id: c.id, token: i !== 0 && !s.seen[i] && !s.over ? "back" : String(c.suit), label: i !== 0 && !s.seen[i] && !s.over ? "" : cardLabel(c) })) })),
    notes: [`底池 ${s.pot} · ${s.seats}人局${s.folded.filter(Boolean).length ? ` · 已弃 ${s.folded.filter(Boolean).length} 家` : ""} · ${s.over ? `胜者【${seatName(s.winner)}】` : s.seen[0] ? "你的牌型：" + tierName(handScore(s.hands[0])) : "先看牌再决定"}`],
  }),
  acceptDraw: () => false,
  endLine: (s, name) => (s.winner === 0 ? `${name} 在炸金花里跟你比了牌，输了底池 ${s.pot}` : s.folded[1] ? `${name} 炸金花弃牌了，你收下底池` : `${name} 的炸金花赢走了底池 ${s.pot}`),
};
function tierName(x: { tier: number }): string {
  return ["", "单张", "对子", "顺子", "金花", "顺金", "豹子"][x.tier];
}
function seatName(seat: number): string {
  return seat === 0 ? "你" : seat === 1 ? "TA" : `小机 ${seat - 1}`;
}

export default spec;
