// 飞行棋（简化多人对冲版）：每方4架机，56格环形跑道+终点线。掷6起飞/前进，踩对手回库，先到4架全回家者胜。支持 2-4 人。
import type { GameSpec, GAction, GView } from "./types";
import { randInt } from "./types";

// pos: -1=库中, 0..55=跑道(相对自家起点), 56..61=终点支线(6格), 62=到家
type S = { pos: number[][]; turn: number; dice: number | null; over: boolean; winner: number; round: number; plies: number; log: string[]; seats: number };
const TRACK = 56, FINISH = 6;
const seatName = (seat: number) => (seat === 0 ? "你" : seat === 1 ? "TA" : `小机 ${seat - 1}`);
// 各家起点在环上的绝对偏移：均分 56 格
const startOf = (seat: number, seats: number) => Math.round((seat * TRACK) / seats);

const spec: GameSpec<S> = {
  id: "ludo",
  name: "飞行棋",
  category: "table",
  players: "2-4人",
  ruleSummary: "掷6起飞，绕场一周进支线，撞飞对手回库，四架全部到家赢",
  simplified: "本版本采用简化规则：所有玩家共用一条56格环形跑道（起点按人数均分错开）；只有掷到6才能从库中起飞；落点有对方单机则将其撞回库；掷6可再掷一次；支线6格必须精确到达；第一个全员到家者胜。",
  undoable: false,
  maxTurns: 200 * 2,
  minSeats: 2,
  maxSeats: 4,
  create: (seatsRaw, rng) => {
    void rng;
    const seats = Math.max(2, Math.min(4, Math.floor(seatsRaw || 2)));
    return { pos: Array.from({ length: seats }, () => [-1, -1, -1, -1]), turn: 0, dice: null, over: false, winner: -1, round: 1, plies: 0, log: [`四架飞机待命，${seats}人局，掷 6 起飞！`], seats };
  },
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over) return [];
    const acts: GAction[] = [];
    if (s.dice === null) return [{ kind: "roll", label: "掷骰子" }];
    const me = s.turn, d = s.dice;
    s.pos[me].forEach((p, i) => {
      if (p === 62) return;
      if (p === -1) { if (d === 6) acts.push({ kind: "move", n: i, label: `起飞 ${i + 1}号` }); return; }
      const rel = p < TRACK ? p + d : p + d;
      if (rel > TRACK + FINISH) return; // 超支不能动
      const np = rel >= TRACK ? Math.min(rel, TRACK + FINISH) : rel;
      acts.push({ kind: "move", n: i, label: `${i + 1}号 → ${np === TRACK + FINISH ? "到家" : np < TRACK ? `第${np + 1}格` : `支线${np - TRACK + 1}`}` });
    });
    if (!acts.length) acts.push({ kind: "skip", label: "无子可动，过" });
    return acts;
  },
  apply: (s, a) => {
    if (s.over) return null;
    const pos = s.pos.map((p) => p.slice());
    const log = s.log.slice(-8);
    let dice: number | null = s.dice, turn = s.turn, over: boolean = s.over, winner = s.winner, round = s.round, plies = s.plies;
    const nextTurn = (from: number) => (from + 1) % s.seats;
    if (a.kind === "roll") { dice = randInt(Math.random, 6) + 1; log.push(`${seatName(turn)}掷出 ${dice}${dice === 6 ? "（可再掷）" : ""}`); return { ...s, pos, dice, turn, over, winner, round, plies: plies + 1, log }; }
    if (a.kind === "skip" || a.kind === "pass") {
      dice = null; turn = nextTurn(turn); if (turn === 0) round++;
      return { ...s, pos, dice, turn, over, winner, round, plies: plies + 1, log };
    }
    if (a.kind === "move" && a.n !== undefined && dice !== null) {
      const me = turn, d = dice;
      const p = pos[me][a.n];
      let np: number;
      if (p === -1) { if (d !== 6) return null; np = 0; log.push(`${seatName(me)} ${a.n + 1}号起飞！`); }
      else {
        const rel = p + d;
        if (rel > TRACK + FINISH) return null;
        if (rel >= TRACK) {
          np = rel === TRACK + FINISH ? 62 : rel;
          if (np === 62) log.push(`${seatName(me)} ${a.n + 1}号安全到家 🏠`);
        } else {
          np = rel;
          // 撞子：其他家在跑道上且该绝对格只有对方一架
          const absPos = (startOf(me, s.seats) + np) % TRACK;
          for (let foe = 0; foe < s.seats; foe++) {
            if (foe === me) continue;
            const hitIdxs = pos[foe].map((fp, k) => (fp >= 0 && fp < TRACK && (startOf(foe, s.seats) + fp) % TRACK === absPos ? k : -1)).filter((x) => x >= 0);
            if (hitIdxs.length === 1) { pos[foe][hitIdxs[0]] = -1; log.push(`${seatName(me)}撞飞 ${seatName(foe)} ${hitIdxs[0] + 1}号回库！💥`); }
          }
        }
      }
      pos[me][a.n] = np;
      const again = d === 6;
      dice = null;
      if (pos[me].every((x) => x === 62)) { over = true; winner = me; log.push(`${seatName(me)}四架全部到家！`); return { ...s, pos, dice: null, turn, over: true, winner, round, plies: plies + 1, log }; }
      if (!again) { turn = nextTurn(turn); if (turn === 0) round++; }
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
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.pos) && o.pos.length >= 2 && o.pos.length === (o.seats ?? o.pos.length) ? o : null; },
  view: (s) => ({
    kind: "panel",
    panels: s.pos.map((_, i) => ({
      seat: i,
      title: `${seatName(i)}的机队`,
      lines: s.pos[i].map((p, k) => `${k + 1}号：${p === -1 ? "库中待命" : p === 62 ? "🏠 已到家" : p < 56 ? `跑道第${p + 1}格` : `支线第${p - 55}格`}`),
    })),
    notes: [`🎲 ${s.dice ?? "待掷"} · ${s.seats}人局 · 第${s.round}圈 · ${seatName(s.turn)}的回合`, ...s.log.slice(-3)],
  }),
  acceptDraw: () => false,
  endLine: (s, name) => (s.winner === 0 ? `${name} 的飞行棋被你撞得只剩在地面打转` : s.winner === 1 ? `${name} 飞行棋四架全落了地，你先到了家` : s.winner > 1 ? `小机的飞行棋抢先把四架全开回了家` : "飞行棋你们还在跑道上盘旋"),
};

export default spec;
