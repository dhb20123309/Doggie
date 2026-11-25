// 围棋（13路简化）：落子、气尽提子、禁自杀、劫争简单禁全同局面；终局数子（子+实地），黑贴 3.75 目简化为贴 4。
import type { GameSpec, GAction, GView } from "./types";

const N = 13;
type S = { b: (0 | 1 | 2)[]; turn: number; over: boolean; passes: number; plies: number; prevKey: string; scoreB: number; scoreW: number; done: boolean };
const gi = (r: number, c: number) => r * N + c;
const nb = (i: number): number[] => { const r = Math.floor(i / N), c = i % N; const out: number[] = []; if (r > 0) out.push(i - N); if (r < N - 1) out.push(i + N); if (c > 0) out.push(i - 1); if (c < N - 1) out.push(i + 1); return out; };
function group(b: (0 | 1 | 2)[], i: number): { stones: number[]; libs: Set<number> } {
  const v = b[i]; const seen = new Set([i]); const st = [i]; const libs = new Set<number>();
  const q = [i];
  while (q.length) {
    const cur = q.shift()!;
    for (const m of nb(cur)) { if (!b[m]) libs.add(m); else if (b[m] === v && !seen.has(m)) { seen.add(m); st.push(m); q.push(m); } }
  }
  return { stones: st, libs };
}
function wouldCapture(b: (0 | 1 | 2)[], i: number, v: 1 | 2): number[] {
  const t = b.slice() as (0 | 1 | 2)[]; t[i] = v;
  const caps: number[] = [];
  for (const m of nb(i)) if (t[m] && t[m] !== v) { const g = group(t, m); if (g.libs.size === 0) caps.push(...g.stones); }
  return caps;
}
function legalFor(s: S): GAction[] {
  if (s.over) return [];
  const acts: GAction[] = [];
  const me = s.turn === 0 ? 1 : 2;
  for (let i = 0; i < N * N; i++) {
    if (s.b[i]) continue;
    const caps = wouldCapture(s.b, i, me);
    const t = s.b.slice() as (0 | 1 | 2)[]; t[i] = me;
    for (const c of caps) t[c] = 0;
    if (group(t, i).libs.size === 0 && !caps.length) continue; // 禁自杀
    acts.push({ kind: "put", n: i });
  }
  acts.push({ kind: "pass", label: "虚着" });
  return acts;
}
function territory(b: (0 | 1 | 2)[]): { x: number; o: number } {
  let x = 0, o = 0;
  const seen = new Set<number>();
  for (let i = 0; i < N * N; i++) {
    if (b[i] || seen.has(i)) continue;
    const region: number[] = []; const borders = new Set<number>();
    const q = [i]; seen.add(i);
    while (q.length) {
      const cur = q.shift()!; region.push(cur);
      for (const m of nb(cur)) { if (b[m]) borders.add(b[m]); else if (!seen.has(m)) { seen.add(m); q.push(m); } }
    }
    if (borders.size === 1) { if (borders.has(1)) x += region.length; else o += region.length; }
  }
  for (let i = 0; i < N * N; i++) { if (b[i] === 1) x++; else if (b[i] === 2) o++; }
  return { x, o };
}

const spec: GameSpec<S> = {
  id: "go",
  name: "围棋",
  category: "board",
  players: "2人",
  ruleSummary: "围地多者胜，气尽提子，双方连续虚着终局",
  simplified: "本版本采用简化规则：13 路小棋盘；黑先行贴 4 点；禁全局同形（打劫需先应一处）；不计死子清盘，终局按活子+单色空点数子。",
  undoable: true,
  maxTurns: 340,
  create: () => ({ b: Array(N * N).fill(0) as (0 | 1 | 2)[], turn: 0, over: false, passes: 0, plies: 0, prevKey: "", scoreB: 0, scoreW: 0, done: false }),
  turnOf: (s) => s.turn,
  legalActions: legalFor,
  apply: (s, a) => {
    if (s.over) return null;
    if (a.kind === "pass") {
      const passes = s.passes + 1;
      if (passes >= 2) { const t = territory(s.b); return { ...s, over: true, passes, done: true, scoreB: t.x, scoreW: t.o + 4 }; }
      return { ...s, passes, turn: s.turn === 0 ? 1 : 0, plies: s.plies + 1 };
    }
    if (a.kind !== "put" || a.n == null || s.b[a.n]) return null;
    const me = s.turn === 0 ? 1 : 2;
    const caps = wouldCapture(s.b, a.n, me);
    const b = s.b.slice() as (0 | 1 | 2)[];
    b[a.n] = me;
    for (const c of caps) b[c] = 0;
    if (group(b, a.n).libs.size === 0 && !caps.length) return null;
    const key = b.join("") + (s.turn === 0 ? 1 : 0);
    if (key === s.prevKey) return null; // 禁全同（简化劫）
    return { ...s, b, turn: s.turn === 0 ? 1 : 0, passes: 0, prevKey: s.b.join("") + s.turn, plies: s.plies + 1 };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (!s.done ? "draw" : seat === 0 ? (s.scoreB > s.scoreW ? "win" : s.scoreB < s.scoreW ? "lose" : "draw") : (s.scoreW > s.scoreB ? "win" : s.scoreW < s.scoreB ? "lose" : "draw")),
  aiMove: (s) => {
    const acts = legalFor(s).filter((a) => a.kind === "put");
    if (!acts.length) return { kind: "pass", label: "虚着" };
    let best = acts[0], sc = -1e9;
    for (const a of acts) {
      const nx = spec.apply(s, a)!;
      const me = 2;
      let v = 0;
      // 吃子价值 + 自身气 + 靠近已有子 + 占星位
      const idx = a.n!;
      const t = nx.b;
      let gained = 0; for (let i = 0; i < t.length; i++) if (s.b[i] === 1 && !t[i]) gained++;
      v += gained * 30;
      v += group(t, idx).libs.size * 6;
      // 若下完后自己无气且没吃到（apply 已拦），此处不重复
      // 送子检测：对方下一步能吃掉我这颗
      const foeActs = legalFor(nx).filter((x) => x.kind === "put");
      let danger = 0;
      for (const f of foeActs.slice(0, 60)) { const tt = nx.b.slice() as (0 | 1 | 2)[]; tt[f.n!] = 1; if (group(tt, f.n!).libs.size === 0) continue; const g = group(tt, idx); if (g.libs.size === 1 && g.libs.has(f.n!)) danger++; }
      v -= danger * 8;
      const r = Math.floor(idx / N), c = idx % N;
      if ((r === 3 || r === N - 4 || r === 6) && (c === 3 || c === N - 4 || c === 6)) v += 12;
      let near = 0; for (const m of nb(idx)) if (t[m]) near++;
      v += near * 3 + Math.random() * 6;
      void me;
      if (v > sc) { sc = v; best = a; }
    }
    // 后期没意思就虚着
    if (s.plies > 150 && sc < 10) return { kind: "pass", label: "虚着" };
    return best;
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.b) && o.b.length === N * N ? o : null; },
  view: (s, _sel, hints) => {
    const hs = new Set(hints.filter((h) => h.kind === "put").map((h) => h.n!));
    return {
      kind: "grid", rows: N, cols: N, lineStyle: "cross",
      cells: s.b.map((v, i) => ({ r: Math.floor(i / N), c: i % N, token: v === 1 ? "blk" : v === 2 ? "wht" : "", hint: hs.has(i) })),
      notes: s.done ? [`数子结果 黑${s.scoreB - 4}(+贴4前) 白${s.scoreW}`] : ["双方连续虚着即终局数子"],
    } as GView;
  },
  acceptDraw: (s) => s.plies > 60,
  endLine: (s, name) => (!s.done ? "围棋中盘认负" : s.scoreB > s.scoreW ? `${name} 的围棋输了（黑${s.scoreB - 4}比白${s.scoreW}）` : s.scoreB < s.scoreW ? `${name} 赢了这盘围棋（白${s.scoreW}目胜）` : "围棋收官平局"),
};

export default spec;
