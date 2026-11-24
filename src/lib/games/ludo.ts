// 飞行棋（简化双人对冲版）：每方4架机，56格环形跑道+终点线。掷6起飞/前进，踩对手回库，先到4架全回家者胜。
import type { GameSpec, GAction, GView } from "./types";
import { randInt } from "./types";

// pos: -1=库中, 0..55=跑道, 56..61=终点支线(6格), 62=到家
type S = { pos: number[][]; turn: number; dice: number | null; over: boolean; winner: number; round: number; plies: number; log: string[] };
const TRACK = 56, FINISH = 6;

function idxOf(pos: number): number { return pos < 0 ? -1 : pos; }
void idxOf;

const spec: GameSpec<S> = {
  id: "ludo",
  name: "飞行棋",
  category: "table",
  players: "2-4人",
  ruleSummary: "掷6起飞，绕场一周进支线，撞飞对手回库，四架全部到家赢",
  simplified: "本版本采用简化规则：双方共用一条56格环形跑道（起点错开28格）；只有掷到6才能从库中起飞；落点有对方单机则将其撞回库（同色两架占位则不撞）；掷6可再掷一次；支线6格必须精确到达。",
  undoable: false,
  maxTurns: 200,
  create: (_seats, rng) => {
    void rng;
    return { pos: [[-1, -1, -1, -1], [-1, -1, -1, -1]], turn: 0, dice: null, over: false, winner: -1, round: 1, plies: 0, log: ["四架飞机待命，掷 6 起飞！"] };
  },
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over) return [];
    const acts: GAction[] = [];
    if (s.dice === null) return [{ kind: "roll", label: "掷骰子" }];
    const me = s.turn, start = me * 28, d = s.dice;
    s.pos[me].forEach((p, i) => {
      if (p === 62) return;
      if (p === -1) { if (d === 6) acts.push({ kind: "move", n: i, label: `起飞 ${i + 1}号` }); return; }
      let np: number;
      if (p < TRACK) {
        const abs = (start + p + d) % TRACK;
        // 进入支线判断：绕回自己起点附近即转支线
        const rel = (p + d);
        if (rel >= TRACK) np = TRACK + (rel - TRACK);
        else np = abs === undefined ? rel : rel;
        if (rel < TRACK) np = rel;
      } else {
        np = p + d;
        if (np > TRACK + FINISH - 1 + 1) return; // 超支不能动
      }
      if (p >= TRACK && np !== TRACK + FINISH) { if (p + d <= TRACK + FINISH - 1 + 1) { /* ok */ } }
      if (np === TRACK + FINISH) np = 62;
      if (np > 62 || (p >= TRACK && p + d > TRACK + FINISH)) return;
      acts.push({ kind: "move", n: i, label: `${i + 1}号 → ${np === 62 ? "到家" : np < TRACK ? `第${np + 1}格` : `支线${np - TRACK + 1}`}` });
    });
    if (!acts.length) acts.push({ kind: "skip", label: "无子可动，过" });
    return acts;
  },
  apply: (s, a) => {
    if (s.over) return null;
    const pos = s.pos.map((p) => p.slice());
    const log = s.log.slice(-6);
    let dice: number | null = s.dice, turn = s.turn, over: boolean = s.over, winner = s.winner, round = s.round, plies = s.plies;
    if (a.kind === "roll") { dice = randInt(Math.random, 6) + 1; log.push(`${["你", "TA"][turn]}掷出 ${dice}${dice === 6 ? "（可再掷）" : ""}`); return { ...s, pos, dice, turn, over, winner, round, plies: plies + 1, log }; }
    if (a.kind === "skip" || a.kind === "pass") {
      dice = null; turn = 1 - turn; if (turn === 0) round++;
      return { ...s, pos, dice, turn, over, winner, round, plies: plies + 1, log };
    }
    if (a.kind === "move" && a.n !== undefined && dice !== null) {
      const me = turn, foe = 1 - me, start = me * 28, d = dice;
      const p = pos[me][a.n];
      let np: number;
      if (p === -1) { if (d !== 6) return null; np = 0; log.push(`${a.n + 1}号起飞！`); }
      else if (p < TRACK) {
        const rel = p + d;
        np = rel >= TRACK ? TRACK + (rel - TRACK) : rel;
        if (np < TRACK) {
          const absPos = (start + np) % TRACK;
          // 撞子：对方在跑道上且该绝对格只有对方一架
          const foeIdx = pos[foe].findIndex((fp) => fp >= 0 && fp < TRACK && (foe * 28 + fp) % TRACK === absPos);
          const foeSame = pos[foe].filter((fp) => fp >= 0 && fp < TRACK && (foe * 28 + fp) % TRACK === absPos).length;
          if (foeIdx >= 0 && foeSame === 1) { pos[foe][foeIdx] = -1; log.push(`撞飞 TA ${foeIdx + 1}号回库！💥`); }
        }
      } else {
        np = p + d;
        if (np > TRACK + FINISH) return null;
        if (np === TRACK + FINISH) { np = 62; log.push(`${a.n + 1}号安全到家 🏠`); }
      }
      pos[me][a.n] = np;
      dice = null;
      if (pos[me].every((x) => x === 62)) { over = true; winner = me; log.push(`${["你", "TA"][me]}四架全部到家！`); return { ...s, pos, dice: null, turn, over: true, winner, round, plies: plies + 1, log }; }
      turn = 1 - me; if (turn === 0) round++;
      return { ...s, pos, dice, turn, over, winner, round, plies: plies + 1, log };
    }
    return null;
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === -1 ? "draw" : s.winner === seat ? "win" : "lose"),
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    if (!acts.length) return null;
    const roll = acts.find((a) => a.kind === "roll");
    if (roll) return roll;
    const moves = acts.filter((a) => a.kind === "move");
    if (!moves.length) return acts.find((a) => a.kind === "skip") ?? null;
    // 优先回家 > 起飞 > 随机
    for (const m of moves) if ((m.label ?? "").includes("到家")) return m;
    const takeoff = moves.find((m) => (m.label ?? "").includes("起飞"));
    if (takeoff && Math.random() < 0.7) return takeoff;
    return moves[randInt(Math.random, moves.length)];
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.pos) && o.pos.length === 2 ? o : null; },
  view: (s) => ({
    kind: "panel",
    panels: [0, 1].map((i) => ({
      seat: i,
      title: i === 0 ? "你的机队" : "TA的机队",
      lines: s.pos[i].map((p, k) => `${k + 1}号：${p === -1 ? "库中待命" : p === 62 ? "🏠 已到家" : p < 56 ? `跑道第${p + 1}格` : `支线第${p - 55}格`}`),
    })),
    notes: [`🎲 ${s.dice ?? "待掷"} · 第${s.round}圈 · ${s.over ? `【${["你", "TA"][s.winner]}】全员到家！` : ["你的回合", "TA思考中…"][s.turn]}`, ...s.log.slice(-2)],
  }),
  acceptDraw: () => false,
  endLine: (s, name) => (s.winner === 0 ? `${name} 的飞行棋被你撞得只剩在地面打转` : s.winner === 1 ? `${name} 飞行棋四架全落了地，你先到了家` : "飞行棋你们还在跑道上盘旋"),
};

export default spec;
