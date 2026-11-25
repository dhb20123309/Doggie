// 西洋跳棋（8×8 简化版）：斜走吃子、能吃必吃、到底升王。seat0=黑先行玩家，seat1=白AI。
import type { GameSpec, GAction, GView } from "./types";

type S = { b: Cell[][]; turn: number; over: boolean; winner: number; plies: number };
// 0空 1黑兵 2黑王 3白兵 4白王（布局约定：棋子只放在 (r+c)%2===1 的格，斜走每步换奇偶）
type Cell = 0 | 1 | 2 | 3 | 4;
const inB = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;
const isBlack = (v: number) => v === 1 || v === 2;
const mine = (v: number, me: number) => (me === 0 ? isBlack(v) : v === 3 || v === 4);
const kingOf = (v: number) => v === 2 || v === 4;
const dirsFor = (v: number, me: number): [number, number][] =>
  kingOf(v) ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : me === 0 ? [[1, -1], [1, 1]] : [[-1, -1], [-1, 1]];

// 关键数学约束：棋子只斜走，每走一步 (r+c) 奇偶必然翻转。
// 因此开局子统一放在 (r+c)%2===1 的格上，落点自然换到偶数空格；
// 若满行布兵或落点做奇偶校验，都会造成开局无着法（曾踩坑）。
function jumps(b: Cell[][], r: number, c: number): { to: { r: number; c: number }; cap: { r: number; c: number } }[] {
  const v = b[r][c]; if (!v) return [];
  const me = isBlack(v) ? 0 : 1;
  const out: { to: { r: number; c: number }; cap: { r: number; c: number } }[] = [];
  for (const [dr, dc] of dirsFor(v, me)) {
    const mr = r + dr, mc = c + dc, tr = r + 2 * dr, tc = c + 2 * dc;
    if (inB(tr, tc) && b[mr][mc] && !mine(b[mr][mc], me) && !b[tr][tc]) out.push({ to: { r: tr, c: tc }, cap: { r: mr, c: mc } });
  }
  return out;
}
function steps(b: Cell[][], r: number, c: number): { r: number; c: number }[] {
  const v = b[r][c]; if (!v) return [];
  const me = isBlack(v) ? 0 : 1;
  const out: { r: number; c: number }[] = [];
  for (const [dr, dc] of dirsFor(v, me)) {
    const rr = r + dr, cc = c + dc;
    if (inB(rr, cc) && !b[rr][cc]) out.push({ r: rr, c: cc });
  }
  return out;
}
function legalFor(b: Cell[][], me: number): GAction[] {
  const acts: GAction[] = [];
  let anyJump = false;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const v = b[r][c]; if (!v || !mine(v, me)) continue;
    const js = jumps(b, r, c);
    if (js.length) { anyJump = true; for (const j of js) acts.push({ kind: "jump", from: { r, c }, to: j.to, n: j.cap.r * 8 + j.cap.c }); }
  }
  if (anyJump) return acts; // 必须吃子
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const v = b[r][c]; if (!v || !mine(v, me)) continue;
    for (const m of steps(b, r, c)) acts.push({ kind: "move", from: { r, c }, to: m });
  }
  return acts;
}
function layout(): Cell[][] {
  const b: Cell[][] = Array.from({ length: 8 }, () => Array(8).fill(0));
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 0) { if (r < 3) b[r][c] = 3; else if (r > 4) b[r][c] = 1; }
  return b;
}

const spec: GameSpec<S> = {
  id: "checkers",
  name: "西洋跳棋",
  category: "board",
  players: "2人",
  ruleSummary: "斜走跳吃，能吃必吃，无子可动者输",
  simplified: "本版本采用简化规则：8×8 全盘斜走；黑兵向下、白兵向上，到底线自动升王（王可四向斜走）；有吃必吃但不强制连跳到底（每次只跳一格吃一子）。",
  undoable: true,
  maxTurns: 100,
  create: () => {
    // 黑先行向下走：黑占 r5-7，白占 r0-2；(r+c)%2===1 为着落格（斜走每步换奇偶）
    const b: Cell[][] = Array.from({ length: 8 }, () => Array(8).fill(0));
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) { if (r > 4) b[r][c] = 3; else if (r < 3) b[r][c] = 1; }
    return { b, turn: 0, over: false, winner: 0, plies: 0 };
  },
  turnOf: (s) => s.turn,
  legalActions: (s) => (s.over ? [] : legalFor(s.b, s.turn)),
  apply: (s, a) => {
    if (s.over || (a.kind !== "move" && a.kind !== "jump") || !a.from || !a.to) return null;
    if (!legalFor(s.b, s.turn).some((m) => m.from!.r === a.from!.r && m.from!.c === a.from!.c && m.to!.r === a.to!.r && m.to!.c === a.to!.c)) return null;
    const b = s.b.map((row) => row.slice()) as Cell[][];
    let v = b[a.from.r][a.from.c]!;
    b[a.from.r][a.from.c] = 0;
    if (a.kind === "jump" && a.n != null) { const cr = Math.floor(a.n / 8), cc = a.n % 8; b[cr][cc] = 0; }
    if (v === 1 && a.to.r === 7) v = 2;
    if (v === 3 && a.to.r === 0) v = 4;
    b[a.to.r][a.to.c] = v;
    const next = s.turn === 0 ? 1 : 0;
    const over = legalFor(b, next).length === 0;
    return { b, turn: next, over, winner: over ? s.turn : 0, plies: s.plies + 1 };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === 0 ? "draw" : s.winner === seat ? "win" : "lose"),
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    if (!acts.length) return null;
    let best = acts[0], sc = -1e9;
    for (const a of acts) {
      const nx = spec.apply(s, a)!;
      let v = 0;
      for (const row of nx.b) for (const x of row) if (x === 3) v += 100; else if (x === 4) v += 250; else if (x === 1) v -= 100; else if (x === 2) v -= 250;
      if (nx.over && nx.winner === 1) v += 90000;
      v += Math.random() * 25;
      if (v > sc) { sc = v; best = a; }
    }
    return best;
  },
  serialize: (s) => ({ ...s, b: s.b.map((row) => row.slice()) }),
  deserialize: (d) => {
    const o = d as S;
    if (!o || !Array.isArray(o.b) || o.b.length !== 8) return null;
    // 兼容旧存档：满行兵或棋子落在偶数格的布局在斜走规则下是开局死局，检测到即重排为标准布局
    const pieces = o.b.flatMap((row) => row.filter((x) => x !== 0)).length;
    const fullRows = [0, 1, 2, 5, 6, 7].every((r) => o.b[r].every((x) => x !== 0));
    const evenStart = o.b.some((row, r) => row.some((x, c) => x !== 0 && (r + c) % 2 === 0));
    if (pieces === 24 && (fullRows || evenStart)) {
      const b: Cell[][] = Array.from({ length: 8 }, () => Array(8).fill(0));
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) { if (r > 4) b[r][c] = 3; else if (r < 3) b[r][c] = 1; }
      return { ...o, b };
    }
    return o;
  },
  view: (s, _sel, hints) => {
    const hs = new Set(hints.filter((h) => h.to).map((h) => `${h.to!.r},${h.to!.c}`));
    return {
      kind: "grid", rows: 8, cols: 8, lineStyle: "square",
      cells: s.b.flatMap((row, r) => row.map((v, c) => ({ r, c, token: v === 1 ? "blk" : v === 2 ? "blkk" : v === 3 ? "wht" : v === 4 ? "whtk" : "", label: (r + c) % 2 === 1 ? "dark" : "lite", hint: hs.has(`${r},${c}`) }))),
      notes: ["斜走跳吃 · 王带金环"],
    } as GView;
  },
  acceptDraw: (s) => s.plies > 40,
  endLine: (s, name) => (s.winner === 0 ? "西洋跳棋平局" : s.winner === 1 ? `${name} 输了西洋跳棋` : `${name} 赢了西洋跳棋`),
};

export default spec;
