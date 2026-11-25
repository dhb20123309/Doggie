// 双弈内置引擎：五子棋 + 中国象棋 规则与 AI（纯函数，无外部依赖）
// 棋盘约定：交叉点坐标 {r,c}；象棋 r0=黑方底线 … r9=红方底线，c0..8

export type DuelGame = "gomoku" | "xiangqi";
export interface Pt {
  r: number;
  c: number;
}

/* ==================== 五子棋 ==================== */

export const GOMO_N = 15;
/** 0 空 / 1 黑(玩家) / 2 白(AI) */
export type GomokuBoard = Uint8Array;

export function gomokuCreate(): GomokuBoard {
  return new Uint8Array(GOMO_N * GOMO_N);
}
const gAt = (b: GomokuBoard, r: number, c: number) => b[r * GOMO_N + c];

/** 落子后是否连五（只查经过该点的四方向） */
export function gomokuWin(b: GomokuBoard, r: number, c: number): boolean {
  const v = gAt(b, r, c);
  if (!v) return false;
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  for (const [dr, dc] of dirs) {
    let n = 1;
    for (const s of [1, -1]) {
      let rr = r + dr * s;
      let cc = c + dc * s;
      while (rr >= 0 && rr < GOMO_N && cc >= 0 && cc < GOMO_N && gAt(b, rr, cc) === v) {
        n++;
        rr += dr * s;
        cc += dc * s;
      }
    }
    if (n >= 5) return true;
  }
  return false;
}

export function gomokuFull(b: GomokuBoard): boolean {
  for (let i = 0; i < b.length; i++) if (!b[i]) return false;
  return true;
}

/** 单点评分：以该颜色视角，四个方向连续+开放端计数打分 */
function gomokuPointScore(b: GomokuBoard, r: number, c: number, v: number): number {
  let total = 0;
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  for (const [dr, dc] of dirs) {
    let len = 1;
    let open = 0;
    // 正向
    let rr = r + dr;
    let cc = c + dc;
    while (rr >= 0 && rr < GOMO_N && cc >= 0 && cc < GOMO_N && gAt(b, rr, cc) === v) {
      len++;
      rr += dr;
      cc += dc;
    }
    if (rr >= 0 && rr < GOMO_N && cc >= 0 && cc < GOMO_N && gAt(b, rr, cc) === 0) open++;
    // 反向
    rr = r - dr;
    cc = c - dc;
    while (rr >= 0 && rr < GOMO_N && cc >= 0 && cc < GOMO_N && gAt(b, rr, cc) === v) {
      len++;
      rr -= dr;
      cc -= dc;
    }
    if (rr >= 0 && rr < GOMO_N && cc >= 0 && cc < GOMO_N && gAt(b, rr, cc) === 0) open++;
    if (len >= 5) total += 1_000_000;
    else if (len === 4) total += open === 2 ? 100_000 : open === 1 ? 12_000 : 0;
    else if (len === 3) total += open === 2 ? 6_000 : open === 1 ? 800 : 0;
    else if (len === 2) total += open === 2 ? 300 : open === 1 ? 40 : 0;
    else total += open ? 10 : 0;
  }
  return total;
}

/** AI(白) 选点：先成杀、再破杀、否则攻防合一评分；带小随机避免每局雷同 */
export function gomokuAiMove(b: GomokuBoard): Pt | null {
  let best: Pt[] = [];
  let bestScore = -1;
  const me = 2;
  const you = 1;
  for (let r = 0; r < GOMO_N; r++) {
    for (let c = 0; c < GOMO_N; c++) {
      if (gAt(b, r, c)) continue;
      // 只考虑已有棋子附近两格内的点（开局除外）
      let near = false;
      outer: for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < GOMO_N && cc >= 0 && cc < GOMO_N && gAt(b, rr, cc)) {
            near = true;
            break outer;
          }
        }
      }
      if (!near && gomokuFullCount(b) > 0) continue;
      const attack = gomokuPointScore(b, r, c, me);
      const defend = gomokuPointScore(b, r, c, you);
      // 我方成五 > 挡对方成五 > 我方活四 > 挡对方活四 …
      const score = attack >= 1_000_000 ? attack * 2 : attack + defend * 0.9 + Math.random() * 8;
      if (score > bestScore) {
        bestScore = score;
        best = [{ r, c }];
      } else if (score === bestScore) best.push({ r, c });
    }
  }
  if (!best.length) return null;
  return best[Math.floor(Math.random() * best.length)];
}

function gomokuFullCount(b: GomokuBoard): number {
  let n = 0;
  for (let i = 0; i < b.length; i++) if (b[i]) n++;
  return n;
}

/* ==================== 中国象棋 ==================== */

// 棋子编码：`${side}${kind}`，side=r红/b黑，kind=车马炮将士相卒
export type XPiece = string;
export interface XState {
  /** 10×9，null=空 */
  board: (XPiece | null)[][];
  turn: "r" | "b";
  /** 上一步 {from,to}，用于渲染高亮 */
  last?: { from: Pt; to: Pt };
  noCaptureHalfMoves: number;
}

export function xiangqiCreate(): XState {
  const empty = () => Array<XPiece | null>(9).fill(null);
  const board = Array.from({ length: 10 }, empty);
  const back = ["车", "马", "象", "士", "将", "士", "象", "马", "车"];
  for (let c = 0; c < 9; c++) {
    board[0][c] = "b" + back[c];
    // 红方用"相/帅"，黑方用"象/将"——混用会导致 findKing 找不到红帅而全盘判被将
    board[9][c] = c === 4 ? "r帅" : "r" + back[c].replace("象", "相");
  }
  board[2][1] = "b炮";
  board[2][7] = "b炮";
  board[7][1] = "r炮";
  board[7][7] = "r炮";
  for (const c of [0, 2, 4, 6, 8]) {
    board[3][c] = "b卒";
    board[6][c] = "r兵";
  }
  return { board, turn: "r", noCaptureHalfMoves: 0 };
}

const sideOf = (p: XPiece) => p[0] as "r" | "b";
const kindOf = (p: XPiece) => p[1];
const inB = (r: number, c: number) => r >= 0 && r <= 9 && c >= 0 && c <= 8;
/** 九宫：红 r7-9 / 黑 r0-2，列 3-5 */
const inPalace = (r: number, c: number, s: "r" | "b") => c >= 3 && c <= 5 && (s === "r" ? r >= 7 : r <= 2);

/** 伪合法着法（不含送将过滤） */
export function xiangqiPseudoMoves(st: XState, r: number, c: number): Pt[] {
  const p = st.board[r][c];
  if (!p || sideOf(p) !== st.turn) return [];
  const s = sideOf(p);
  const k = kindOf(p);
  const out: Pt[] = [];
  const push = (rr: number, cc: number) => {
    if (!inB(rr, cc)) return;
    const q = st.board[rr][cc];
    if (q && sideOf(q) === s) return;
    out.push({ r: rr, c: cc });
  };
  const jump = (rr: number, cc: number) => {
    if (!inB(rr, cc)) return;
    const q = st.board[rr][cc];
    if (!q || sideOf(q) !== s) out.push({ r: rr, c: cc });
  };
  if (k === "车") {
    for (const [dr, dc] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      let rr = r + dr;
      let cc = c + dc;
      while (inB(rr, cc) && !st.board[rr][cc]) {
        out.push({ r: rr, c: cc });
        rr += dr;
        cc += dc;
      }
      if (inB(rr, cc)) jump(rr, cc);
    }
  } else if (k === "马") {
    const legs = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    const offs: [number, number][] = [
      [-2, -1],
      [-2, 1],
      [2, -1],
      [2, 1],
      [-1, -2],
      [1, -2],
      [-1, 2],
      [1, 2],
    ];
    for (const [or, oc] of offs) {
      const lr = r + (or === -2 ? -1 : or === 2 ? 1 : 0);
      const lc = c + (oc === -2 ? -1 : oc === 2 ? 1 : 0);
      if (legs.every(([a, b]) => !(lr === r + a && lc === c + b))) continue;
      if (inB(lr, lc) && st.board[lr][lc]) continue; // 蹩马腿
      const rr = r + or;
      const cc = c + oc;
      if (inB(rr, cc)) push(rr, cc);
    }
  } else if (k === "炮") {
    for (const [dr, dc] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      let rr = r + dr;
      let cc = c + dc;
      while (inB(rr, cc) && !st.board[rr][cc]) {
        out.push({ r: rr, c: cc });
        rr += dr;
        cc += dc;
      }
      // 翻山：越过一个子后可打
      if (inB(rr, cc)) {
        rr += dr;
        cc += dc;
        while (inB(rr, cc) && !st.board[rr][cc]) {
          rr += dr;
          cc += dc;
        }
        if (inB(rr, cc)) jump(rr, cc);
      }
    }
  } else if (k === "象" || k === "相") {
    for (const [dr, dc] of [
      [2, 2],
      [2, -2],
      [-2, 2],
      [-2, -2],
    ]) {
      const er = r + dr / 2;
      const ec = c + dc / 2;
      if (!inB(er, ec) || st.board[er][ec]) continue; // 塞象眼
      const rr = r + dr;
      const cc = c + dc;
      if (!inB(rr, cc)) continue;
      if (s === "r" && rr < 5) continue; // 相不过河
      if (s === "b" && rr > 4) continue;
      push(rr, cc);
    }
  } else if (k === "士") {
    for (const [dr, dc] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ]) {
      const rr = r + dr;
      const cc = c + dc;
      if (inB(rr, cc) && inPalace(rr, cc, s)) push(rr, cc);
    }
  } else if (k === "将" || k === "帅") {
    for (const [dr, dc] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const rr = r + dr;
      const cc = c + dc;
      if (inB(rr, cc) && inPalace(rr, cc, s)) push(rr, cc);
    }
    // 飞将：同列无遮挡直接吃对方将
    const foeKing = s === "r" ? "b将" : "r帅";
    for (let rr = r + (s === "r" ? -1 : 1); inB(rr, c); rr += s === "r" ? -1 : 1) {
      const q = st.board[rr][c];
      if (q === foeKing) {
        out.push({ r: rr, c });
        break;
      }
      if (q) break;
    }
  } else if (k === "卒" || k === "兵") {
    const fwd = s === "r" ? -1 : 1;
    const crossed = s === "r" ? r <= 4 : r >= 5;
    push(r + fwd, c);
    if (crossed) {
      push(r, c - 1);
      push(r, c + 1);
    }
  }
  return out;
}

function findKing(st: XState, s: "r" | "b"): Pt | null {
  const k = s === "r" ? "帅" : "将";
  for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) if (st.board[r][c] === s + k) return { r, c };
  return null;
}

/** 当前 turn 方是否被将军 */
export function xiangqiInCheck(st: XState, who: "r" | "b"): boolean {
  const king = findKing(st, who);
  if (!king) return true;
  const foe: "r" | "b" = who === "r" ? "b" : "r";
  const probe: XState = { ...st, turn: foe };
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = st.board[r][c];
      if (p && sideOf(p) === foe) {
        if (xiangqiPseudoMoves(probe, r, c).some((m) => m.r === king.r && m.c === king.c)) return true;
      }
    }
  }
  return false;
}

function applyMoveRaw(st: XState, from: Pt, to: Pt): XState {
  const board = st.board.map((row) => row.slice());
  const piece = board[from.r][from.c]!;
  const captured = board[to.r][to.c];
  board[to.r][to.c] = piece;
  board[from.r][from.c] = null;
  return {
    board,
    turn: st.turn === "r" ? "b" : "r",
    last: { from, to },
    noCaptureHalfMoves: captured || (piece[1] !== "将" && piece[1] !== "帅" && false) ? 0 : st.noCaptureHalfMoves + 1,
  };
}

/** 真合法着法（过滤送将与照面） */
export function xiangqiLegalMoves(st: XState, r: number, c: number): Pt[] {
  const p = st.board[r][c];
  if (!p || sideOf(p) !== st.turn) return [];
  return xiangqiPseudoMoves(st, r, c).filter((m) => {
    const next = applyMoveRaw(st, { r, c }, m);
    return !xiangqiInCheck(next, st.turn);
  });
}

/** 全盘所有合法着（可能很大，AI 用） */
export function xiangqiAllLegal(st: XState): { from: Pt; to: Pt }[] {
  const all: { from: Pt; to: Pt }[] = [];
  for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) {
    if (st.board[r][c] && sideOf(st.board[r][c]!) === st.turn) {
      for (const m of xiangqiLegalMoves(st, r, c)) all.push({ from: { r, c }, to: m });
    }
  }
  return all;
}

export type XStatus = "playing" | "checkmate" | "stalemate" | "draw";
export function xiangqiStatus(st: XState): XStatus {
  if (xiangqiAllLegal(st).length === 0) return xiangqiInCheck(st, st.turn) ? "checkmate" : "stalemate";
  if (st.noCaptureHalfMoves >= 120) return "draw"; // 60 回合自然限着
  return "playing";
}

const VAL: Record<string, number> = { 车: 900, 马: 400, 炮: 450, 兵: 100, 卒: 100, 士: 200, 相: 200, 象: 200, 将: 10000, 帅: 10000 };

function evaluate(st: XState): number {
  // 正数=红优
  let s = 0;
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const p = st.board[r][c];
      if (!p) continue;
      let v = VAL[p[1]] ?? 100;
      // 位置微调：过河兵卒增值、中心马炮增值
      if ((p[1] === "兵" || p[1] === "卒") && (p[0] === "r" ? r <= 4 : r >= 5)) v += 40;
      if (p[1] === "马" || p[1] === "炮") v += (4 - Math.abs(c - 4)) * 4;
      s += p[0] === "r" ? v : -v;
    }
  }
  return s;
}

/** 浅层 alpha-beta（2 层 + 终局延伸），带噪声控制棋力"会玩但会犯错" */
export function xiangqiAiMove(st: XState): { from: Pt; to: Pt } | null {
  const moves = xiangqiAllLegal(st);
  if (!moves.length) return null;
  const aiSide = st.turn; // AI 执黑
  const NOISE = 55; // 决策噪声：越大越爱犯错
  let best: { from: Pt; to: Pt }[] = [];
  let bestScore = aiSide === "b" ? Infinity : -Infinity;
  for (const mv of moves) {
    const after = applyMoveRaw(st, mv.from, mv.to);
    const sc = search(after, 1, aiSide, -Infinity, Infinity) + Math.random() * NOISE - NOISE / 2;
    const better = aiSide === "b" ? sc < bestScore : sc > bestScore;
    if (better) {
      bestScore = sc;
      best = [mv];
    } else if (sc === bestScore) best.push(mv);
  }
  return best.length ? best[Math.floor(Math.random() * best.length)] : moves[0];
}

function search(st: XState, depth: number, root: "r" | "b", alpha: number, beta: number): number {
  const status = xiangqiStatus(st);
  if (status === "checkmate") return st.turn === "r" ? -99999 + (2 - depth) : 99999 - (2 - depth);
  if (status === "stalemate" || status === "draw") return 0;
  if (depth === 0) return evaluate(st);
  const moves = xiangqiAllLegal(st);
  if (!moves.length) return evaluate(st);
  // 只搜吃子着，省时间
  const captures = moves.filter((m) => st.board[m.to.r][m.to.c]);
  const list = captures.length && depth === 1 ? captures : moves;
  if (st.turn === "r") {
    let v = -Infinity;
    for (const m of list) {
      v = Math.max(v, search(applyMoveRaw(st, m.from, m.to), depth - 1, root, alpha, beta));
      alpha = Math.max(alpha, v);
      if (beta <= alpha) break;
    }
    return v;
  }
  let v = Infinity;
  for (const m of list) {
    v = Math.min(v, search(applyMoveRaw(st, m.from, m.to), depth - 1, root, alpha, beta));
    beta = Math.min(beta, v);
    if (beta <= alpha) break;
  }
  return v;
}

/** 公开走子入口：仅当合法才变更状态 */
export function xiangqiApply(st: XState, from: Pt, to: Pt): XState | null {
  if (!xiangqiLegalMoves(st, from.r, from.c).some((m) => m.r === to.r && m.c === to.c)) return null;
  return applyMoveRaw(st, from, to);
}

export function xiangqiClone(st: XState): XState {
  return { ...st, board: st.board.map((row) => row.slice()) };
}

/** 序列化（localStorage 存 JSON 用） */
export function gomokuSerialize(b: GomokuBoard): number[] {
  return Array.from(b);
}
export function gomokuDeserialize(a: number[]): GomokuBoard {
  const b = gomokuCreate();
  for (let i = 0; i < Math.min(a.length, b.length); i++) b[i] = a[i];
  return b;
}
