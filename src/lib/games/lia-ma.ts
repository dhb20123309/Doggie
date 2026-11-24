// 吹牛骰（Liar's Dice）：各5颗暗骰，轮流叫"全场至少N个X点"（1为赖子），不信就开。
import type { GameSpec, GAction, GView } from "./types";
import { randInt } from "./types";

type S = { dice: number[][]; alive: boolean[]; bid: { n: number; face: number } | null; turn: number; prevBidder: number; over: boolean; winner: number; round: number; plies: number; lastResult: string };
const CN = ["", "一", "二", "三", "四", "五", "六"];

function countFace(all: number[], face: number): number {
  return all.filter((d) => d === face || (face !== 1 && d === 1)).length;
}
function totalDice(alive: boolean[], dice: number[][]): number {
  return dice.reduce((a, h, i) => a + (alive[i] ? h.length : 0), 0);
}

const spec: GameSpec<S> = {
  id: "bluff-dice",
  name: "吹牛骰子",
  category: "dice",
  players: "2-6人",
  ruleSummary: "叫全场某点数总个数（越叫越大），不信对方就喊开，说谎者输一局",
  simplified: "本版本采用简化规则：两人局各5颗；1点为赖子通算所有点数（叫1时1只算自己）；同点数只能加数量、换点数可减1个；输家扣一颗骰子，先被扣光者负。",
  undoable: false,
  maxTurns: 60,
  create: (_seats, rng) => newRound({ dice: [[], []], alive: [true, true], bid: null, turn: 0, prevBidder: -1, over: false, winner: -1, round: 1, plies: 0, lastResult: "" }, rng),
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over) return [];
    const acts: GAction[] = [];
    const b = s.bid;
    for (let n = 1; n <= 10; n++) {
      for (let f = 1; f <= 6; f++) {
        if (b) {
          if (f === b.face) { if (n <= b.n) continue; }
          else { if (n < b.n - 1 || (n === b.n - 1 && f > b.face)) continue; if (n < b.n - 1) continue; }
          // 标准规则：更大数量任意面；或同数量更大面。这里放宽为 (n>b.n) 或 (n===b.n && f>b.face)
          const ok = n > b.n || (n === b.n && f > b.face);
          if (!ok) continue;
        }
        acts.push({ kind: "bid", n, s: String(f), label: `至少 ${n} 个${CN[f]}` });
      }
    }
    if (b) acts.push({ kind: "challenge", label: `开！我不信` });
    return acts.slice(0, 40);
  },
  apply: (s, a) => {
    if (s.over) return null;
    if (a.kind === "bid" && a.n && a.s) {
      return { ...s, bid: { n: a.n, face: Number(a.s) }, prevBidder: s.turn, turn: 1 - s.turn, plies: s.plies + 1 };
    }
    if (a.kind === "challenge" && s.bid) {
      const all = [...(s.alive[0] ? s.dice[0] : []), ...(s.alive[1] ? s.dice[1] : [])];
      const real = countFace(all, s.bid.face);
      const liar = s.prevBidder;
      const challengedTruthful = real >= s.bid.n;
      const loser = challengedTruthful ? liar : (1 - liar) === liar ? 1 - liar : liar;
      // 说谎者输；若叫的是真话则质疑者输
      const actualLoser = challengedTruthful ? 1 - liar : liar;
      void loser;
      const alive = s.alive.slice();
      const dice = s.dice.map((d) => d.slice());
      dice[actualLoser] = dice[actualLoser].slice(0, -1);
      const dead = dice[actualLoser].length === 0;
      const resultTxt = `${["你", "TA"][liar]}叫了${s.bid.n}个${CN[s.bid.face]}，实际有${real}个 → ${["你", "TA"][actualLoser]}输了这局`;
      if (dead) return { ...s, dice, alive, over: true, winner: 1 - actualLoser, lastResult: resultTxt, plies: s.plies + 1 };
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
    if (s.bid) {
      // 判断是否开：我手里的加上期望也不够 → 开
      const foeExpect = Math.floor(totalDice(s.alive, s.dice) / 3);
      if (myCount + foeExpect < s.bid.n - 1 && Math.random() < 0.8) return acts.find((a) => a.kind === "challenge")!;
    }
    if (!bids.length) return acts[0];
    // 选一个接近自己能支撑的叫价
    const all = [...mine, ...mine]; // 粗略：假设对方与自己持有一样多
    const scored = bids.map((b) => {
      const est = countFace(all, Number(b.s)) / 2 + Math.floor(totalDice(s.alive, s.dice) / 6) + 1;
      return { b, diff: Math.abs(est - b.n!) };
    });
    scored.sort((a, b) => a.diff - b.diff);
    return Math.random() < 0.7 ? scored[0].b : bids[randInt(Math.random, bids.length)];
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.dice) && o.dice.length === 2 ? o : null; },
  view: (s) => ({
    kind: "dice",
    dice: s.dice[0],
    diceCup: s.dice[1].map(() => "?").join(" "),
    notes: [
      `当前叫价：${s.bid ? `至少 ${s.bid.n} 个${CN[s.bid.face]}` : "未叫"} · 第${s.round}局`,
      `你的骰：${s.dice[0].map((d) => CN[d]).join(" ")}（TA剩${s.dice[1].length}颗）`,
      s.lastResult || "",
    ].filter(Boolean),
  }),
  acceptDraw: () => false,
  endLine: (s, name) => (s.winner === 0 ? `${name} 的吹牛骰被你抓到说谎，赢下整场` : s.winner === 1 ? `${name} 在吹牛骰里把你诈到了没骰子` : "吹牛骰不分胜负"),
};
function newRound(base: S, rng: () => number): S {
  return { ...base, dice: [Array.from({ length: base.dice[0].length || 5 }, () => randInt(rng, 6) + 1), Array.from({ length: base.dice[1].length || 5 }, () => randInt(rng, 6) + 1)], bid: null, prevBidder: -1, turn: (base.round % 2) as 0 | 1 };
}

export default spec;
