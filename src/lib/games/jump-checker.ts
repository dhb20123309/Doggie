// 中国跳棋（六角星简化为菱形棋盘对战版）：9行菱格，双方各10子从对角跳向对面三角区，先全部入营者胜。
// 多人模式沿用同一张菱形盘：seat0 占底部、seat1 占顶部，其余座位在中间行各分一小块出发区，目标仍是对方营地（seat≥2 以顶部为营）。
import type { GameSpec, GAction, GView } from "./types";
import { randInt } from "./types";

// 菱形：row r 有 width(r) 列。r=0..8，width = r<5 ? 4+r : 12-r。
type Cell = { r: number; c: number };
const width = (r: number) => (r < 5 ? 4 + r : 12 - r);
const inBoard = (r: number, c: number) => r >= 0 && r <= 8 && c >= 0 && c < width(r);
// 邻接偏移（菱形网格）
const DIRS: [number, number][] = [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, -1], [1, 0]];
type S = { board: number[][]; turn: number; over: boolean; winner: number; plies: number; seats: number };
const seatName = (seat: number) => (seat === 0 ? "你" : seat === 1 ? "TA" : `小机 ${seat - 1}`);
// 棋子值：0空，1..seats 对应座位+1
const tokenOf = (seat: number) => seat + 1;

function makeBoard(seats: number): number[][] {
  const b: number[][] = [];
  for (let r = 0; r <= 8; r++) b.push(new Array(width(r)).fill(0));
  if (seats <= 2) {
    for (let r = 0; r <= 2; r++) for (let c = 0; c < width(r); c++) b[r][c] = tokenOf(1);
    for (let r = 6; r <= 8; r++) for (let c = 0; c < width(r); c++) b[r][c] = tokenOf(0);
    return b;
  }
  // 多人：顶部给 seat1，底部给 seat0，其余座位各占中间行两侧
  for (let c = 0; c < width(0); c++) b[0][c] = tokenOf(1);
  for (let c = 0; c < width(8); c++) b[8][c] = tokenOf(0);
  const extra = seats - 2;
  const rows = [3, 4, 5];
  let placed = 0;
  for (const r of rows) {
    const w = width(r);
    for (let side = 0; side < 2 && placed < extra; side++) {
      const seat = 2 + placed;
      for (let k = 0; k < 3; k++) {
        const c = side === 0 ? k : w - 1 - k;
        if (c >= 0 && c < w && b[r][c] === 0) b[r][c] = tokenOf(seat);
      }
      placed++;
    }
    if (placed >= extra) break;
  }
  return b;
}
// 营地：seat0 → 顶部 r<=2；seat1 → 底部 r>=6；seat>=2 → 顶部 r<=2（共用冲顶规则）
const goalOf = (seat: number) => (seat === 0 ? (r: number) => r >= 6 : (r: number) => r <= 2);
function homeCount(b: number[][], seat: number): number {
  const g = goalOf(seat), t = tokenOf(seat);
  let has = 0;
  for (let r = 0; r <= 8; r++) for (let c = 0; c < width(r); c++) if (b[r][c] === t && g(r)) has++;
  return has;
}
function totalCount(b: number[][], seat: number): number {
  const t = tokenOf(seat);
  let n = 0;
  for (let r = 0; r <= 8; r++) for (let c = 0; c < width(r); c++) if (b[r][c] === t) n++;
  return n;
}
function allHome(b: number[][], seat: number): boolean {
  const need = totalCount(b, seat);
  return need > 0 && homeCount(b, seat) === need;
}
function movesFrom(b: number[][], cell: Cell, seat: number): Cell[] {
  const out: Cell[] = [];
  const seen = new Set<string>();
  const t = tokenOf(seat);
  const walk = (cur: Cell, board: number[][], depth: number) => {
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
        nb[cur.r][cur.c] = 0; nb[jr][jc] = t;
        walk({ r: jr, c: jc }, nb, depth + 1);
      }
    }
  };
  walk(cell, b, 0);
  return out;
}
function anyMove(b: number[][], seat: number): boolean {
  const t = tokenOf(seat);
  for (let r = 0; r <= 8; r++) for (let c = 0; c < width(r); c++) if (b[r][c] === t && movesFrom(b, { r, c }, seat).length) return true;
  return false;
}

const spec: GameSpec<S> = {
  id: "jump-checker",
  name: "中国跳棋",
  category: "table",
  players: "2-6人",
  ruleSummary: "棋子走一格或隔子连跳，先把全队跳进对面三角营地者胜",
  simplified: "本版本采用简化规则：菱形9行棋盘代替标准六角星；两人对角各10子；三人以上时后加入的座位从中间行出发、同样以顶部为营地；一步内可连续跳跃（像弹珠链）；超时按入营数比多少。",
  undoable: false,
  maxTurns: 120 * 2,
  minSeats: 2,
  maxSeats: 6,
  create: (seatsRaw, rng) => { void rng; const seats = Math.max(2, Math.min(6, Math.floor(seatsRaw || 2))); return { board: makeBoard(seats), turn: 0, over: false, winner: -1, plies: 0, seats }; },
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over) return [];
    const acts: GAction[] = [];
    for (let r = 0; r <= 8; r++) for (let c = 0; c < width(r); c++) {
      if (s.board[r][c] !== tokenOf(s.turn)) continue;
      const ms = movesFrom(s.board, { r, c }, s.turn);
      for (const m of ms) acts.push({ kind: "move", from: { r, c }, to: m, label: `(${r},${c})→(${m.r},${m.c})` });
    }
    return acts;
  },
  apply: (s, a) => {
    if (s.over || a.kind !== "move" || !a.from || !a.to) return null;
    if (s.board[a.from.r]?.[a.from.c] !== tokenOf(s.turn)) return null;
    const ms = movesFrom(s.board, a.from, s.turn);
    if (!ms.some((m) => m.r === a.to!.r && m.c === a.to!.c)) return null;
    const board = s.board.map((row) => row.slice());
    board[a.from.r][a.from.c] = 0;
    board[a.to.r][a.to.c] = tokenOf(s.turn);
    let over = false, winner = -1;
    if (allHome(board, s.turn)) { over = true; winner = s.turn; }
    else if (s.plies + 1 >= spec.maxTurns!) {
      // 超时比入营数
      let best = 0;
      for (let i = 1; i < s.seats; i++) if (homeCount(board, i) > homeCount(board, best)) best = i;
      over = true; winner = best;
    }
    return { ...s, board, turn: over ? s.turn : (s.turn + 1) % s.seats, over, winner, plies: s.plies + 1 };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === -1 ? "draw" : s.winner === seat ? "win" : "lose"),
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    if (!acts.length) return null;
    const g = goalOf(s.turn);
    let best = acts[0], bv = -99;
    for (const a of acts) {
      const v = g(a.to!.r) ? 100 + a.to!.r * (g(8) ? 1 : -1) : g(0) ? a.to!.r : 8 - a.to!.r;
      if (v > bv) { bv = v; best = a; }
    }
    return Math.random() < 0.8 ? best : acts[randInt(Math.random, acts.length)];
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.board) && o.board.length === 9 && (o.seats ?? 2) >= 2 ? o : null; },
  view: (s) => {
    const cells: NonNullable<GViewCells> = [];
    for (let r = 0; r <= 8; r++) {
      const w = width(r);
      for (let c = 0; c < w; c++) {
        const v = s.board[r][c];
        const isGoalTop = r <= 2, isGoalBottom = r >= 6;
        cells.push({ r, c, token: v === tokenOf(0) ? "me" : v === tokenOf(1) ? "foe" : v > 0 ? "goalA" : isGoalTop ? "goalA" : isGoalBottom ? "goalB" : "empty", label: "" });
      }
    }
    return { kind: "grid", rows: 9, cols: 9, lineStyle: "square", cells, notes: [`第${Math.floor(s.plies / s.seats) + 1}回合 · ${s.seats}人局 · ${s.over ? `【${seatName(s.winner)}】全队进营！` : `${seatName(s.turn)}的回合`} · 你在下方(●)，TA在上方(○)`] };
  },
  acceptDraw: () => false,
  endLine: (s, name) => (s.winner === 0 ? `${name} 的跳棋还没归营，你的十颗子先跳满了` : s.winner === 1 ? `${name} 中国跳棋十子齐刷刷进了你的营地` : s.winner > 1 ? `小机的跳棋抢先全员归营` : "跳棋下到一半谁也没堵住谁"),
};
type GViewCells = import("./types").GView extends { cells?: infer C } ? C : never;

export default spec;
