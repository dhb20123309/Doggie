// 五子棋 / 中国象棋 GameSpec 适配器：直接复用 duel-engine 已验证的规则原语，不改一行逻辑。
import type { GameSpec, GAction, GView } from "./types";
import {
  GOMO_N, gomokuCreate, gomokuWin, gomokuFull, gomokuAiMove, gomokuSerialize, gomokuDeserialize,
  xiangqiCreate, xiangqiLegalMoves, xiangqiStatus, xiangqiAiMove, xiangqiApply, xiangqiInCheck,
  type GomokuBoard, type XState,
} from "../duel-engine";

/* ---------- 五子棋 ---------- */
type GS = { b: number[]; turn: number; over: boolean; winner: number };
export const gomokuSpec: GameSpec<GS> = {
  id: "gomoku",
  name: "五子棋",
  category: "board",
  players: "2人",
  ruleSummary: "黑先，横竖斜连成五子即胜",
  undoable: true,
  maxTurns: 225,
  create: () => ({ b: Array(GOMO_N * GOMO_N).fill(0), turn: 0, over: false, winner: 0 }),
  turnOf: (s) => s.turn,
  legalActions: (s) => (s.over ? [] : s.b.map((v, i) => (v ? null : { kind: "put", n: i })).filter(Boolean) as GAction[]),
  apply: (s, a) => {
    if (s.over || a.kind !== "put" || a.n == null || s.b[a.n]) return null;
    const board = gomokuDeserialize(s.b);
    board[a.n] = s.turn === 0 ? 1 : 2;
    const w = gomokuWin(board, Math.floor(a.n / GOMO_N), a.n % GOMO_N);
    return { b: gomokuSerialize(board), turn: s.turn === 0 ? 1 : 0, over: w || gomokuFull(board), winner: w ? (s.turn === 0 ? 1 : 2) : 0 };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === 0 ? "draw" : (s.winner === 1) === (seat === 0) ? "win" : "lose"),
  aiMove: (s) => {
    const mv = gomokuAiMove(gomokuDeserialize(s.b));
    return mv ? { kind: "put", n: mv.r * GOMO_N + mv.c } : null;
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as GS; return o && Array.isArray(o.b) && o.b.length === 225 ? o : null; },
  view: (s, _sel, hints) => {
    const hs = new Set(hints.filter((h) => h.kind === "put").map((h) => h.n!));
    return {
      kind: "grid", rows: GOMO_N, cols: GOMO_N, lineStyle: "cross",
      cells: s.b.map((v, i) => ({ r: Math.floor(i / GOMO_N), c: i % GOMO_N, token: v === 1 ? "blk" : v === 2 ? "wht" : "", hint: hs.has(i) })),
    } as GView;
  },
  acceptDraw: (s) => s.b.filter(Boolean).length > 20,
  endLine: (s, name) => (s.winner === 0 ? "五子棋下满了，平局" : s.winner === 1 ? `${name} 五子连珠赢了` : `${name} 输了这局五子棋`),
};

/* ---------- 中国象棋 ---------- */
type XS = { st: XState; turn: number; over: boolean; winner: number };
export const xiangqiSpec: GameSpec<XS> = {
  id: "xiangqi",
  name: "中国象棋",
  category: "board",
  players: "2人",
  ruleSummary: "红先，将死对方老将获胜",
  undoable: true,
  maxTurns: 120,
  create: () => ({ st: xiangqiCreate(), turn: 0, over: false, winner: 0 }),
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over) return [];
    const acts: GAction[] = [];
    for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) for (const m of xiangqiLegalMoves(s.st, r, c)) acts.push({ kind: "move", from: { r, c }, to: m });
    return acts;
  },
  apply: (s, a) => {
    if (s.over || a.kind !== "move" || !a.from || !a.to) return null;
    const nx = xiangqiApply(s.st, a.from, a.to);
    if (!nx) return null;
    const st = xiangqiStatus(nx);
    const over = st !== "playing";
    return { st: nx, turn: s.turn === 0 ? 1 : 0, over, winner: over ? (st === "draw" ? 0 : s.turn) : 0 };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === 0 ? "draw" : s.winner === seat ? "win" : "lose"),
  aiMove: (s) => {
    const mv = xiangqiAiMove(s.st);
    return mv ? { kind: "move", from: mv.from, to: mv.to } : null;
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as XS; return o && o.st && Array.isArray(o.st.board) && o.st.board.length === 10 ? o : null; },
  view: (s, sel, hints) => {
    const hs = new Set(hints.filter((h) => h.kind === "move").map((h) => `${h.to!.r},${h.to!.c}`));
    const GLYPH: Record<string, string> = { r车: "車", r马: "傌", r炮: "炮", r兵: "兵", r士: "仕", r相: "相", r帅: "帥", b车: "俥", b马: "馬", b炮: "砲", b卒: "卒", b士: "士", b象: "象", b将: "將" };
    return {
      kind: "grid", rows: 10, cols: 9, lineStyle: "cross",
      cells: s.st.board.flatMap((row, r) => row.map((v, c) => ({ r, c, token: v ? GLYPH[v] ?? v[1] : "", sel: sel?.kind === "move" && !sel.to && sel.from?.r === r && sel.from?.c === c, hint: hs.has(`${r},${c}`) }))),
      notes: [xiangqiInCheck(s.st, s.turn === 0 ? "r" : "b") && !s.over ? "你被将军了！" : ""].filter(Boolean),
    } as GView;
  },
  acceptDraw: (s) => s.st.noCaptureHalfMoves > 20,
  endLine: (s, name) => (s.winner === 0 ? "象棋60回合未吃子，判和" : s.winner === 0 ? `${name} 被你将死了象棋` : `${name} 赢了这局象棋`),
};
