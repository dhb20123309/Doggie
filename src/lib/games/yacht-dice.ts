// 快艇骰子（Yahtzee）：5颗骰每轮最多重掷2次，填13个类目比总分。支持 2-4 人轮流填格。
import type { GameSpec, GAction, GView } from "./types";
import { randInt } from "./types";

type S = { dice: number[]; rolls: number; turn: number; scores: Record<string, number>[]; round: number; over: boolean; plies: number; seats: number };
const catName: Record<string, string> = { ones: "全1", twos: "全2", threes: "全3", fours: "全4", fives: "全5", sixes: "全6", bonus: "上区奖励", "3same": "三条", "4same": "四条", fh: "葫芦", ss: "小顺", bs: "大顺", yaht: "快艇×5", chance: "机会" };
const seatName = (seat: number) => (seat === 0 ? "你" : seat === 1 ? "TA" : `小机 ${seat - 1}`);

function calc(dice: number[], key: string): number {
  const sum = dice.reduce((a, b) => a + b, 0);
  const cnt = new Array(7).fill(0);
  for (const d of dice) cnt[d]++;
  if (["ones", "twos", "threes", "fours", "fives", "sixes"].includes(key)) { const face = ["ones", "twos", "threes", "fours", "fives", "sixes"].indexOf(key) + 1; return cnt[face] * face; }
  if (key === "3same") return cnt.some((c) => c >= 3) ? sum : 0;
  if (key === "4same") return cnt.some((c) => c >= 4) ? sum : 0;
  if (key === "fh") return (cnt.some((c) => c === 3) && cnt.some((c) => c === 2)) ? 25 : 0;
  if (key === "ss") { const has = (a: number[]) => a.every((n) => cnt[n]); return has([1, 2, 3, 4]) || has([2, 3, 4, 5]) || has([3, 4, 5, 6]) || has([1, 2, 3, 5]) || has([2, 3, 4, 6]) ? 30 : 0; }
  if (key === "bs") { const has = (a: number[]) => a.every((n) => cnt[n]); return has([1, 2, 3, 4, 5]) || has([2, 3, 4, 5, 6]) ? 40 : 0; }
  if (key === "yaht") return cnt.some((c) => c === 5) ? 50 : 0;
  if (key === "chance") return sum;
  return 0;
}
function upperSum(sc: Record<string, number>): number {
  return ["ones", "twos", "threes", "fours", "fives", "sixes"].reduce((a, k) => a + (sc[k] ?? 0), 0);
}
const totOf = (sc: Record<string, number>) => Object.values(sc).reduce((a, b) => a + b, 0);

const spec: GameSpec<S> = {
  id: "yacht-dice",
  name: "快艇骰子",
  category: "dice",
  players: "2-4人",
  ruleSummary: "每回合掷5骰可重掷两次，选一个类目记分，13轮后总分高者胜",
  simplified: "本版本采用简化规则：13轮各家轮流各打一轮；上区奖励按上区≥63分得35分自动结算；快艇(五条)仅记一次50分；无附加快艇奖。",
  undoable: false,
  maxTurns: 13 * 4 * 3 + 20,
  minSeats: 2,
  maxSeats: 4,
  create: (seatsRaw, rng) => {
    const seats = Math.max(2, Math.min(4, Math.floor(seatsRaw || 2)));
    return { dice: Array.from({ length: 5 }, () => randInt(rng, 6) + 1), rolls: 1, turn: 0, scores: Array.from({ length: seats }, () => ({} as Record<string, number>)), round: 1, over: false, plies: 0, seats };
  },
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over) return [];
    const acts: GAction[] = [];
    if (s.rolls < 3) acts.push({ kind: "reroll", label: "全部重掷" });
    const used = s.scores[s.turn];
    for (const k of Object.keys(catName)) {
      if (k === "bonus") continue;
      if (used[k] !== undefined) continue;
      acts.push({ kind: "keep", s: k, label: `记「${catName[k]}」${calc(s.dice, k)}分` });
    }
    return acts;
  },
  apply: (s, a) => {
    if (s.over) return null;
    if (a.kind === "reroll") {
      if (s.rolls >= 3) return null;
      return { ...s, dice: s.dice.map(() => randInt(Math.random, 6) + 1), rolls: s.rolls + 1, plies: s.plies + 1 };
    }
    if (a.kind === "keep" && a.s) {
      if (a.s === "bonus" || s.scores[s.turn][a.s] !== undefined) return null;
      const scores = s.scores.map((x) => ({ ...x }));
      scores[s.turn] = { ...scores[s.turn], [a.s]: calc(s.dice, a.s) };
      // 找下一个还有空格的家
      let next = s.turn;
      let wrapped = false;
      for (let k = 0; k < s.seats; k++) {
        next = (next + 1) % s.seats;
        if (next === s.turn) wrapped = true;
        if (Object.keys(catName).some((kk) => kk !== "bonus" && scores[next][kk] === undefined)) break;
      }
      const anyLeft = Object.keys(catName).some((kk) => kk !== "bonus" && scores[next][kk] === undefined);
      if (!anyLeft || wrapped) {
        // 全员都填完 → 结算 bonus
        for (let i = 0; i < s.seats; i++) { const u = upperSum(scores[i]); scores[i].bonus = u >= 63 ? 35 : 0; }
        return { ...s, scores, over: true, plies: s.plies + 1 };
      }
      return { ...s, scores, turn: next, rolls: 1, dice: Array.from({ length: 5 }, () => randInt(Math.random, 6) + 1), round: next <= s.turn ? s.round + 1 : s.round, plies: s.plies + 1 };
    }
    return null;
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => {
    if (!s.over) return "ongoing";
    const me = totOf(s.scores[seat]);
    const best = Math.max(...s.scores.map(totOf));
    const tied = s.scores.filter((x) => totOf(x) === best).length;
    if (me === best) return tied > 1 ? "draw" : "win";
    return "lose";
  },
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    if (!acts.length) return null;
    const keeps = acts.filter((a) => a.kind === "keep");
    if (!keeps.length) return acts[0];
    const best = keeps.map((k) => ({ k, v: calc(s.dice, k.s!) })).sort((a, b) => b.v - a.v)[0];
    if (s.rolls < 3 && best.v < 12) return acts.find((a) => a.kind === "reroll") ?? best.k;
    if (s.rolls < 3 && best.v < 18 && Math.random() < 0.5) return acts.find((a) => a.kind === "reroll")!;
    return best.k;
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.dice) && o.dice.length === 5 && Array.isArray(o.scores) && o.scores.length >= 2 && o.scores.length === (o.seats ?? o.scores.length) ? o : null; },
  view: (s) => ({
    kind: "panel",
    panels: s.scores.map((_, i) => ({
      seat: i,
      title: `${seatName(i)}的记分表`,
      lines: Object.keys(catName).filter((k) => k !== "bonus").map((k) => `${catName[k]}：${s.scores[i][k] ?? "—"}`),
    })),
    dice: s.dice,
    notes: [`第${Math.min(s.round, 13)}轮 · 已掷${s.rolls}/3 · ${s.seats}人局 · 总分 ${s.scores.map((x, i) => `${seatName(i)[0]}${totOf(x)}`).join(" ")}`],
  }),
  acceptDraw: () => false,
  endLine: (s, name) => {
    const tots = s.scores.map(totOf);
    const best = Math.max(...tots);
    const champs = tots.map((t, i) => (t === best ? i : -1)).filter((i) => i >= 0);
    const t0 = tots[0], t1 = tots[1] ?? 0;
    if (champs.length > 1) return `快艇骰子 ${champs.map((i) => seatName(i)).join("、")} 同分 ${best} 并列夺冠`;
    const champ = champs[0];
    if (champ === 0) return `快艇骰子你 ${t0} 分力压全场，赢了 ${name}`;
    if (champ === 1) return `${name} 快艇骰子 ${t1}:${t0} 赢了你`;
    return `快艇骰子 ${seatName(champ)} 以 ${best} 分夺冠`;
  },
};

export default spec;
