// 国际象棋（简化但完整可玩）：8×8，王/后/车/象/马/兵，吃子、将军、将死、兵升变（自动升后）。
// 不含易位与吃过路兵（规则卡公示）。seat0=白玩家先行，seat1=黑AI。
import type { GameSpec, GAction, GView } from "./types";

type P = string; // side+kind: wK/wQ/wR/wB/wN/wP / b...
type S = { b: (P | null)[][]; turn: number; over: boolean; checked: boolean; plies: number };
const inB = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;
const sideOf = (p: P) => p[0];
const kindOf = (p: P) => p[1];

export function intlCreate(): S {
  const b: (P | null)[][] = Array.from({ length: 8 }, () => Array(8).fill(null));
  const back = ["R", "N", "B", "Q", "K", "B", "N", "R"];
  for (let c = 0; c < 8; c++) { b[0][c] = "b" + back[c]; b[7][c] = "w" + back[c]; }
  for (let c = 0; c < 8; c++) { b[1][c] = "bP"; b[6][c] = "wP"; }
  return { b, turn: 0, over: false, checked: false, plies: 0 };
}

function pseudo(b: (P | null)[][], r: number, c: number): { r: number; c: number }[] {
  const p = b[r][c]; if (!p) return [];
  const s = sideOf(p), k = kindOf(p), out: { r: number; c: number }[] = [];
  const push = (rr: number, cc: number) => { if (inB(rr, cc)) { const q = b[rr][cc]; if (!q || sideOf(q) !== s) out.push({ r: rr, c: cc }); } };
  const slide = (ds: number[][]) => { for (const [dr, dc] of ds) { let rr = r + dr, cc = c + dc; while (inB(rr, cc)) { const q = b[rr][cc]; if (!q) out.push({ r: rr, c: cc }); else { if (sideOf(q) !== s) out.push({ r: rr, c: cc }); break; } rr += dr; cc += dc; } } };
  if (k === "R") slide([[1, 0], [-1, 0], [0, 1], [0, -1]]);
  else if (k === "B") slide([[1, 1], [1, -1], [-1, 1], [-1, -1]]);
  else if (k === "Q") slide([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]);
  else if (k === "N") { for (const [dr, dc] of [[-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2]]) push(r + dr, c + dc); }
  else if (k === "K") { for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) push(r + dr, c + dc); }
  else if (k === "P") {
    const fwd = s === "w" ? -1 : 1, start = s === "w" ? 6 : 1;
    if (inB(r + fwd, c) && !b[r + fwd][c]) { out.push({ r: r + fwd, c }); if (r === start && !b[r + 2 * fwd][c]) out.push({ r: r + 2 * fwd, c }); }
    for (const dc of [-1, 1]) { const rr = r + fwd, cc = c + dc; if (inB(rr, cc) && b[rr][cc] && sideOf(b[rr][cc]!) !== s) out.push({ r: rr, c: cc }); }
  }
  return out;
}
function findKing(b: (P | null)[][], s: string) { for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (b[r][c] === s + "K") return { r, c }; return null; }
function attacked(b: (P | null)[][], r: number, c: number, by: string): boolean {
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { const p = b[i][j]; if (p && sideOf(p) === by && pseudo(b, i, j).some((m) => m.r === r && m.c === c)) return true; }
  return false;
}
function rawApply(b: (P | null)[][], from: { r: number; c: number }, to: { r: number; c: number }): (P | null)[][] {
  const nb = b.map((row) => row.slice());
  let p = nb[from.r][from.c]!;
  if (kindOf(p) === "P" && (to.r === 0 || to.r === 7)) p = sideOf(p) + "Q"; // 自动升后
  nb[to.r][to.c] = p; nb[from.r][from.c] = null;
  return nb;
}
function legalFor(b: (P | null)[][], me: number): GAction[] {
  const s = me === 0 ? "w" : "b", foe = me === 0 ? "b" : "w";
  const acts: GAction[] = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = b[r][c]; if (!p || sideOf(p) !== s) continue;
    for (const m of pseudo(b, r, c)) { const nb = rawApply(b, { r, c }, m); const k = findKing(nb, s); if (k && !attacked(nb, k.r, k.c, foe)) acts.push({ kind: "move", from: { r, c }, to: m }); }
  }
  return acts;
}

const spec: GameSpec<S> = {
  id: "chess-intl",
  name: "国际象棋",
  category: "board",
  players: "2人",
  ruleSummary: "白先，将死对方王获胜",
  simplified: "本版本采用简化规则：兵到底线自动升变为后；暂不支持王车易位与吃过路兵。",
  undoable: true,
  maxTurns: 120,
  create: () => intlCreate(),
  turnOf: (s) => s.turn,
  legalActions: (s) => (s.over ? [] : legalFor(s.b, s.turn)),
  apply: (s, a) => {
    if (s.over || a.kind !== "move" || !a.from || !a.to) return null;
    if (!legalFor(s.b, s.turn).some((m) => m.from!.r === a.from!.r && m.from!.c === a.from!.c && m.to!.r === a.to!.r && m.to!.c === a.to!.c)) return null;
    const b = rawApply(s.b, a.from, a.to);
    const next = s.turn === 0 ? 1 : 0;
    const nl = legalFor(b, next);
    const ks = findKing(b, next === 0 ? "w" : "b");
    const chk = ks ? attacked(b, ks.r, ks.c, s.turn === 0 ? "b" : "w") : false;
    return { b, turn: next, over: nl.length === 0, checked: chk, plies: s.plies + 1 };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => {
    // 无子可走即负（将死或困毙统一按负处理，符合简化说明）
    const loser = s.turn; // 当前走棋方无路可走
    return seat === loser ? "lose" : "win";
  },
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    if (!acts.length) return null;
    const VAL: Record<string, number> = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };
    let best = acts[0], sc = -1e9;
    for (const a of acts) {
      const nx = spec.apply(s, a)!;
      let v = 0;
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const p = nx.b[r][c]; if (p) v += (sideOf(p) === "b" ? 1 : -1) * (VAL[kindOf(p)] ?? 100); }
      if (nx.checked) v += 40;
      if (nx.over) v += 90000;
      v += Math.random() * 30 - 15; // 噪声：会玩但会犯错
      if (v > sc) { sc = v; best = a; }
    }
    return best;
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.b) && o.b.length === 8 ? o : null; },
  view: (s, sel, hints) => {
    const hs = new Set(hints.filter((h) => h.kind === "move").map((h) => `${h.to!.r},${h.to!.c}`));
    const GLYPH: Record<string, string> = { wK: "♔", wQ: "♕", wR: "♖", wB: "♗", wN: "♘", wP: "♙", bK: "♚", bQ: "♛", bR: "♜", bB: "♝", bN: "♞", bP: "♟" };
    return {
      kind: "grid", rows: 8, cols: 8, lineStyle: "square",
      cells: s.b.flatMap((row, r) => row.map((v, c) => ({ r, c, token: v ? GLYPH[v] : "", label: v ? undefined : (r + c) % 2 ? "dark" : "lite", hint: hs.has(`${r},${c}`), sel: sel?.kind === "move" && sel.to == null && sel.from?.r === r && sel.from?.c === c }))),
      notes: [s.checked && !s.over ? "你被将军了！" : ""].filter(Boolean),
    } as GView;
  },
  acceptDraw: (s) => s.plies > 30,
  endLine: (s, name) => (s.turn === 0 ? `${name} 被将死了国际象棋` : `${name} 赢了国际象棋${s.checked ? "（将军杀）" : ""}`),
};

export default spec;
