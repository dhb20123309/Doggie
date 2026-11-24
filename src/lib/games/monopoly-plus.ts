// 大富翁·改：在经典版上加"技能卡"——每过起点抽一张（冻结/偷税/双倍租/护盾），节奏更快更闹。
import type { GameSpec, GAction, GView } from "./types";
import { randInt } from "./types";

type Tile = { name: string; kind: "start" | "prop" | "chance" | "tax" | "free"; price: number; rent: number };
const TILES: Tile[] = [
  { name: "起点", kind: "start", price: 0, rent: 0 },
  { name: "烧烤摊", kind: "prop", price: 60, rent: 10 },
  { name: "剧本杀", kind: "prop", price: 100, rent: 16 },
  { name: "技能", kind: "chance", price: 0, rent: 0 },
  { name: "民宿", kind: "prop", price: 140, rent: 24 },
  { name: "罚单", kind: "tax", price: 0, rent: 0 },
  { name: "商铺", kind: "prop", price: 170, rent: 30 },
  { name: "技能", kind: "chance", price: 0, rent: 0 },
  { name: "公寓", kind: "prop", price: 200, rent: 38 },
  { name: "免费停车", kind: "free", price: 0, rent: 0 },
];
const SKILLS = ["freeze", "steal", "double", "shield"] as const;
const SKILL_CN: Record<string, string> = { freeze: "冻结卡：TA下回合停掷一次", steal: "偷税卡：抢走TA 40 元", double: "双倍卡：下次收租翻倍", shield: "护盾卡：免一次租金" };

type S = { pos: number[]; cash: number[]; owner: (number | -1)[]; hand: string[][]; turn: number; dice: number[]; skip: boolean[]; dbl: boolean[]; shield: boolean[]; log: string[]; over: boolean; winner: number; round: number; phase: "roll" | "act" };

const spec: GameSpec<S> = {
  id: "monopoly-plus",
  name: "大富翁·改",
  category: "table",
  players: "2-4人",
  ruleSummary: "十格快图+技能卡互坑，先破产谁哭",
  simplified: "本版本采用简化规则：10格循环小地图；踩「技能」抽一张卡（冻结/偷税/双倍/护盾四选一随机）；卡在手随时可打；过起点 +40；25 轮比现金。",
  undoable: false,
  maxTurns: 110,
  create: (_seats, rng) => {
    void rng;
    return { pos: [0, 0], cash: [250, 250], owner: TILES.map(() => -1), hand: [[], []], turn: 0, dice: [], skip: [false, false], dbl: [false, false], shield: [false, false], log: ["魔改版大富翁！攒钱买地，抽空坑TA。"], over: false, winner: -1, round: 1, phase: "roll" };
  },
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over) return [];
    const acts: GAction[] = [];
    for (const k of s.hand[s.turn]) acts.push({ kind: "skill", s: k, label: `用${SKILL_CN[k].split("：")[0]}` });
    if (s.phase === "roll") {
      if (s.skip[s.turn]) acts.push({ kind: "skipped", label: "被冻结，跳过" });
      else acts.push({ kind: "roll", label: "掷骰子" });
      return acts;
    }
    const p = s.pos[s.turn], t = TILES[p];
    if (t.kind === "prop" && s.owner[p] === -1 && s.cash[s.turn] >= t.price) acts.push({ kind: "buy", label: `买下${t.name}（${t.price}）` });
    acts.push({ kind: "end", label: "结束回合" });
    return acts;
  },
  apply: (s, a) => {
    if (s.over) return null;
    let phase = s.phase, turn = s.turn, round = s.round, over: boolean = s.over, winner = s.winner;
    const cash = s.cash.slice(), owner = s.owner.slice(), pos = s.pos.slice(), hand = s.hand.map((h) => h.slice()), skip = s.skip.slice(), dbl = s.dbl.slice(), shield = s.shield.slice();
    const log = s.log.slice(-6);
    if (a.kind === "skill" && a.s) {
      const idx = hand[turn].indexOf(a.s);
      if (idx < 0) return null;
      hand[turn].splice(idx, 1);
      const foe = 1 - turn;
      if (a.s === "freeze") skip[foe] = true;
      else if (a.s === "steal") { const amt = Math.min(40, cash[foe]); cash[foe] -= amt; cash[turn] += amt; log.push(`偷税成功，抢了 ${amt} 元`); }
      else if (a.s === "double") dbl[turn] = true;
      else if (a.s === "shield") shield[turn] = true;
      log.push(`${["你", "TA"][turn]}使用了${SKILL_CN[a.s].split("：")[0]}`);
      return { ...s, cash, owner, pos, hand, turn, skip, dbl, shield, log, over, winner, round, phase };
    }
    if (a.kind === "skipped") { skip[turn] = false; log.push("这回合被冻住了…"); return { ...s, cash, owner, pos, hand, turn: 1 - turn, skip, dbl, shield, log, over, winner, round: turn === 1 ? round + 1 : round, phase: "roll" }; }
    if (a.kind === "roll") {
      const d = randInt(Math.random, 6) + 1;
      const np = (pos[turn] + d) % 10;
      if (np < pos[turn]) { cash[turn] += 40; log.push(`${["你", "TA"][turn]}绕圈回起点 +40`); }
      pos[turn] = np;
      const t = TILES[np];
      if (t.kind === "tax") { cash[turn] -= 20; log.push(`罚单！-20`); }
      if (t.kind === "chance") { const sk = SKILLS[randInt(Math.random, 4)]; hand[turn].push(sk); log.push(`抽到技能：${SKILL_CN[sk].split("：")[0]}`); }
      if (t.kind === "prop" && owner[np] >= 0 && owner[np] !== turn) {
        let rent = t.rent * (dbl[owner[np]] ? 2 : 1);
        dbl[owner[np]] = false;
        if (shield[turn]) { shield[turn] = false; log.push(`护盾挡掉了 ${rent} 元租金！`); }
        else {
          cash[turn] -= rent; cash[owner[np]] += rent;
          log.push(`${["你", "TA"][turn]}交了 ${rent} 租金给${["你", "TA"][owner[np]]}`);
          if (cash[turn] < 0) { over = true; winner = owner[np]; log.push(`${["你", "TA"][turn]}破产！`); return { ...s, cash, owner, pos, hand, turn, dice: [d], skip, dbl, shield, log, over, winner, round, phase: "act" }; }
        }
      }
      return { ...s, cash, owner, pos, hand, turn, dice: [d], skip, dbl, shield, log, over, winner, round, phase: "act" };
    }
    if (a.kind === "buy") {
      const p = pos[turn], t = TILES[p];
      if (t.kind !== "prop" || owner[p] !== -1 || cash[turn] < t.price) return null;
      cash[turn] -= t.price; owner[p] = turn; log.push(`${["你", "TA"][turn]}盘下了${t.name}`);
      return { ...s, cash, owner, pos, hand, turn, dice: s.dice, skip, dbl, shield, log, over, winner, round, phase };
    }
    if (a.kind === "end") {
      const nturn = 1 - turn, nround = nturn === 0 ? round + 1 : round;
      if (nround > 25) { over = true; winner = cash[0] === cash[1] ? -1 : cash[0] > cash[1] ? 0 : 1; log.push("25轮终局，看钱包！"); }
      return { ...s, cash, owner, pos, hand, turn: nturn, dice: [], skip, dbl, shield, log, over, winner, round: nround, phase: "roll" };
    }
    return null;
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === -1 ? "draw" : s.winner === seat ? "win" : "lose"),
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    if (!acts.length) return null;
    const skill = acts.find((x) => x.kind === "skill");
    if (skill && Math.random() < 0.6) return skill;
    const roll = acts.find((x) => x.kind === "roll");
    if (roll) return roll;
    const skipped = acts.find((x) => x.kind === "skipped");
    if (skipped) return skipped;
    const buy = acts.find((x) => x.kind === "buy");
    if (buy && (s.cash[s.turn] - TILES[s.pos[s.turn]].price >= 30 || Math.random() < 0.4)) return buy;
    return acts.find((x) => x.kind === "end") ?? acts[0];
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.pos) && o.pos.length === 2 ? o : null; },
  view: (s) => ({
    kind: "grid",
    rows: 2, cols: 5, lineStyle: "square",
    cells: TILES.map((t, i) => ({
      r: Math.floor(i / 5), c: i % 5,
      token: s.pos[0] === i && s.pos[1] === i ? "both" : s.pos[0] === i ? "me" : s.pos[1] === i ? "foe" : s.owner[i] >= 0 ? ["myProp", "foeProp"][s.owner[i]] : "empty",
      label: `${t.name}${t.kind === "prop" ? ` $${t.price}` : ""}`,
    })),
    notes: [`🎲 ${s.dice.length ? s.dice[0] : "—"} · 你 💰${s.cash[0]}（手卡${s.hand[0].length}）TA 💰${s.cash[1]} · 第${Math.min(s.round, 25)}轮`, ...s.log.slice(-3)],
  }),
  acceptDraw: () => false,
  endLine: (s, name) => (s.winner === 0 ? `${name} 在大富翁·改里被你坑到破产` : s.winner === 1 ? `${name} 大富翁·改把你技能卡全憋死了` : "大富翁·改二十五轮你们钱包一样鼓"),
};

export default spec;
