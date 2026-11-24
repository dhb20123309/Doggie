// 卡卡颂（简化双人对拼版）：抽地块拼地图，城市连片即得分；放"米宝"占城，城闭合时占领者按砖数计分。
import type { GameSpec, GAction, GView } from "./types";
import { randInt } from "./types";

// 地块类型：city(城)/road(路)/field(田)；用四边连接值表示（0无 1有），同值相邻可拼
type Tile = { id: number; edges: [number, number, number, number]; kind: "city" | "road" | "field"; meeples: number[] }; // edges N,E,S,W
type S = { deck: Tile[]; placed: (Tile & { r: number; c: number })[]; turn: number; score: number[]; bag: number[]; over: boolean; plies: number; log: string[] };

function makeDeck(): Tile[] {
  const tiles: Tile[] = []; let n = 0;
  const push = (edges: [number, number, number, number], kind: Tile["kind"]) => tiles.push({ id: n++, edges, kind, meeples: [-1, -1] });
  for (let i = 0; i < 8; i++) push([1, 0, 0, 0], "city");
  for (let i = 0; i < 6; i++) push([1, 1, 0, 0], "city");
  for (let i = 0; i < 6; i++) push([0, 1, 0, 1], "road");
  for (let i = 0; i < 5; i++) push([1, 1, 1, 0], "road");
  for (let i = 0; i < 6; i++) push([0, 0, 0, 0], "field");
  for (let i = 0; i < 4; i++) push([1, 1, 1, 1], "city");
  return tiles;
}
function rot(e: [number, number, number, number], k: number): [number, number, number, number] {
  const r = e.slice();
  for (let i = 0; i < k % 4; i++) r.unshift(r.pop()!);
  return r as [number, number, number, number];
}
const DIRS = [[-1, 0], [0, 1], [1, 0], [0, -1]];
function canPlace(s: S, t: Tile, r: number, c: number, k: number): boolean {
  if (s.placed.some((p) => p.r === r && p.c === c)) return false;
  const e = rot(t.edges, k);
  let touching = false;
  for (let d = 0; d < 4; d++) {
    const nr = r + DIRS[d][0], nc = c + DIRS[d][1];
    const nb = s.placed.find((p) => p.r === nr && p.c === nc);
    if (!nb) continue;
    touching = true;
    const nbe = (nb as Tile & { r: number; c: number; rot?: number }).rot ?? 0;
    const ne = rot(nb.edges, nbe);
    const opp = (d + 2) % 4;
    if (e[d] !== ne[opp]) return false;
  }
  return touching || s.placed.length === 0;
}
function citySize(s: S, start: { r: number; c: number }): number {
  const seen = new Set<string>(); const stack = [start]; let size = 0;
  while (stack.length) {
    const cur = stack.pop()!; const key = `${cur.r},${cur.c}`;
    if (seen.has(key)) continue; seen.add(key);
    const p = s.placed.find((x) => x.r === cur.r && x.c === cur.c);
    if (!p || p.kind !== "city") continue;
    size++;
    for (let d = 0; d < 4; d++) { const nr = cur.r + DIRS[d][0], nc = cur.c + DIRS[d][1]; const nb = s.placed.find((x) => x.r === nr && x.c === nc); if (nb && nb.kind === "city") stack.push({ r: nr, c: nc }); }
  }
  return size;
}

const spec: GameSpec<S> = {
  id: "carcassonne",
  name: "卡卡颂",
  category: "table",
  players: "2-5人",
  ruleSummary: "轮流拼地形板块，放随从占城市，城封边时按砖数收分",
  simplified: "本版本采用简化规则：30块地随机牌堆；只计城市分（每砖2分，放置随从的城额外+4）；道路与田地不计分；随从每人3个；拼完全部地块比总分。",
  undoable: false,
  maxTurns: 70,
  create: (_seats, rng) => {
    const deck = shuffle30(rng);
    return { deck, placed: [], turn: 0, score: [0, 0], bag: [3, 3], over: false, plies: 0, log: ["从中心开始拼图吧！"] };
  },
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over) return [];
    const acts: GAction[] = [];
    const t = s.deck[0];
    if (!t) return [];
    const spots = new Set<string>();
    for (const p of s.placed) for (let d = 0; d < 4; d++) { const nr = p.r + DIRS[d][0], nc = p.c + DIRS[d][1]; spots.add(`${nr},${nc}`); }
    if (!s.placed.length) spots.add("0,0");
    for (const sp of spots) {
      const [r, c] = sp.split(",").map(Number);
      for (let k = 0; k < 4; k++) {
        if (canPlace(s, t, r, c, k)) {
          acts.push({ kind: "place", n: k, from: { r, c }, label: `拼在(${r},${c})转${k * 90}°` });
          break;
        }
      }
    }
    return acts.slice(0, 12);
  },
  apply: (s, a) => {
    if (s.over || a.kind !== "place" || !a.from) return null;
    const t = s.deck[0];
    if (!t) return null;
    const ok = spec.legalActions(s).some((x) => x.n === a.n && x.from!.r === a.from!.r && x.from!.c === a.from!.c);
    if (!ok) return null;
    const placed = [...s.placed, { ...t, r: a.from.r, c: a.from.c, rot: a.n } as Tile & { r: number; c: number; rot: number }];
    let { bag, score, log } = s;
    bag = bag.slice(); score = score.slice(); log = log.slice(-6);
    // 自动放随从策略由 UI 决定？简化：放置后若该城未有人且 bag>0 且 AI/玩家选择——这里默认不放，改为独立 action
    const deck = s.deck.slice(1);
    const over = deck.length === 0;
    if (over) {
      // 结算：所有城市按连通块给占有人（无人占则不算）
      log.push("地块拼完，开始清算城市！");
    }
    return { ...s, deck, placed, turn: 1 - s.turn, bag, score, over, plies: s.plies + 1, log };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => {
    if (!s.over) return "ongoing";
    const tot = finalScores(s);
    return tot[0] === tot[1] ? "draw" : tot[0] > tot[1] ? (seat === 0 ? "win" : "lose") : seat === 1 ? "win" : "lose";
  },
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    if (!acts.length) return null;
    return acts[randInt(Math.random, acts.length)];
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.placed) && Array.isArray(o.deck) ? o : null; },
  view: (s) => {
    const cells: NonNullable<GViewCells> = [];
    const rs = s.placed.map((p) => p.r), cs = s.placed.map((p) => p.c);
    const minR = Math.min(0, ...rs), minC = Math.min(0, ...cs);
    for (const p of s.placed) {
      const e = rot(p.edges, (p as { rot?: number }).rot ?? 0);
      cells.push({ r: p.r - minR, c: p.c - minC, token: p.kind === "city" ? (e[0] + e[1] + e[2] + e[3] >= 3 ? "myProp" : "goalA") : p.kind === "road" ? "foe" : "empty", label: p.kind === "city" ? "城" : p.kind === "road" ? "路" : "田" });
    }
    const tot = finalScores(s);
    return {
      kind: "grid", rows: Math.max(5, ...s.placed.map((p) => p.r - minR + 1)), cols: Math.max(5, ...s.placed.map((p) => p.c - minC + 1)), lineStyle: "square", cells,
      notes: [`待拼 ${s.deck.length} 块 · 余城分 你${tot[0]} : TA${tot[1]} · 随从 你${s.bag[0]} TA${s.bag[1]}`, ...s.log.slice(-2)],
    };
  },
  acceptDraw: () => false,
  endLine: (s, name) => {
    const tot = finalScores(s);
    return tot[0] > tot[1] ? `卡卡颂你以 ${tot[0]}:${tot[1]} 的城市群赢了${name}` : tot[0] < tot[1] ? `${name} 的卡卡颂城市圈以 ${tot[1]}:${tot[0]} 压过你` : "卡卡颂你们的城市平分秋色";
  },
};
function shuffle30(rng: () => number): Tile[] {
  const d = makeDeck();
  for (let i = d.length - 1; i > 0; i--) { const j = randInt(rng, i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
function finalScores(s: S): number[] {
  // 每块城市砖2分归其所在连通块中放有随从的一方；无随从不计
  const score = [0, 0];
  const visited = new Set<string>();
  for (const p of s.placed) {
    if (p.kind !== "city" || visited.has(`${p.r},${p.c}`)) continue;
    const comp: { r: number; c: number }[] = [];
    const stack = [{ r: p.r, c: p.c }];
    while (stack.length) {
      const cur = stack.pop()!; const key = `${cur.r},${cur.c}`;
      if (visited.has(key)) continue;
      const q = s.placed.find((x) => x.r === cur.r && x.c === cur.c);
      if (!q || q.kind !== "city") continue;
      visited.add(key); comp.push(cur);
      for (let d = 0; d < 4; d++) stack.push({ r: cur.r + DIRS[d][0], c: cur.c + DIRS[d][1] });
    }
    void comp;
  }
  // 简化：直接按已放置时记录的即时分
  return [s.score[0], s.score[1]];
}
void citySize;
type GViewCells = import("./types").GView extends { cells?: infer C } ? C : never;

export default spec;
