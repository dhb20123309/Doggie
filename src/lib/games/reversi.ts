// 黑白棋（Reversi/奥赛罗）：8×8，夹击翻转，占格多者胜。seat0=黑玩家先行，seat1=白AI。
import type { GameSpec, GAction, GView } from "./types";

const N = 8;
type S = { b: (0 | 1 | 2)[][]; turn: number; over: boolean; plies: number; lastSkip: boolean };
const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const inB = (r: number, c: number) => r >= 0 && r < N && c >= 0 && c < N;

function flips(b: (0 | 1 | 2)[][], r: number, c: number, me: number): { r: number; c: number }[] {
  if (b[r][c]) return [];
  const foe = me === 1 ? 2 : 1;
  const out: { r: number; c: number }[] = [];
  for (const [dr, dc] of DIRS) {
    const chain: { r: number; c: number }[] = [];
    let rr = r + dr, cc = c + dc;
    while (inB(rr, cc) && b[rr][cc] === foe) { chain.push({ r: rr, c: cc }); rr += dr; cc += dc; }
    if (chain.length && inB(rr, cc) && b[rr][cc] === me) out.push(...chain);
  }
  return out;
}
function legalFor(b: (0 | 1 | 2)[][], me: number): GAction[] {
  const acts: GAction[] = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (flips(b, r, c, me).length) acts.push({ kind: "put", from: { r, c } });
  return acts;
}
function count(b: (0 | 1 | 2)[][]) { let x = 0, o = 0; for (const row of b) for (const v of row) { if (v === 1) x++; else if (v === 2) o++; } return { x, o }; }

const spec: GameSpec<S> = {
  id: "reversi",
  name: "黑白棋",
  category: "board",
  players: "2人",
  ruleSummary: "落子夹住对方棋子即翻色，终局占格多者胜",
  undoable: true,
  maxTurns: 60,
  create: () => {
    const b = Array.from({ length: N }, () => Array(N).fill(0) as (0 | 1 | 2)[]);
    b[3][3] = 2; b[3][4] = 1; b[4][3] = 1; b[4][4] = 2;
    return { b, turn: 0, over: false, plies: 0, lastSkip: false };
  },
  turnOf: (s) => s.turn,
  legalActions: (s) => (s.over ? [] : legalFor(s.b, s.turn === 0 ? 1 : 2)),
  apply: (s, a) => {
    if (s.over || a.kind !== "put" || !a.from) return null;
    const me = s.turn === 0 ? 1 : 2;
    const f = flips(s.b, a.from.r, a.from.c, me);
    if (!f.length) return null;
    const b = s.b.map((row) => row.slice()) as (0 | 1 | 2)[][];
    b[a.from.r][a.from.c] = me;
    for (const p of f) b[p.r][p.c] = me;
    const next = s.turn === 0 ? 1 : 0;
    const nl = legalFor(b, next === 0 ? 1 : 2);
    const nn = next === 0 ? 1 : 2;
    if (!nl.length) {
      if (!legalFor(b, me).length) return { b, turn: next, over: true, plies: s.plies + 1, lastSkip: true };
      return { b, turn: next, over: false, plies: s.plies + 1, lastSkip: true }; // 下一家跳过（turn 不变效果由 UI 提示）
    }
    void nn;
    return { b, turn: next, over: false, plies: s.plies + 1, lastSkip: false };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => { const { x, o } = count(s.b); const mine = seat === 0 ? x : o, his = seat === 0 ? o : x; return mine > his ? "win" : mine < his ? "lose" : "draw"; },
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    if (!acts.length) return null;
    const CORNERS = new Set(["0,0", "0,7", "7,0", "7,7"]);
    const BAD = new Set(["0,1", "1,0", "1,1", "0,6", "1,7", "1,6", "6,0", "7,1", "6,1", "6,6", "7,6", "6,7"]);
    let best = acts[0], sc = -1e9;
    for (const a of acts) {
      const nx = spec.apply(s, a)!;
      const key = `${a.from!.r},${a.from!.c}`;
      const { x, o } = count(nx.b);
      let v = o - x; // AI 执白
      if (CORNERS.has(key)) v += 60;
      if (BAD.has(key)) v -= 25;
      v -= Math.min(a.from!.r, 7 - a.from!.r) * 0 + (nx.lastSkip ? 15 : 0);
      v += Math.random() * 4;
      if (v > sc) { sc = v; best = a; }
    }
    return best;
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.b) && o.b.length === N ? o : null; },
  view: (s, _sel, hints) => {
    const hs = new Set(hints.filter((h) => h.kind === "put").map((h) => `${h.from!.r},${h.from!.c}`));
    return {
      kind: "grid", rows: N, cols: N, lineStyle: "square",
      cells: s.b.flatMap((row, r) => row.map((v, c) => ({ r, c, token: v === 1 ? "blk" : v === 2 ? "wht" : "", hint: hs.has(`${r},${c}`) }))),
      notes: (() => { const { x, o } = count(s.b); return [`黑 ${x} · 白 ${o}${s.lastSkip ? " · 一方无子可下已跳过" : ""}`]; })(),
    } as GView;
  },
  acceptDraw: () => false,
  endLine: (s, name) => { const { x, o } = count(s.b); return x === o ? `黑白棋平局（${x}比${o}），${name} 说再战` : x > o ? `${name} 的黑白棋输了（${o}比${x}）` : `${name} 的黑白棋赢了（${x}比${o}）`; },
};

export default spec;
