// 大富翁（简化竞速版）：20格环形地图，掷骰前进，买地/交租/机会命运，先搞破产对手者胜或30轮比现金。支持 2-6 人。
import type { GameSpec, GAction, GView } from "./types";
import { randInt } from "./types";

type Tile = { name: string; kind: "start" | "prop" | "chance" | "tax" | "free"; price: number; rent: number };
const TILES: Tile[] = [
  { name: "起点", kind: "start", price: 0, rent: 0 },
  { name: "奶茶铺", kind: "prop", price: 60, rent: 8 },
  { name: "网吧", kind: "prop", price: 80, rent: 12 },
  { name: "命运", kind: "chance", price: 0, rent: 0 },
  { name: "电影院", kind: "prop", price: 120, rent: 20 },
  { name: "罚款", kind: "tax", price: 0, rent: 0 },
  { name: "江景房", kind: "prop", price: 180, rent: 32 },
  { name: "机会", kind: "chance", price: 0, rent: 0 },
  { name: "商业街", kind: "prop", price: 150, rent: 26 },
  { name: "免费停车", kind: "free", price: 0, rent: 0 },
  { name: "旧书店", kind: "prop", price: 70, rent: 10 },
  { name: "游乐场", kind: "prop", price: 140, rent: 24 },
  { name: "命运", kind: "chance", price: 0, rent: 0 },
  { name: "别墅区", kind: "prop", price: 220, rent: 42 },
  { name: "罚款", kind: "tax", price: 0, rent: 0 },
  { name: "写字楼", kind: "prop", price: 170, rent: 30 },
  { name: "机会", kind: "chance", price: 0, rent: 0 },
  { name: "豪宅", kind: "prop", price: 260, rent: 52 },
  { name: "便利店", kind: "prop", price: 90, rent: 14 },
  { name: "起点", kind: "start", price: 0, rent: 0 },
];
const CHANCE = ["银行发红包 +30", "退回上一格", "前进到起点领 50", "请客喝奶茶 -20", "再来一次！"];

type S = { pos: number[]; cash: number[]; owner: (number | -1)[]; turn: number; dice: number[]; phase: "roll" | "act" | "over"; log: string[]; over: boolean; winner: number; round: number; extra: boolean; seats: number };
const seatName = (seat: number) => (seat === 0 ? "你" : seat === 1 ? "TA" : `小机 ${seat - 1}`);

const spec: GameSpec<S> = {
  id: "monopoly",
  name: "大富翁",
  category: "table",
  players: "2-6人",
  ruleSummary: "掷骰走格子，买地收租，把对手熬到破产就赢",
  simplified: "本版本采用简化规则：20格固定地图；无抵押/建房/交易；经过起点领 50；付不起租金即破产出局，最后存活者胜；30 轮未分胜负则比现金。",
  undoable: false,
  maxTurns: 130 * 3,
  minSeats: 2,
  maxSeats: 6,
  create: (seatsRaw, rng) => {
    void rng;
    const seats = Math.max(2, Math.min(6, Math.floor(seatsRaw || 2)));
    return { pos: Array(seats).fill(0), cash: Array(seats).fill(300), owner: TILES.map(() => -1), turn: 0, dice: [], phase: "roll", log: [`初始资金 300，${seats}人局，买地收租，撑到最后！`], over: false, winner: -1, round: 1, extra: false, seats };
  },
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over) return [];
    if (s.phase === "roll") return [{ kind: "roll", label: "掷骰子" }];
    const acts: GAction[] = [];
    const t = TILES[s.pos[s.turn]];
    if (t.kind === "prop" && s.owner[s.pos[s.turn]] === -1 && s.cash[s.turn] >= t.price) acts.push({ kind: "buy", label: `买下${t.name}（${t.price}）` });
    acts.push({ kind: "end", label: "结束回合" });
    return acts;
  },
  apply: (s, a) => {
    if (s.over) return null;
    let phase = s.phase, turn = s.turn, extra = s.extra, over: boolean = s.over, winner = s.winner, round = s.round;
    const clone = <T,>(x: T[]): T[] => x.slice();
    let cash = clone(s.cash), owner = clone(s.owner), pos = clone(s.pos), log = s.log.slice(-8), dice = s.dice;
    const aliveCount = () => cash.filter((c) => c >= 0).length;
    const bankrupt = (who: number) => { cash[who] = -1; log.push(`${seatName(who)}破产出局！`); };
    if (a.kind === "roll") {
      const d1 = randInt(Math.random, 6) + 1, d2 = randInt(Math.random, 6) + 1;
      dice = [d1, d2];
      const steps = d1 + d2;
      const np = (pos[turn] + steps) % 20;
      if (np <= pos[turn]) { cash[turn] += 50; log.push(`${seatName(turn)}路过起点 +50`); }
      pos[turn] = np;
      const t = TILES[np];
      if (t.kind === "tax") { cash[turn] -= 25; log.push(`${seatName(turn)}在${t.name}被罚 25`); }
      if (t.kind === "prop" && owner[np] >= 0 && owner[np] !== turn && cash[owner[np]] >= 0) {
        const rent = t.rent;
        cash[turn] -= rent; cash[owner[np]] += rent;
        log.push(`${seatName(turn)}踩了${seatName(owner[np])}的${t.name}，交租 ${rent}`);
        if (cash[turn] < 0) {
          bankrupt(turn);
          if (aliveCount() <= 1) { over = true; winner = cash.findIndex((c) => c >= 0); phase = "over"; return { ...s, pos, cash, owner, turn, dice, phase, log, over, winner, round, extra }; }
        }
      }
      if (t.kind === "chance") {
        const ev = CHANCE[randInt(Math.random, CHANCE.length)];
        if (ev.includes("+30")) { cash[turn] += 30; log.push(`机会：${ev}`); }
        else if (ev.includes("-20")) { cash[turn] -= 20; log.push(`机会：${ev}`); if (cash[turn] < 0) { bankrupt(turn); if (aliveCount() <= 1) { over = true; winner = cash.findIndex((c) => c >= 0); phase = "over"; return { ...s, pos, cash, owner, turn, dice, phase, log, over, winner, round, extra }; } } }
        else if (ev.includes("起点领")) { pos[turn] = 0; cash[turn] += 50; log.push(`机会：${ev}`); }
        else if (ev.includes("上一格")) { pos[turn] = (pos[turn] + 18) % 20; log.push(`命运：${ev}`); }
        else { extra = true; log.push(`机会：${ev}`); }
      }
      phase = "act";
      return { ...s, pos, cash, owner, turn, dice, phase, log, over, winner, round, extra };
    }
    if (a.kind === "buy") {
      const p = pos[turn], t = TILES[p];
      if (t.kind !== "prop" || owner[p] !== -1 || cash[turn] < t.price) return null;
      cash[turn] -= t.price; owner[p] = turn;
      log.push(`${seatName(turn)}买下了${t.name}`);
      return { ...s, cash, owner, pos, turn, dice, phase, log, over, winner, round, extra };
    }
    if (a.kind === "end") {
      if (extra) { log.push(`${seatName(turn)}获得再掷一次的机会！`); return { ...s, pos, cash, owner, turn, dice, phase: "roll", log, over, winner, round, extra: false }; }
      // 轮到下一个未破产的家
      let nturn = turn;
      for (let k = 1; k <= s.seats; k++) { const i = (turn + k) % s.seats; if (cash[i] >= 0) { nturn = i; break; } }
      const nround = nturn <= turn ? round + 1 : round;
      if (nround > 30) {
        over = true;
        let best = -1;
        cash.forEach((c, i) => { if (c >= 0 && (best < 0 || c > cash[best])) best = i; });
        const topVal = best >= 0 ? cash[best] : 0;
        const tied = cash.filter((c) => c === topVal).length > 1;
        winner = tied ? -1 : best;
        log.push("满30轮，按现金定胜负！");
        return { ...s, pos, cash, owner, turn: nturn, dice, phase: "over", log, over, winner, round: nround, extra: false };
      }
      return { ...s, pos, cash, owner, turn: nturn, dice, phase: "roll", log, over, winner, round: nround, extra: false };
    }
    return null;
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === -1 ? "draw" : s.winner === seat ? "win" : "lose"),
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    if (!acts.length) return null;
    if (a_wantsBuy(acts, s)) return acts.find((x) => x.kind === "buy")!;
    return acts.find((x) => x.kind === "roll") ?? acts[acts.length - 1];
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.pos) && o.pos.length >= 2 && o.pos.length === (o.seats ?? o.pos.length) ? o : null; },
  view: (s) => ({
    kind: "grid",
    rows: 4, cols: 5, lineStyle: "square",
    cells: TILES.map((t, i) => {
      const at = s.pos.map((p, si) => (p === i && s.cash[si] >= 0 ? si : -1)).filter((x) => x >= 0);
      return {
        r: Math.floor(i / 5), c: i % 5,
        token: at.includes(0) ? (at.length > 1 ? "both" : "me") : at.length ? "foe" : s.owner[i] >= 0 ? (s.owner[i] === 0 ? "myProp" : "foeProp") : "empty",
        label: `${t.name}${t.kind === "prop" ? ` $${t.price}` : ""}`,
      };
    }),
    notes: [`🎲 ${s.dice.length ? s.dice.join(" + ") : "待掷"} · ${s.seats}人局 💰 ${s.cash.map((c, i) => `${seatName(i)[0]}${c < 0 ? "破产" : c}`).join(" ")}`, `第${Math.min(s.round, 30)}轮`, ...s.log.slice(-3)],
  }),
  acceptDraw: () => false,
  endLine: (s, name) => (s.winner === 0 ? `${name} 在大富翁里被你熬到破产了` : s.winner === 1 ? `${name} 的大富翁把你熬破产了` : s.winner > 1 ? `小机笑到了最后，大富翁全桌被熬破产` : "大富翁三十轮你们打了个现金平手"),
};
function a_wantsBuy(acts: GAction[], s: S): boolean {
  const buy = acts.find((x) => x.kind === "buy");
  if (!buy) return false;
  const t = TILES[s.pos[s.turn]];
  return s.cash[s.turn] - t.price >= 40 || Math.random() < 0.5;
}

export default spec;
