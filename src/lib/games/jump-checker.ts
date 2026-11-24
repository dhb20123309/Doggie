// 中国跳棋（六角星简化为菱形棋盘对战版）：9行菱格，双方各10子从对角跳向对面三角区，先全部入营者胜。
import type { GameSpec, GAction, GView } from "./types";
import { randInt } from "./types";

// 菱形：row r 有 width(r) 列。r=0..8，width = r<5 ? 4+r : 12-r。目标区：我方=r0-2顶部窄区，敌方正相反。
type Cell = { r: number; c: number };
const width = (r: number) => (r < 5 ? 4 + r : 12 - r);
const inBoard = (r: number, c: number) => r >= 0 && r <= 8 && c >= 0 && c < width(r);
// 邻接偏移（菱形网格）
const DIRS: [number, number][] = [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, -1], [1, 0]];
type S = { board: (0 | 1 | 2)[][]; turn: number; sel: Cell | null; over: boolean; winner: number; plies: number };

function makeBoard(): (0 | 1 | 2)[][] {
  const b: (0 | 1 | 2)[][] = [];
  for (let r = 0; r <= 8; r++) b.push(new Array(width(r)).fill(0));
  // 顶部3行放玩家2（TA），底部3行放玩家1（你）
  for (let r = 0; r <= 2; r++) for (let c = 0; c < width(r); c++) b[r][c] = 2;
  for (let r = 6; r <= 8; r++) for (let c = 0; c < width(r); c++) b[r][c] = 1;
  return b;
}
const goalOf = (seat: 1 | 2) => (seat === 1 ? (r: number) => r <= 2 : (r: number) => r >= 6);
function allHome(b: (0 | 1 | 2)[][], seat: 1 | 2): boolean {
  const g = goalOf(seat);
  let need = 0, has = 0;
  for (let r = 0; r <= 8; r++) for (let c = 0; c < width(r); c++) { if (g(r)) need++; if (b[r][c] === seat && g(r)) has++; }
  return need > 0 && need === has;
}
function movesFrom(b: (0 | 1 | 2)[][], cell: Cell, seat: 1 | 2): Cell[] {
  const out: Cell[] = [];
  const seen = new Set<string>();
  const walk = (cur: Cell, board: (0 | 1 | 2)[][], depth: number) => {
    if (depth > 12) return;
    for (const [dr, dc] of DIRS) {
      const nr = cur.r + dr, nc = cur.c + dc;
      if (!inBoard(nr, nc)) continue;
      if (board[nr][nc] === 0) {
        const key = `${nr},${nc}`;
        if (!seen.has(key)) { seen.add(key); out.push({ r: nr, c: nc }); }
        continue;
      }
      // 跳：隔一子空位（含连续跳）
      const jr = nr + dr, jc = nc + dc;
      if (inBoard(jr, jc) && board[jr][jc] === 0) {
        const nb = board.map((row) => row.slice());
        nb[cur.r][cur.c] = 0; nb[jr][jc] = seat;
        walk({ r: jr, c: jc }, nb, depth + 1);
      }
    }
  };
  walk(cell, b, 0);
  return out;
}
function anyMove(b: (0 | 1 | 2)[][], seat: 1 | 2): boolean {
  for (let r = 0; r <= 8; r++) for (let c = 0; c < width(r); c++) if (b[r][c] === seat && movesFrom(b, { r, c }, seat).length) return true;
  return false;
}

const spec: GameSpec<S> = {
  id: "jump-checker",
  name: "中国跳棋",
  category: "table",
  players: "2-6人",
  ruleSummary: "棋子走一格或隔子连跳，先把全队跳进对面三角营地者胜",
  simplified: "本版本采用简化规则：两人对角对战，各10子；菱形9行棋盘代替标准六角星；一步内可连续跳跃（像弹珠链）；无平局判定超时按入营数比多少。",
  undoable: false,
  maxTurns: 120,
  create: (_seats, rng) => { void rng; return { board: makeBoard(), turn: 1, sel: null, over: false, winner: -1, plies: 0 }; },
  turnOf: (s) => s.turn - 1,
  legalActions: (s) => {
    if (s.over) return [];
    const seat = s.turn as 1 | 2;
    const acts: GAction[] = [];
    for (let r = 0; r <= 8; r++) for (let c = 0; c < width(r); c++) {
      if (s.board[r][c] !== seat) continue;
      const ms = movesFrom(s.board, { r, c }, seat);
      for (const m of ms) acts.push({ kind: "move", from: { r, c }, to: m, label: `(${r},${c})→(${m.r},${m.c})` });
    }
    return acts;
  },
  apply: (s, a) => {
    if (s.over || a.kind !== "move" || !a.from || !a.to) return null;
    const seat = s.turn as 1 | 2;
    if (s.board[a.from.r][a.from.c] !== seat) return null;
    const ms = movesFrom(s.board, a.from, seat);
    if (!ms.some((m) => m.r === a.to!.r && m.c === a.to!.c)) return null;
    const board = s.board.map((row) => row.slice());
    board[a.from.r][a.from.c] = 0;
    board[a.to.r][a.to.c] = seat;
    let over = false, winner = -1;
    if (allHome(board, seat)) { over = true; winner = seat - 1; }
    else if (!anyMove(board, (2 - seat) as 1 | 2)) { over = true; winner = seat - 1; }
    return { ...s, board, turn: over ? s.turn : ((2 - seat) as 1 | 2), sel: null, over, winner, plies: s.plies + 1 };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === -1 ? "draw" : s.winner === seat ? "win" : "lose"),
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    if (!acts.length) return null;
    const seat = s.turn as 1 | 2;
    let best = acts[0], bv = -99;
    for (const a of acts) { const v = seat === 2 ? a.to!.r : 8 - a.to!.r; if (v > bv) { bv = v; best = a; } }
    return Math.random() < 0.8 ? best : acts[randInt(Math.random, acts.length)];
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.board) && o.board.length === 9 ? o : null; },
  view: (s) => {
    const rows: GRows = [];
    void rows;
    const cells: NonNullable<GViewCells> = [];
    for (let r = 0; r <= 8; r++) {
      const w = width(r);
      for (let c = 0; c < w; c++) {
        const v = s.board[r][c];
        const isGoalMe = r >= 6, isGoalFoe = r <= 2;
        cells.push({ r, c, token: v === 1 ? "me" : v === 2 ? "foe" : isGoalFoe ? "goalA" : isGoalMe ? "goalB" : "empty", label: "" });
      }
    }
    return { kind: "grid", rows: 9, cols: 9, lineStyle: "square", cells, notes: [`第${Math.floor(s.plies / 2) + 1}回合 · ${s.over ? `【${["你", "TA"][s.winner]}】全队进营！` : ["你的回合", "TA思考中…"][s.turn - 1]} · 你在下方(●)，TA在上方(○)`] };
  },
  acceptDraw: () => false,
  endLine: (s, name) => (s.winner === 0 ? `${name} 的跳棋还没归营，你的十颗子先跳满了` : s.winner === 1 ? `${name} 中国跳棋十子齐刷刷进了你的营地` : "跳棋下到一半谁也没堵住谁"),
};
type GRows = unknown;
type GViewCells = import("./types").GView extends { cells?: infer C } ? C : never;

export default spec;
