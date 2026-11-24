// 斗兽棋：7×9 格，象>狮>虎>狗>猫>鼠、鼠可吃象、入河溺亡(鼠免)、陷阱克子、攻入对方兽巢胜。
// seat0=红方玩家（r6-8 为红半场），seat1=蓝方AI（r0-2）。
import type { GameSpec, GAction, GView } from "./types";

const ROWS = 7, COLS = 9;
type S = { b: (string | null)[][]; turn: number; over: boolean; winner: number; plies: number };
const RANK: Record<string, number> = { 象: 7, 狮: 6, 虎: 5, 豹: 4, 狼: 3, 狗: 2, 猫: 1, 鼠: 0 };
const inB = (r: number, c: number) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
const river = (r: number, c: number) => r >= 2 && r <= 4 && (c === 2 || c === 3 || c === 5 || c === 6);
const trap = (r: number, c: number) => (r === 0 && (c === 3 || c === 4 || c === 5)) || (r === 6 && (c === 3 || c === 4 || c === 5));
const den = (r: number, c: number, side: string) => (side === "r" ? r === 0 : r === 6) && c === 4;
const sideOf = (p: string) => p[0];

export function beastCreate(): S {
  const b: (string | null)[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  const back = ["鼠", "狮", "虎", "豹", "狼", "狗", "猫"];
  for (let i = 0; i < 7; i++) { const c = i === 0 ? 0 : i === 6 ? 8 : i + 1; b[0][c] = "b" + back[i]; b[6][c] = "r" + back[i]; }
  b[1][2] = "b象"; b[5][2] = "r象";
  b[1][6] = "b象"; b[5][6] = "r象";
  return { b, turn: 0, over: false, winner: 0, plies: 0 };
}

function canCapture(st: S, atk: string, def: string, ar: number, ac: number, dr: number, dc: number): boolean {
  const ka = atk[1], kd = def[1];
  // 陷阱：防守方在自己陷阱内则任方可吃
  if (trap(dr, dc) && sideOf(def) === (st.turn === 0 ? "b" : "r")) return true;
  if (trap(ar, ac)) return false; // 自己在对方陷阱里不能吃人
  if (ka === "鼠" && kd === "象") return true;
  if (kd === "鼠" && ka === "象") return false;
  if (river(dr, dc) && ka !== "鼠") return false; // 陆子不能下水吃
  return RANK[kd] <= RANK[ka];
}
function movesFor(st: S, r: number, c: number): { r: number; c: number }[] {
  const p = st.b[r][c]; if (!p) return [];
  const s = sideOf(p), me = st.turn === 0 ? "r" : "b";
  if (s !== me) return [];
  const out: { r: number; c: number }[] = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  // 狮虎跳河
  if ((p[1] === "狮" || p[1] === "虎") && river(r, c) === false) {
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      if (inB(rr, cc) && river(rr, cc)) {
        while (inB(rr, cc) && river(rr, cc)) { if (st.b[rr][cc]) break; rr += dr; cc += dc; }
        if (inB(rr, cc)) { const q = st.b[rr][cc]; if (!q || (sideOf(q) !== s && canCapture(st, p, q, r, c, rr, cc))) out.push({ r: rr, c: cc }); }
      }
    }
  }
  for (const [dr, dc] of dirs) {
    const rr = r + dr, cc = c + dc;
    if (!inB(rr, cc)) continue;
    if (den(rr, cc, s)) continue; // 不能进自己兽巢
    const q = st.b[rr][cc];
    if (!q) { if (!river(rr, cc) || p[1] === "鼠") out.push({ r: rr, c: cc }); }
    else if (sideOf(q) !== s && canCapture(st, p, q, r, c, rr, cc)) out.push({ r: rr, c: cc });
  }
  return out;
}
function legalFor(st: S): GAction[] {
  const me = st.turn === 0 ? "r" : "b";
  const acts: GAction[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (st.b[r][c]?.[0] !== me) continue;
    for (const m of movesFor(st, r, c)) acts.push({ kind: "move", from: { r, c }, to: m });
  }
  return acts;
}

const spec: GameSpec<S> = {
  id: "dou-shou-qi",
  name: "斗兽棋",
  category: "board",
  players: "2人",
  ruleSummary: "象狮虎豹狼狗猫鼠逐级吃子，鼠能吃象；攻入对方兽巢获胜",
  simplified: "本版本采用简化规则：7×9 标准盘；狮虎可纵向跳河（途中无鼠挡）；入河非鼠棋子按溺亡处理（不可进入）；无重复局面判负条款，超回合判和。",
  undoable: true,
  maxTurns: 120,
  create: () => beastCreate(),
  turnOf: (s) => s.turn,
  legalActions: (s) => (s.over ? [] : legalFor(s)),
  apply: (st, a) => {
    if (st.over || a.kind !== "move" || !a.from || !a.to) return null;
    if (!legalFor(st).some((m) => m.from!.r === a.from!.r && m.from!.c === a.from!.c && m.to!.r === a.to!.r && m.to!.c === a.to!.c)) return null;
    const b = st.b.map((row) => row.slice()) as (string | null)[][];
    const p = b[a.from.r][a.from.c]!;
    b[a.from.r][a.from.c] = null; b[a.to.r][a.to.c] = p;
    const next = st.turn === 0 ? 1 : 0;
    let over = false, winner = 0;
    if (den(a.to.r, a.to.c, sideOf(p))) { over = true; winner = st.turn; }
    else if (legalFor({ ...st, b, turn: next }).length === 0) { over = true; winner = st.turn; }
    return { b, turn: next, over, winner, plies: st.plies + 1 };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === 0 ? "draw" : s.winner === seat ? "win" : "lose"),
  aiMove: (st) => {
    const acts = legalFor(st);
    if (!acts.length) return null;
    let best = acts[0], sc = -1e9;
    for (const a of acts) {
      const nx = spec.apply(st, a)!;
      let v = 0;
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) { const p = nx.b[r][c]; if (p) v += (p[0] === "b" ? 1 : -1) * (RANK[p[1]] + 1) * 10; }
      if (nx.over && nx.winner === 1) v += 90000;
      v += Math.random() * 20;
      if (v > sc) { sc = v; best = a; }
    }
    return best;
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.b) && o.b.length === ROWS ? o : null; },
  view: (s, _sel, hints) => {
    const hs = new Set(hints.map((h) => `${h.to!.r},${h.to!.c}`));
    return {
      kind: "grid", rows: ROWS, cols: COLS, lineStyle: "square",
      cells: s.b.flatMap((row, r) => row.map((v, c) => ({ r, c, token: v ? v[0] + v[1] : "", label: river(r, c) ? "water" : den(r, c, "r") ? "denr" : den(r, c, "b") ? "denb" : trap(r, c) ? "trap" : undefined, hint: hs.has(`${r},${c}`) }))),
      notes: ["上方蓝巢是你的目标 · 水中只有鼠能过"],
    } as GView;
  },
  acceptDraw: (s) => s.plies > 50,
  endLine: (s, name) => (s.winner === 0 ? "斗兽棋超时判和" : s.winner === 0 ? `${name} 的斗兽棋输了` : `${name} 用斗兽棋攻进了你的兽巢`),
};

export default spec;
