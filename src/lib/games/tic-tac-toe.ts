// 井字棋：3×3，先连三连者胜。GameSpec 契约实现（seat0=玩家X，seat1=AI O）。
import type { GameSpec, GAction, GView } from "./types";

type S = { cells: (0 | 1 | 2)[]; turn: number; over: boolean; winner: number; plies: number };
const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function winOf(c: (0 | 1 | 2)[]): number {
  for (const l of LINES) if (c[l[0]] && c[l[0]] === c[l[1]] && c[l[1]] === c[l[2]]) return c[l[0]];
  return 0;
}

const spec: GameSpec<S> = {
  id: "tictactoe",
  name: "井字棋",
  category: "board",
  players: "2人",
  ruleSummary: "横竖斜三连即胜",
  undoable: true,
  maxTurns: 9,
  create: () => ({ cells: Array(9).fill(0), turn: 0, over: false, winner: 0, plies: 0 }),
  turnOf: (s) => s.turn,
  legalActions: (s) => (s.over ? [] : s.cells.map((v, i) => (v ? null : { kind: "put", n: i })).filter(Boolean) as GAction[]),
  apply: (s, a) => {
    if (s.over || a.kind !== "put" || a.n == null || s.cells[a.n]) return null;
    const cells = s.cells.slice() as (0 | 1 | 2)[];
    cells[a.n] = s.turn === 0 ? 1 : 2;
    const w = winOf(cells);
    return { cells, turn: s.turn === 0 ? 1 : 0, over: w !== 0 || cells.every(Boolean), winner: w, plies: s.plies + 1 };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => {
    if (s.winner === 0) return "draw";
    return (s.winner === 1) === (seat === 0) ? "win" : "lose";
  },
  aiMove: (s) => {
    // 极小极大（3^9 足够快）
    let best = -2, mv: GAction | null = null;
    for (const act of spec.legalActions(s)) {
      const nx = spec.apply(s, act)!;
      const sc = evalState(nx, 0);
      if (sc > best) { best = sc; mv = act; }
    }
    return mv;
  },
  serialize: (s) => s,
  deserialize: (d) => {
    const o = d as S;
    return o && Array.isArray(o.cells) && o.cells.length === 9 ? o : null;
  },
  view: (s, sel, hints) => {
    const hs = new Set(hints.filter((h) => h.kind === "put").map((h) => h.n!));
    return {
      kind: "grid", rows: 3, cols: 3, lineStyle: "square",
      cells: s.cells.map((v, i) => ({ r: Math.floor(i / 3), c: i % 3, token: v === 1 ? "x" : v === 2 ? "o" : "", hint: hs.has(i), sel: sel?.n === i })),
    } as GView;
  },
  acceptDraw: () => false,
  endLine: (s, name) => (s.winner === 0 ? `和棋，${name} 说再来一局` : s.winner === 1 ? `${name} 输了井字棋，有点不服` : `${name} 赢了井字棋`),
};

function evalState(s: S, seat: number): number {
  if (s.winner === 2) return 10 - s.plies; // AI(seat1) 胜
  if (s.winner === 1) return s.plies - 10;
  if (s.over) return 0;
  const acts = spec.legalActions(s);
  if (seat === 1) {
    let best = -2;
    for (const a of acts) best = Math.max(best, evalState(spec.apply(s, a)!, 0));
    return best;
  }
  let best = 2;
  for (const a of acts) best = Math.min(best, evalState(spec.apply(s, a)!, 1));
  return best;
}

export default spec;
