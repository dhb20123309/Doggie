// 吹牛骰（Liar's Dice）：各5颗暗骰，轮流叫"全场至少N个X点"（1为赖子），不信就开。支持 2-6 人。
import type { GameSpec, GAction, GView } from "./types";
import { randInt } from "./types";

type S = { dice: number[][]; alive: boolean[]; bid: { n: number; face: number } | null; turn: number; prevBidder: number; over: boolean; winner: number; round: number; plies: number; lastResult: string; seats: number };
const CN = ["", "一", "二", "三", "四", "五", "六"];
const seatName = (seat: number) => (seat === 0 ? "你" : seat === 1 ? "TA" : `小机 ${seat - 1}`);

function countFace(all: number[], face: number): number {
  return all.filter((d) => d === face || (face !== 1 && d === 1)).length;
}
function totalDice(alive: boolean[], dice: number[][]): number {
  return dice.reduce((a, h, i) => a + (alive[i] ? h.length : 0), 0);
}
function nextAlive(s: S, from: number): number {
  for (let k = 1; k <= s.seats; k++) { const i = (from + k) % s.seats; if (s.alive[i]) return i; }
  return from;
}

const spec: GameSpec<S> = {
  id: "bluff-dice",
  name: "吹牛骰子",
  category: "dice",
  players: "2-6人",
  ruleSummary: "叫全场某点数总个数（越叫越大），不信对方就喊开，说谎者输一局",
  simplified: "本版本采用简化规则：每人5颗；1点为赖子通算所有点数（叫1时1只算自己）；只能叫更大数量或同数量更大面；质疑开牌后说谎方扣一颗骰子，先被扣光者出局，存活到最后的人赢。",
  undoable: false,
  maxTurns: 120,
  minSeats: 2,
  maxSeats: 6,
  create: (seatsRaw, rng) => newRound({ dice: [], alive: [], bid: null, turn: 0, prevBidder: -1, over: false, winner: -1, round: 1, plies: 0, lastResult: "", seats: Math.max(2, Math.min(6, Math.floor(seatsRaw || 2))) }, rng),
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over) return [];
    const acts: GAction[] = [];
    const b = s.bid;
    for (let n = 1; n <= 15; n++) {
      for (let f = 1; f <= 6; f++) {
        if (b) {
          const ok = n > b.n || (n === b.n && f > b.face);
          if (!ok) continue;
        }
        acts.push({ kind: "bid", n, s: String(f), label: `至少 ${n} 个${CN[f]}` });
      }
    }
    if (b && s.prevBidder !== s.turn) acts.push({ kind: "challenge", label: `开！我不信` });
    else if (b) acts.push({ kind: "passc", label: "继续叫（必须加码）" , n: 0, s: "reopen" });
    return acts.slice(0, 48);
  },
  apply: (s, a) => {
    if (s.over) return null;
    if (a.kind === "bid" && a.n && a.s) {
      return { ...s, bid: { n: a.n, face: Number(a.s) }, prevBidder: s.turn, turn: nextAlive(s, s.turn), plies: s.plies + 1 };
    }
    if (a.kind === "challenge" && s.bid) {
      const all = s.dice.flatMap((d, i) => (s.alive[i] ? d : []));
      const real = countFace(all, s.bid.face);
      const liar = s.prevBidder;
      const challengedTruthful = real >= s.bid.n;
      // 说谎者输；若叫的是真话则质疑者输
      const actualLoser = challengedTruthful ? s.turn : liar;
      const alive = s.alive.slice();
      const dice = s.dice.map((d) => d.slice());
      dice[actualLoser] = dice[actualLoser].slice(0, -1);
      const dead = dice[actualLoser].length === 0;
      if (dead) alive[actualLoser] = false;
      const survivors = alive.filter(Boolean).length;
      const resultTxt = `${seatName(liar)}叫了${s.bid.n}个${CN[s.bid.face]}，实际有${real}个 → ${seatName(actualLoser)}输了这局`;
      if (survivors <= 1 || (dead && survivors <= 1)) return { ...s, dice, alive, over: true, winner: alive.findIndex(Boolean), lastResult: resultTxt, plies: s.plies + 1 };
      return newRound({ ...s, dice, alive, lastResult: resultTxt, round: s.round + 1, plies: s.plies + 1, winner: -1 }, Math.random);
    }
    return null;
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === -1 ? "draw" : s.winner === seat ? "win" : "lose"),
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    if (!acts.length) return null;
    const bids = acts.filter((a) => a.kind === "bid");
    const mine = s.dice[s.turn];
    const myCount = s.bid ? countFace(mine, s.bid.face) : 0;
    if (s.bid && s.prevBidder !== s.turn) {
      // 判断是否开：我手里的加上期望也不够 → 开
      const foeExpect = Math.floor(totalDice(s.alive, s.dice) / 3);
      if (myCount + foeExpect < s.bid.n - 1 && Math.random() < 0.8) return acts.find((a) => a.kind === "challenge")!;
    }
    if (!bids.length) return acts[0];
    // 选一个接近自己能支撑的叫价
    const est0 = (b: GAction) => countFace(mine, Number(b.s)) + Math.floor((totalDice(s.alive, s.dice) - mine.length) / 6) + 1;
    const scored = bids.map((b) => ({ b, diff: Math.abs(est0(b) - b.n!) }));
    scored.sort((a, b) => a.diff - b.diff);
    return Math.random() < 0.7 ? scored[0].b : bids[randInt(Math.random, bids.length)];
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.dice) && o.dice.length >= 2 && o.dice.length === (o.seats ?? o.dice.length) ? o : null; },
  view: (s) => ({
    kind: "dice",
    dice: s.dice[0],
    diceCup: s.dice.slice(1).map((d, i) => (s.alive[i + 1] ? "?".repeat(d.length) : "出局")).join(" "),
    notes: [
      `当前叫价：${s.bid ? `至少 ${s.bid.n} 个${CN[s.bid.face]}（${seatName(s.prevBidder)}叫的）` : "未叫"} · 第${s.round}局`,
      `你的骰：${s.dice[0].map((d) => CN[d]).join(" ")} · 各家剩骰 ${s.dice.map((d, i) => `${seatName(i)[0]}${d.length}`).join(" ")}`,
      s.lastResult || "",
    ].filter(Boolean),
  }),
  acceptDraw: () => false,
  endLine: (s, name) => (s.winner === 0 ? `${name} 的吹牛骰被你抓到说谎，赢下整场` : s.winner === 1 ? `${name} 在吹牛骰里把你诈到了没骰子` : s.winner > 1 ? `小机笑到了最后，吹牛骰全桌都被诈了` : "吹牛骰不分胜负"),
};
function newRound(base: S, rng: () => number): S {
  const dice = base.dice.length ? base.dice.map((d, i) => (base.alive[i] ? Array.from({ length: d.length || 5 }, () => randInt(rng, 6) + 1) : d)) : Array.from({ length: base.seats }, () => Array.from({ length: 5 }, () => randInt(rng, 6) + 1));
  const alive = base.alive.length ? base.alive : Array(base.seats).fill(true);
  let t = base.turn % base.seats;
  for (let k = 0; k < base.seats; k++) if (alive[t]) break; else t = (t + 1) % base.seats;
  return { ...base, dice, alive, bid: null, prevBidder: -1, turn: t };
}

export default spec;
