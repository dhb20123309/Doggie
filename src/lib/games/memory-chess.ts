// 翻翻棋（动物棋暗翻）：4×6 共24格，12对棋子扣着。翻开定色后同子相吃、大小相吃（象>…>鼠，鼠吃象）。
// seat0=先翻玩家。回合制：每步要么翻一张明子，要么用己方明子移动一格/吃子。
import type { GameSpec, GAction, GView } from "./types";
import { shuffle, randInt } from "./types";

const ROWS = 4, COLS = 6;
type S = { cells: ({ kind: string; side: "r" | "b"; up: boolean } | null)[]; turn: number; firstSide: "r" | "b" | null; over: boolean; winner: number; plies: number };
const RANK: Record<string, number> = { 象: 7, 狮: 6, 虎: 5, 豹: 4, 狼: 3, 狗: 2, 猫: 1, 鼠: 0 };
const KINDS = Object.keys(RANK);
const idx = (r: number, c: number) => r * COLS + c;

export function flipCreate(rng: () => number): S {
  const pool: string[] = [];
  for (const k of KINDS) pool.push(k, k);
  shuffle(pool, rng);
  return { cells: pool.map((k) => ({ kind: k, side: rng() < 0.5 ? ("r" as const) : ("b" as const), up: false })), turn: 0, firstSide: null, over: false, winner: 0, plies: 0 };
}
function count(s: S, side: string) { return s.cells.filter((c) => c && c.side === side).length; }
function canEat(a: { kind: string }, d: { kind: string }): boolean {
  if (a.kind === "鼠" && d.kind === "象") return true;
  if (d.kind === "鼠" && a.kind === "象") return false;
  return RANK[a.kind] >= RANK[d.kind];
}
function legalFor(s: S): GAction[] {
  if (s.over) return [];
  const me = s.turn === 0 ? "r" : "b";
  const acts: GAction[] = [];
  s.cells.forEach((c, i) => { if (!c || c.up) return; acts.push({ kind: "flip", n: i }); });
  if (s.firstSide && me !== s.firstSide) return acts.length ? acts : []; // 未定色前只能翻
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const p = s.cells[idx(r, c)];
    if (!p || !p.up || p.side !== me) continue;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
      const q = s.cells[idx(rr, cc)];
      if (!q) acts.push({ kind: "move", from: { r, c }, to: { r: rr, c: cc } });
      else if (q.up && q.side !== me && canEat(p, q)) acts.push({ kind: "move", from: { r, c }, to: { r: rr, c: cc } });
    }
  }
  return acts;
}

const spec: GameSpec<S> = {
  id: "memory-chess",
  name: "翻翻棋",
  category: "board",
  players: "2人",
  ruleSummary: "翻子定色，明子可走可吃，吃光对方获胜",
  simplified: "本版本采用简化规则：4×6 十二对；第一张翻开的颜色归先手方；暗子只能靠翻开来获得；象狮虎豹狼狗猫鼠逐级吃、鼠能吃象。",
  undoable: true,
  maxTurns: 120,
  create: (_seats, rng) => flipCreate(rng),
  turnOf: (s) => s.turn,
  legalActions: legalFor,
  apply: (s, a) => {
    if (s.over) return null;
    const cells = s.cells.map((c) => (c ? { ...c } : null));
    const me = s.turn === 0 ? "r" : "b";
    if (a.kind === "flip" && a.n != null) {
      const p = cells[a.n]; if (!p || p.up) return null;
      p.up = true;
      if (!s.firstSide) { p.side = me; }
      const nextOver = (() => { const t = { ...s, cells, firstSide: s.firstSide ?? me }; return legalFor(t).length === 0; })();
      if (nextOver) return { ...s, cells, firstSide: s.firstSide ?? me, over: true, winner: s.turn, plies: s.plies + 1 };
      return { ...s, cells, firstSide: s.firstSide ?? me, turn: s.turn === 0 ? 1 : 0, plies: s.plies + 1 };
    }
    if (a.kind === "move" && a.from && a.to) {
      if (!s.firstSide || me !== s.firstSide) return null;
      if (!legalFor(s).some((m) => m.kind === "move" && m.from!.r === a.from!.r && m.from!.c === a.from!.c && m.to!.r === a.to!.r && m.to!.c === a.to!.c)) return null;
      const p = cells[idx(a.from.r, a.from.c)]!;
      cells[idx(a.from.r, a.from.c)] = null;
      cells[idx(a.to.r, a.to.c)] = p;
      const foe = me === "r" ? "b" : "r";
      if (count({ ...s, cells }, foe) === 0) return { ...s, cells, over: true, winner: s.turn, plies: s.plies + 1 };
      const t = { ...s, cells, turn: s.turn === 0 ? 1 : 0 };
      if (legalFor(t).length === 0) return { ...t, over: true, winner: s.turn };
      return { ...t, plies: s.plies + 1 };
    }
    return null;
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === 0 ? "draw" : s.winner === seat + 1 ? "win" : "lose"),
  aiMove: (s) => {
    const acts = legalFor(s);
    if (!acts.length) return null;
    const moves = acts.filter((a) => a.kind === "move");
    if (moves.length && Math.random() < 0.8) {
      let best = moves[0], sc = -1e9;
      for (const a of moves) {
        const nx = spec.apply(s, a)!;
        let v = 0;
        nx.cells.forEach((c) => { if (c?.up) v += (c.side === "b" ? 1 : -1) * (RANK[c.kind] + 1); });
        if (nx.over && nx.winner === 1) v += 90000;
        v += Math.random() * 12;
        if (v > sc) { sc = v; best = a; }
      }
      return best;
    }
    // 翻牌：优先翻还没出现过的中大子（记忆近似：看已明的子）
    const seen = new Set(s.cells.filter((c) => c?.up).map((c) => c!.kind));
    const flips = acts.filter((a) => a.kind === "flip");
    const un = flips.filter((f) => !seen.has(s.cells[f.n!]!.kind));
    const pick = (un.length ? un : flips);
    return pick[randInt(Math.random, pick.length)];
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.cells) && o.cells.length === 16 ? o : null; },
  view: (s, _sel, hints) => {
    const hs = new Map(hints.map((h) => (h.kind === "flip" ? [`${Math.floor(h.n! / COLS)},${h.n! % COLS}`, "flip"] : [`${h.to!.r},${h.to!.c}`, "move"])));
    return {
      kind: "grid", rows: ROWS, cols: COLS, lineStyle: "square",
      cells: s.cells.map((c, i) => ({ r: Math.floor(i / COLS), c: i % COLS, token: !c ? "" : c.up ? c.side + c.kind : "back", hint: hs.has(`${Math.floor(i / COLS)},${i % COLS}`) ? true : undefined })),
      notes: [s.firstSide ? `你的颜色：${s.turn === 0 ? "红" : "蓝"} · 场上红${count(s, "r")}蓝${count(s, "b")}` : "先翻一张定颜色"],
    } as GView;
  },
  acceptDraw: (s) => s.plies > 40,
  endLine: (s, name) => (s.winner === 0 ? "翻翻棋超时判和" : s.winner === 1 ? `${name} 的翻翻棋输了` : `${name} 翻赢了这局翻翻棋`),
};

export default spec;
