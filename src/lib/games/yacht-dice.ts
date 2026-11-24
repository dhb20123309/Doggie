// 快艇骰子（Yahtzee）：5颗骰每轮最多重掷2次，填13个类目比总分。单挑版逐轮轮流填格。
import type { GameSpec, GAction, GView } from "./types";
import { randInt } from "./types";

type Cat = { key: string; name: string };
const CATS: Cat[] = [
  { key: "ones", name: "1个数" }, { key: "twos", name: "2个数" }, { key: "threes", name: "3个数" },
  { key: "fours", name: "4个数" }, { key: "fives", name: "5个数" }, { key: "sixes", name: "6个数" },
  { key: "bonus", name: "上区奖励" }, { key: "3same", name: "三条" }, { key: "4same", name: "四条" },
  { key: "fh", name: "葫芦" }, { key: "ss", name: "小顺" }, { key: "bs", name: "大顺" }, { key: "yaht", name: "快艇" }, { key: "chance", name: "机会" },
];
void CATS;

type S = { dice: number[]; rolls: number; turn: number; scores: Record<number, Record<string, number>>; round: number; over: boolean; plies: number };
const catName: Record<string, string> = { ones: "全1", twos: "全2", threes: "全3", fours: "全4", fives: "全5", sixes: "全6", bonus: "上区奖励", "3same": "三条", "4same": "四条", fh: "葫芦", ss: "小顺", bs: "大顺", yaht: "快艇×5", chance: "机会" };

function calc(dice: number[], key: string): number {
  const sum = dice.reduce((a, b) => a + b, 0);
  const cnt = new Array(7).fill(0);
  for (const d of dice) cnt[d]++;
  const nums = Object.keys(catName);
  const idx = nums.indexOf(key);
  void idx;
  if (["ones", "twos", "threes", "fours", "fives", "sixes"].includes(key)) return cnt[key[0] === "o" ? 1 : "t w t f f s".split(" ").indexOf(key[0]) + 1] * 0 + cnt[["ones", "twos", "threes", "fours", "fives", "sixes"].indexOf(key) + 1] * (["ones", "twos", "threes", "fours", "fives", "sixes"].indexOf(key) + 1);
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

const spec: GameSpec<S> = {
  id: "yacht-dice",
  name: "快艇骰子",
  category: "dice",
  players: "2-4人",
  ruleSummary: "每回合掷5骰可重掷两次，选一个类目记分，13轮后总分高者胜",
  simplified: "本版本采用简化规则：13轮双方轮流各打一轮；上区奖励按上区≥63分得35分自动结算；快艇(五条)仅记一次50分；无附加快艇奖。",
  undoable: false,
  maxTurns: 60,
  create: (_seats, rng) => ({ dice: Array.from({ length: 5 }, () => randInt(rng, 6) + 1), rolls: 1, turn: 0, scores: [{}, {}], round: 1, over: false, plies: 0 }),
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
      const scores = { ...s.scores };
      scores[s.turn] = { ...scores[s.turn], [a.s]: calc(s.dice, a.s) };
      // 回合结束切人
      const other = 1 - s.turn;
      const otherLeft = Object.keys(catName).some((k) => k !== "bonus" && scores[other][k] === undefined);
      if (!otherLeft && s.turn !== 0) {
        // 双方都填完 → 结算 bonus
        for (const i of [0, 1]) { const u = upperSum(scores[i]); scores[i].bonus = u >= 63 ? 35 : 0; }
        return { ...s, scores, over: true, plies: s.plies + 1 };
      }
      const nextTurn = scores[other] && Object.keys(catName).some((k) => k !== "bonus" && scores[other][k] === undefined) ? other : s.turn;
      return { ...s, scores, turn: nextTurn, rolls: 1, dice: Array.from({ length: 5 }, () => randInt(Math.random, 6) + 1), round: nextTurn === 0 ? s.round + 1 : s.round, plies: s.plies + 1 };
    }
    return null;
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => {
    const tot = (i: number) => Object.values(s.scores[i]).reduce((a, b) => a + b, 0);
    if (!s.over) return "ongoing";
    return tot(0) === tot(1) ? "draw" : tot(0) > tot(1) ? "win" : "lose";
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
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.dice) && o.dice.length === 5 && o.scores ? o : null; },
  view: (s) => {
    const tot = (i: number) => Object.values(s.scores[i]).reduce((a, b) => a + b, 0);
    return {
      kind: "panel",
      panels: [0, 1].map((i) => ({
        seat: i,
        title: i === 0 ? "你的记分表" : "TA的记分表",
        lines: Object.keys(catName).filter((k) => k !== "bonus").map((k) => `${catName[k]}：${s.scores[i][k] ?? "—"}`),
      })),
      dice: s.dice,
      notes: [`第${s.round}轮 · 已掷${s.rolls}/3 · 总分 你${tot(0)} : TA${tot(1)}${s.over ? ` · 上区奖励 你${s.scores[0].bonus ?? 0} TA${s.scores[1].bonus ?? 0}` : ""}`],
    };
  },
  acceptDraw: () => false,
  endLine: (s, name) => {
    const tot = (i: number) => Object.values(s.scores[i]).reduce((a, b) => a + b, 0);
    return tot(0) > tot(1) ? `快艇骰子你 ${tot(0)}:${tot(1)} ${tot(1)}赢了${name}` : tot(0) < tot(1) ? `${name} 快艇骰子 ${tot(1)}:${tot(0)} 赢了你` : "快艇骰子打了同分";
  },
};

export default spec;
