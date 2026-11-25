// 卡卡颂（简化多人对拼版）：抽地块拼地图，城市连片即得分；放"米宝"占城，城闭合时占领者按砖数计分。支持 2-5 人。
import type { GameSpec, GAction, GView } from "./types";
import { randInt } from "./types";

// 地块类型：city(城)/road(路)/field(田)；用四边连接值表示（0无 1有），同值相邻可拼
type Tile = { id: number; edges: [number, number, number, number]; kind: "city" | "road" | "field"; meeples: number[] }; // edges N,E,S,W
type S = { deck: Tile[]; placed: (Tile & { r: number; c: number })[]; turn: number; score: number[]; bag: number[]; over: boolean; plies: number; log: string[]; seats: number };
const seatName = (seat: number) => (seat === 0 ? "你" : seat === 1 ? "TA" : `小机 ${seat - 1}`);

function makeDeck(): Tile[] {
  const tiles: Tile[] = []; let n = 0;
  const push = (edges: [number, number, number, number], kind: Tile["kind"]) => tiles.push({ id: n++, edges, kind, meeples: [] });
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
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) r.unshift(r.pop()!);
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
// 连通城市块：返回该砖所在城的所有坐标与占有人集合
function cityComp(s: S, start: { r: number; c: number }): { cells: { r: number; c: number }[]; owners: number[] } {
  const seen = new Set<string>(); const stack = [start]; const cells: { r: number; c: number }[] = []; const owners: number[] = [];
  while (stack.length) {
    const cur = stack.pop()!; const key = `${cur.r},${cur.c}`;
    if (seen.has(key)) continue; seen.add(key);
    const p = s.placed.find((x) => x.r === cur.r && x.c === cur.c);
    if (!p || p.kind !== "city") continue;
    cells.push(cur);
    const own = (p as unknown as { meepleOwner?: number }).meepleOwner;
    if (own != null && !owners.includes(own)) owners.push(own);
    for (let d = 0; d < 4; d++) stack.push({ r: cur.r + DIRS[d][0], c: cur.c + DIRS[d][1] });
  }
  return { cells, owners };
}

const spec: GameSpec<S> = {
  id: "carcassonne",
  name: "卡卡颂",
  category: "table",
  players: "2-5人",
  ruleSummary: "轮流拼地形板块，放随从占城市，城封边时按砖数收分",
  simplified: "本版本采用简化规则：30块地随机牌堆；只计城市分（城闭合时每人每砖2分归占城随从放置者）；道路与田地不计分；随从每人3个；拼完全部地块比总分。",
  undoable: false,
  maxTurns: 30 * 2 + 10,
  minSeats: 2,
  maxSeats: 5,
  create: (seatsRaw, rng) => {
    const seats = Math.max(2, Math.min(5, Math.floor(seatsRaw || 2)));
    const deck = shuffle30(rng);
    return { deck, placed: [], turn: 0, score: Array(seats).fill(0), bag: Array(seats).fill(3), over: false, plies: 0, log: [`${seats}人拼图开始，从中心出发！`], seats };
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
          if (t.kind === "city" && s.bag[s.turn] > 0) acts.push({ kind: "meeple", n: k, from: { r, c }, label: `拼在(${r},${c})并放随从` });
          break;
        }
      }
    }
    return acts.slice(0, 24);
  },
  apply: (s, a) => {
    if (s.over || !a.from || (a.kind !== "place" && a.kind !== "meeple")) return null;
    const t = s.deck[0];
    if (!t) return null;
    const ok = spec.legalActions(s).some((x) => x.kind === a.kind && x.n === a.n && x.from!.r === a.from!.r && x.from!.c === a.from!.c);
    if (!ok) return null;
    const placed = [...s.placed, { ...t, r: a.from.r, c: a.from.c, rot: a.n, meepleOwner: a.kind === "meeple" ? s.turn : undefined } as Tile & { r: number; c: number; rot: number; meepleOwner?: number }];
    let { bag, score, log } = s;
    bag = bag.slice(); score = score.slice(); log = log.slice(-8);
    if (a.kind === "meeple") { bag[s.turn]--; log.push(`${seatName(s.turn)}派了个随从占城`); }
    // 检查新砖是否让某个城市闭合（四边除连接处全封闭）——简化：城市砖若无未拼邻居方向缺口即视为闭合
    const cur = placed[placed.length - 1];
    if (cur.kind === "city") {
      const comp = cityComp({ ...s, placed }, { r: cur.r, c: cur.c });
      let open = false;
      for (const cell of comp.cells) {
        const p = placed.find((x) => x.r === cell.r && x.c === cell.c)!;
        const e = rot(p.edges, (p as { rot?: number }).rot ?? 0);
        for (let d = 0; d < 4; d++) {
          if (!e[d]) continue;
          const nb = placed.find((x) => x.r === cell.r + DIRS[d][0] && x.c === cell.c + DIRS[d][1]);
          if (!nb) { open = true; break; }
        }
        if (open) break;
      }
      if (!open && comp.owners.length) {
        const owner = comp.owners[0];
        const pts = comp.cells.length * 2;
        score[owner] += pts;
        log.push(`${seatName(owner)}的城市闭合，+${pts}分！`);
        // 随从回收
        bag[owner]++;
        for (const cell of comp.cells) {
          const idx = placed.findIndex((x) => x.r === cell.r && x.c === cell.c);
          if (idx >= 0) placed[idx] = { ...placed[idx], meepleOwner: undefined } as typeof placed[number];
        }
      }
    }
    const deck = s.deck.slice(1);
    const over = deck.length === 0;
    if (over) log.push("地块拼完，清算结束！");
    return { ...s, deck, placed, turn: (s.turn + 1) % s.seats, bag, score, over, plies: s.plies + 1, log };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => {
    if (!s.over) return "ongoing";
    const tot = finalScores(s);
    const best = Math.max(...tot);
    if (tot[seat] < best) return "lose";
    return tot.filter((x) => x === best).length > 1 ? "draw" : "win";
  },
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    if (!acts.length) return null;
    // 有随从且能占城就占
    const mp = acts.find((x) => x.kind === "meeple");
    if (mp && Math.random() < 0.7) return mp;
    return acts[randInt(Math.random, acts.length)];
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.placed) && Array.isArray(o.deck) && Array.isArray(o.score) && o.score.length >= 2 && o.score.length === (o.seats ?? o.score.length) ? o : null; },
  view: (s) => {
    const cells: NonNullable<GViewCells> = [];
    const rs = s.placed.map((p) => p.r), cs = s.placed.map((p) => p.c);
    const minR = Math.min(0, ...rs), minC = Math.min(0, ...cs);
    for (const p of s.placed) {
      const e = rot(p.edges, (p as { rot?: number }).rot ?? 0);
      const own = (p as { meepleOwner?: number }).meepleOwner;
      cells.push({ r: p.r - minR, c: p.c - minC, token: own === 0 ? "myProp" : own != null ? "foeProp" : p.kind === "city" ? (e[0] + e[1] + e[2] + e[3] >= 3 ? "goalA" : "goalA") : p.kind === "road" ? "foe" : "empty", label: p.kind === "city" ? "城" : p.kind === "road" ? "路" : "田" });
    }
    const tot = finalScores(s);
    return {
      kind: "grid", rows: Math.max(5, ...s.placed.map((p) => p.r - minR + 1)), cols: Math.max(5, ...s.placed.map((p) => p.c - minC + 1)), lineStyle: "square", cells,
      notes: [`待拼 ${s.deck.length} 块 · ${s.seats}人局 分数 ${tot.map((v, i) => `${seatName(i)[0]}${v}`).join(" ")} · 随从 ${s.bag.map((v, i) => `${seatName(i)[0]}${v}`).join(" ")}`, ...s.log.slice(-2)],
    };
  },
  acceptDraw: () => false,
  endLine: (s, name) => {
    const tot = finalScores(s);
    const best = Math.max(...tot);
    const champs = tot.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0);
    if (champs.length > 1) return `卡卡颂 ${champs.map((i) => seatName(i)).join("、")} 以 ${best} 分并列夺冠`;
    const c = champs[0];
    if (c === 0) return `卡卡颂你以 ${best} 分的城市群赢了${name}`;
    if (c === 1) return `${name} 的卡卡颂城市圈以 ${best}:${tot[0]} 压过你`;
    return `小机的卡卡颂帝国以 ${best} 分碾压全场`;
  },
};
function shuffle30(rng: () => number): Tile[] {
  const d = makeDeck();
  for (let i = d.length - 1; i > 0; i--) { const j = randInt(rng, i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
function finalScores(s: S): number[] {
  return s.score.slice();
}
type GViewCells = import("./types").GView extends { cells?: infer C } ? C : never;

export default spec;
