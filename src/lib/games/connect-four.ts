// 四子连珠（Connect Four）：7列6行，落到底部，先连四胜。seat0=红玩家，seat1=黄AI。
import type { GameSpec, GAction, GView } from "./types";

const COLS = 7, ROWS = 6; // ROWS: r0=顶
type S = { grid: (0 | 1 | 2)[][]; turn: number; over: boolean; winner: number; plies: number };

function dropRow(g: (0 | 1 | 2)[][], c: number): number {
  for (let r = ROWS - 1; r >= 0; r--) if (!g[r][c]) return r;
  return -1;
}
function winAt(g: (0 | 1 | 2)[][], r: number, c: number): number {
  const v = g[r][c];
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    let n = 1;
    for (const sgn of [1, -1]) for (let k = 1; k < 4; k++) {
      const rr = r + dr * sgn * k, cc = c + dc * sgn * k;
      if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || g[rr][cc] !== v) break;
      n++;
    }
    if (n >= 4) return v;
  }
  return 0;
}

const spec: GameSpec<S> = {
  id: "connectfour",
  name: "四子连珠",
  category: "board",
  players: "2人",
  ruleSummary: "轮流投币入列，先连四枚成线者胜",
  undoable: true,
  maxTurns: 42,
  create: () => ({ grid: Array.from({ length: ROWS }, () => Array(COLS).fill(0) as (0 | 1 | 2)[]), turn: 0, over: false, winner: 0, plies: 0 }),
  turnOf: (s) => s.turn,
  legalActions: (s) => (s.over ? [] : Array.from({ length: COLS }, (_, c) => (dropRow(s.grid, c) >= 0 ? { kind: "drop", n: c } : null)).filter(Boolean) as GAction[]),
  apply: (s, a) => {
    if (s.over || a.kind !== "drop" || a.n == null) return null;
    const r = dropRow(s.grid, a.n);
    if (r < 0) return null;
    const grid = s.grid.map((row) => row.slice()) as (0 | 1 | 2)[][];
    grid[r][a.n] = s.turn === 0 ? 1 : 2;
    const w = winAt(grid, r, a.n);
    const full = grid.every((row) => row.every(Boolean));
    return { grid, turn: s.turn === 0 ? 1 : 0, over: w !== 0 || full, winner: w, plies: s.plies + 1 };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === 0 ? "draw" : (s.winner === 1) === (seat === 0) ? "win" : "lose"),
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    // 一层前瞻：能赢就赢，挡不住就挡，其余偏好中路
    for (const a of acts) { const nx = spec.apply(s, a)!; if (nx.winner === 2) return a; }
    for (const a of acts) { const my = { ...s, turn: 0 }; const nx = spec.apply(my as S, a)!; if (nx.winner === 1) return a; }
    let best = acts[0], sc = -1e9;
    for (const a of acts) {
      const nx = spec.apply(s, a)!;
      const v = evalBoard(nx) + Math.random() * 6 + (3 - Math.abs(a.n! - 3)) * 4;
      if (v > sc) { sc = v; best = a; }
    }
    return best ?? acts[0];
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.grid) && o.grid.length === ROWS ? o : null; },
  view: (s, _sel, hints) => {
    const hs = new Set(hints.filter((h) => h.kind === "drop").map((h) => h.n!));
    return {
      kind: "grid", rows: ROWS, cols: COLS, lineStyle: "square",
      cells: s.grid.flatMap((row, r) => row.map((v, c) => ({ r, c, token: v === 1 ? "red" : v === 2 ? "yel" : "", hint: hs.has(c) && !v }))),
      notes: ["点列顶投放棋子"],
    } as GView;
  },
  acceptDraw: (s) => s.plies > 10,
  endLine: (s, name) => (s.winner === 0 ? `四子连珠下满了，和棋` : s.winner === 1 ? `${name} 输掉了四子连珠` : `${name} 赢了四子连珠`),
};

function evalBoard(s: S): number {
  let v = 0;
  const lines: number[][] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (c <= COLS - 4) lines.push([0, 1, 2, 3].map((k) => s.grid[r][c + k]));
    if (r <= ROWS - 4) lines.push([0, 1, 2, 3].map((k) => s.grid[r + k][c]));
    if (r <= ROWS - 4 && c <= COLS - 4) lines.push([0, 1, 2, 3].map((k) => s.grid[r + k][c + k]));
    if (r <= ROWS - 4 && c >= 3) lines.push([0, 1, 2, 3].map((k) => s.grid[r + k][c - k]));
  }
  for (const l of lines) {
    const y = l.filter((x) => x === 2).length, rd = l.filter((x) => x === 1).length, e = l.filter((x) => !x).length;
    if (y && !rd) v += [0, 1, 10, 100, 1000][y];
    if (rd && !y) v -= [0, 1, 12, 120, 1000][rd];
    void e;
  }
  return v;
}

export default spec;
