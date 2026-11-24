// 军棋（明棋简化版）：5×12 双方各30子，行营斜走、大本营驻守。吃子按等级，炸弹同归于尽，扛旗胜。
import type { GameSpec, GAction, GView } from "./types";
import { shuffle } from "./types";

const ROWS = 5, COLS = 12; // c0-5 红方(玩家)半场，c6-11 蓝方(AI)；红从右往左推进
type S = { b: (string | null)[][]; turn: number; over: boolean; winner: number; plies: number };
const RANK: Record<string, number> = { 司令: 9, 军长: 8, 师长: 7, 旅长: 6, 团长: 5, 营长: 4, 连长: 3, 排长: 2, 工兵: 1, 地雷: 0, 炸弹: -1, 军旗: -2 };
const CAMP = new Set(["1,1", "1,3", "3,1", "3,3", "0,2", "4,2", "1,8", "1,10", "3,8", "3,10", "0,9", "4,9"]);
const HQ = new Set(["0,5", "4,5", "0,6", "4,6"]);

export function armyCreate(rng: () => number): S {
  const red = ["司令", "军长", "师长", "师长", "旅长", "旅长", "团长", "团长", "营长", "营长", "连长", "连长", "连长", "排长", "排长", "排长", "工兵", "工兵", "工兵", "工兵", "炸弹", "炸弹", "地雷", "地雷", "地雷", "军旗"];
  const blue = [...red];
  shuffle(red, rng); shuffle(blue, rng);
  const b: (string | null)[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  let i = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c <= 5; c++) { if (CAMP.has(`${r},${c}`)) continue; if (i < red.length) b[r][c] = "r" + red[i++]; }
  i = 0;
  for (let r = 0; r < ROWS; r++) for (let c = COLS - 1; c >= 6; c--) { if (CAMP.has(`${r},${COLS - 1 - c === 5 ? c : c}`) || CAMP.has(`${r},${c}`)) continue; if (i < blue.length) b[r][c] = "b" + blue[i++]; }
  // 军旗必须放本方大本营
  fixFlag(b, "r"); fixFlag(b, "b");
  return { b, turn: 0, over: false, winner: 0, plies: 0 };
}
function fixFlag(b: (string | null)[][], side: string) {
  const hqList = side === "r" ? ["0,5", "4,5"] : ["0,6", "4,6"];
  let flagPos: [number, number] | null = null;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (b[r][c] === side + "军旗") flagPos = [r, c];
  if (!flagPos) return;
  const [fr, fc] = flagPos;
  const target = hqList.map((s) => s.split(",").map(Number)).find(([r, c]) => !b[r][c] || b[r][c]?.[0] !== side) ?? hqList.map((s) => s.split(",").map(Number))[0];
  const [tr, tc] = target;
  const tmp = b[tr][tc]; b[tr][tc] = b[fr][fc]; b[fr][fc] = tmp && tmp !== side + "军旗" ? tmp : null;
}
function fight(a: string, d: string): "win" | "lose" | "both" {
  if (a === "炸弹" || d === "炸弹") return "both";
  if (d === "军旗") return "win";
  if (d === "地雷") return a === "工兵" ? "win" : "lose";
  if (a === "军旗") return "lose";
  return RANK[a] >= RANK[d] ? "win" : "lose";
}
function movesFor(s: S, r: number, c: number): { r: number; c: number }[] {
  const p = s.b[r][c]; if (!p) return [];
  const me = s.turn === 0 ? "r" : "b";
  if (p[0] !== me) return [];
  if (p.slice(1) === "军旗" || p.slice(1) === "地雷") return [];
  const out: { r: number; c: number }[] = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  if (p.slice(1) === "工兵") {
    // 工兵可沿空路拐弯走（BFS 最短路可达空格/可吃格）
    const seen = new Set([`${r},${c}`]);
    const q = [{ r, c }];
    while (q.length) {
      const cur = q.shift()!;
      for (const [dr, dc] of dirs) {
        const rr = cur.r + dr, cc = cur.c + dc;
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || seen.has(`${rr},${cc}`)) continue;
        seen.add(`${rr},${cc}`);
        const t = s.b[rr][cc];
        if (!t) { out.push({ r: rr, c: cc }); q.push({ r: rr, c: cc }); }
        else if (t[0] !== me && fight(p.slice(1), t.slice(1)) !== "lose") out.push({ r: rr, c: cc });
      }
    }
    return out;
  }
  for (const [dr, dc] of dirs) {
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
    const t = s.b[rr][cc];
    if (!t) { if (!(HQ.has(`${rr},${cc}`) && me === "b" && false)) out.push({ r: rr, c: cc }); }
    else if (t[0] !== me && fight(p.slice(1), t.slice(1)) !== "lose") out.push({ r: rr, c: cc });
  }
  if (CAMP.has(`${r},${c}`)) for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
    const t = s.b[rr][cc];
    if (!t || (t[0] !== me && fight(p.slice(1), t.slice(1)) !== "lose")) out.push({ r: rr, c: cc });
  }
  return out.filter((m) => !(HQ.has(`${m.r},${m.c}`) && s.b[m.r][m.c] === null && p.slice(1) !== "军旗" && false));
}
function legalFor(s: S): GAction[] {
  if (s.over) return [];
  const acts: GAction[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) for (const m of movesFor(s, r, c)) acts.push({ kind: "move", from: { r, c }, to: m });
  return acts;
}

const spec: GameSpec<S> = {
  id: "junqi",
  name: "军棋",
  category: "board",
  players: "2人",
  ruleSummary: "司令到排长逐级吃子，炸弹同归于尽，工兵挖雷，扛军旗获胜",
  simplified: "本版本采用简化规则：明棋（双方棋子可见）；5×5×12 半盘布局随机；无铁路直线滑行与大本营潜规则；行营内不可被吃、可斜走一步；超回合判和。",
  undoable: true,
  maxTurns: 150,
  create: (_seats, rng) => armyCreate(rng),
  turnOf: (s) => s.turn,
  legalActions: legalFor,
  apply: (s, a) => {
    if (s.over || a.kind !== "move" || !a.from || !a.to) return null;
    if (!legalFor(s).some((m) => m.from!.r === a.from!.r && m.from!.c === a.from!.c && m.to!.r === a.to!.r && m.to!.c === a.to!.c)) return null;
    const b = s.b.map((row) => row.slice()) as (string | null)[][];
    const atk = b[a.from.r][a.from.c]!, def = b[a.to.r][a.to.c];
    b[a.from.r][a.from.c] = null;
    let over = false, winner = 0;
    if (!def) b[a.to.r][a.to.c] = atk;
    else {
      const res = fight(atk.slice(1), def.slice(1));
      if (def.slice(1) === "军旗") { over = true; winner = s.turn; }
      else if (res === "both") { /* 同归于尽 */ }
      else if (res === "win") b[a.to.r][a.to.c] = atk;
      else b[a.to.r][a.to.c] = def;
    }
    const next = s.turn === 0 ? 1 : 0;
    if (!over && legalFor({ ...s, b, turn: next }).length === 0) { over = true; winner = s.turn; }
    return { b, turn: next, over, winner, plies: s.plies + 1 };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === 0 ? "draw" : s.winner === seat ? "win" : "lose"),
  aiMove: (s) => {
    const acts = legalFor(s);
    if (!acts.length) return null;
    let best = acts[0], sc = -1e9;
    for (const a of acts) {
      const nx = spec.apply(s, a)!;
      let v = 0;
      for (const row of nx.b) for (const p of row) if (p) v += (p[0] === "b" ? 1 : -1) * Math.max(RANK[p.slice(1)] ?? 0, 0);
      if (nx.over && nx.winner === 1) v += 90000;
      v += Math.random() * 25;
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
      cells: s.b.flatMap((row, r) => row.map((v, c) => ({ r, c, token: v ? v[0] + v.slice(1) : "", label: CAMP.has(`${r},${c}`) ? "camp" : HQ.has(`${r},${c}`) ? "hq" : undefined, hint: hs.has(`${r},${c}`) }))),
      notes: ["右侧蓝阵是你的目标 · 圆角格是行营"],
    } as GView;
  },
  acceptDraw: (s) => s.plies > 60,
  endLine: (s, name) => (s.winner === 0 ? "军棋打平，超时判和" : s.winner === 0 ? `${name} 的军棋被你扛了旗` : `${name} 扛了你的军旗`),
};

export default spec;
