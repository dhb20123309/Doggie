// 宝石商人（Splendor 简化单挑版）：拿宝石→买发展卡→凑等级，先集满 15 分者胜。
// 手持临时宝石全部内聚在 state.tokens 中（旧版用模块级全局表会跨局污染，已废弃）。
import type { GameSpec, GAction, GView } from "./types";
import { randInt } from "./types";

type Gem = 0 | 1 | 2 | 3 | 4; // 白蓝绿红黑
type Card = { id: number; cost: Partial<Record<Gem, number>>; color: Gem; pts: number; owner?: number };
type S = {
  bank: number[];
  cards: Card[][];
  tokens: number[][]; // [seat][gem] 手持临时宝石
  turn: number;
  over: boolean;
  winner: number;
  plies: number;
  log: string[];
};
const GEM_CN = ["⚪", "🔵", "🟢", "🔴", "⚫"];

function makeCards(): Card[][] {
  const tiers: Card[][] = [[], [], []];
  let id = 0;
  for (let t = 0; t < 3; t++) {
    for (let i = 0; i < 12; i++) {
      const color = (i % 5) as Gem;
      const cost: Partial<Record<Gem, number>> = {};
      const n = 3 - t; // 高级更便宜
      for (let k = 0; k < 2 + (t === 0 ? 1 : 0); k++) {
        const g = ((i + k * 2 + t) % 5) as Gem;
        if (g !== color) cost[g] = (cost[g] ?? 0) + Math.max(1, n - (k % 2));
      }
      tiers[t].push({ id: id++, cost, color, pts: t === 0 ? 1 : t === 1 ? 2 : 4 });
    }
  }
  return tiers;
}
function shuffleTier<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) { const j = randInt(rng, i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
function ownedCount(s: S, seat: number): number[] {
  const out = [0, 0, 0, 0, 0];
  for (const tier of s.cards) for (const c of tier) if (c.owner === seat) out[c.color]++;
  return out;
}
function myScore(s: S, seat: number): number {
  let v = 0;
  for (const tier of s.cards) for (const c of tier) if (c.owner === seat) v += c.pts;
  // 某色集满7张卡自动+3分（贵族来访简化）
  const own = ownedCount(s, seat);
  for (const n of own) if (n >= 7) v += 3;
  return v;
}
function canBuy(s: S, seat: number, c: Card): boolean {
  const own = ownedCount(s, seat), t = s.tokens[seat];
  for (const k of Object.keys(c.cost) as unknown as Gem[]) {
    if (own[k] + t[k] < (c.cost[k] ?? 0)) return false;
  }
  return true;
}
function payFrom(next: S, seat: number, c: Card) {
  const own = ownedCount(next, seat);
  const t = next.tokens[seat];
  for (const k of Object.keys(c.cost) as unknown as Gem[]) {
    let need = c.cost[k] ?? 0;
    need -= Math.min(own[k], need);
    t[k] = Math.max(0, t[k] - need);
  }
}
function tokenLabel(s: S, seat: number): string {
  return s.tokens[seat].map((n, g) => (n ? GEM_CN[g] + n : "")).filter(Boolean).join(" ") || "空";
}

const spec: GameSpec<S> = {
  id: "splendor",
  name: "宝石商人",
  category: "table",
  players: "2-4人",
  ruleSummary: "拿宝石买卡片，卡片既加分又当永久矿脉，先到15分赢",
  simplified: "本版本采用简化规则：两人局；每回合三选一——拿2颗同款 / 拿2颗不同款 / 买一张明牌；某色集满7张卡额外+3分。",
  undoable: false,
  maxTurns: 60,
  create: (_seats, rng) => {
    const cards = makeCards().map((tier) => shuffleTier(tier, rng));
    return { bank: [4, 4, 4, 4, 4], cards, tokens: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]], turn: 0, over: false, winner: -1, plies: 0, log: ["商战开始，先攒到 15 分！"] };
  },
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over) return [];
    const acts: GAction[] = [];
    for (let g = 0; g < 5; g++) {
      if (s.bank[g] >= 2) acts.push({ kind: "take2", n: g, label: `拿2颗${GEM_CN[g]}` });
      for (let h = g + 1; h < 5; h++) if (s.bank[g] >= 1 && s.bank[h] >= 1) acts.push({ kind: "take", n: g, s: String(h), label: `拿${GEM_CN[g]}+${GEM_CN[h]}` });
    }
    for (const tier of s.cards) for (const c of tier.slice(0, 4)) {
      if (canBuy(s, s.turn, c)) acts.push({ kind: "buy", n: c.id, label: `买 ${GEM_CN[c.color]}${c.pts}分卡` });
    }
    return acts.slice(0, 24);
  },
  apply: (s, a) => {
    if (s.over) return null;
    const bank = s.bank.slice();
    const cards = s.cards.map((t) => t.slice());
    const tokens = s.tokens.map((t) => t.slice());
    const log = s.log.slice(-6);
    const me = s.turn;
    if (a.kind === "take2" && a.n !== undefined) {
      if (bank[a.n] < 2) return null;
      bank[a.n] -= 2; tokens[me][a.n] += 2;
      log.push(`${["你", "TA"][me]}拿了2颗${GEM_CN[a.n]}`);
    } else if (a.kind === "take" && a.n !== undefined && a.s !== undefined) {
      const h = Number(a.s);
      if (bank[a.n] < 1 || bank[h] < 1) return null;
      bank[a.n]--; bank[h]--; tokens[me][a.n]++; tokens[me][h]++;
      log.push(`${["你", "TA"][me]}拿了${GEM_CN[a.n]}和${GEM_CN[h]}`);
    } else if (a.kind === "buy" && a.n !== undefined) {
      let found: Card | null = null, tierIdx = -1;
      for (let t = 0; t < 3; t++) { const c = cards[t].find((x) => x.id === a.n); if (c) { found = c; tierIdx = t; break; } }
      if (!found || !canBuy(s, me, found)) return null;
      const next: S = { ...s, bank, cards, tokens, log };
      payFrom(next, me, found);
      found.owner = me;
      cards[tierIdx] = cards[tierIdx].filter((x) => x.id !== a.n);
      if (tierIdx < 2 && cards[tierIdx + 1].length) cards[tierIdx].push(cards[tierIdx + 1].shift()!);
      log.push(`${["你", "TA"][me]}买下了${GEM_CN[found.color]} ${found.pts}分卡`);
      const sc = myScore(next, me);
      if (sc >= 15) return { ...next, over: true, winner: me, turn: me, plies: s.plies + 1, log: [...log, `${["你", "TA"][me]}冲到 ${sc} 分！`] };
    } else return null;
    // 手持上限10颗：超限自动弃回最多余量
    const t = tokens[me];
    let total = t.reduce((x, y) => x + y, 0);
    while (total > 10) { const g = t.indexOf(Math.max(...t)); t[g]--; total--; }
    return { ...s, bank, cards, tokens, turn: 1 - me, over: false, winner: -1, plies: s.plies + 1, log };
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => {
    if (!s.over) return "ongoing";
    return s.winner === seat ? "win" : "lose";
  },
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    if (!acts.length) return null;
    const buy = acts.filter((a) => a.kind === "buy");
    if (buy.length && Math.random() < 0.85) {
      let best = buy[0], bv = -1;
      for (const b of buy) {
        for (const tier of s.cards) { const c = tier.find((x) => x.id === b.n); if (c && c.pts > bv) { bv = c.pts; best = b; } }
      }
      return best;
    }
    return acts[randInt(Math.random, acts.length)];
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.bank) && o.bank.length === 5 && Array.isArray(o.tokens) && o.tokens.length === 2 ? o : null; },
  view: (s) => ({
    kind: "panel",
    panels: [0, 1].map((i) => ({
      seat: i,
      title: i === 0 ? "你的商铺" : "TA的商铺",
      lines: [`积分 ${myScore(s, i)} / 15`, `手持宝石 ${tokenLabel(s, i)}`, `名下卡片 ${ownedCount(s, i).map((n, g) => (n ? GEM_CN[g] + n : "")).filter(Boolean).join(" ") || "无"}`],
    })),
    notes: [`银行 ${s.bank.map((n, g) => GEM_CN[g] + n).join(" ")} · 桌面一级 ${s.cards[0].slice(0, 4).map((c) => `${GEM_CN[c.color]}${c.pts}${c.owner != null ? "(已购)" : ""}`).join(" ")}`, ...s.log.slice(-2)],
  }),
  acceptDraw: (s) => s.plies > 40,
  endLine: (s, name) => (s.winner === 0 ? `${name} 的宝石商人被你抢先做大了(15分)` : s.winner === 1 ? `${name} 在宝石商人里先你一步成了大亨` : "宝石商人还在盘货"),
};

export default spec;
