// 牌类游戏公共层：牌编码、比大小、组合拆解，供斗地主/21点/炸金花/德州/UNO 等复用。

/** 扑克牌编码：rank(3..20) + suit(0黑桃1红心2梅花3方块)。52张；rank 1=小王 2=大王 */
export type Card = number; // rank*4+suit 形式不便读，用字符串更稳
export interface PCard { id: string; rank: number; suit: number } // rank: 3-14(A),15=2,16小王,17大王（斗地主序）

export const SUIT_CHAR = ["♠", "♥", "♣", "♦"];
export function rankLabel(r: number): string {
  if (r === 16) return "小";
  if (r === 17) return "王";
  if (r === 15) return "2";
  if (r === 14) return "A";
  if (r === 13) return "K";
  if (r === 12) return "Q";
  if (r === 11) return "J";
  return String(r);
}
export function cardLabel(c: PCard): string {
  if (c.rank >= 16) return c.rank === 16 ? "🃏小" : "🃏大";
  return SUIT_CHAR[c.suit] + rankLabel(c.rank);
}
export function makeDeck(withJokers: boolean): PCard[] {
  const out: PCard[] = [];
  let n = 0;
  for (let r = 3; r <= 15; r++) for (let s = 0; s < 4; s++) out.push({ id: `c${n++}`, rank: r, suit: s });
  if (withJokers) { out.push({ id: `c${n++}`, rank: 16, suit: 0 }); out.push({ id: `c${n++}`, rank: 17, suit: 1 }); }
  return out;
}
/** 标准 52 张（2..A），用于 21 点/德州/拉密 */
export function makeStandard(): PCard[] {
  const out: PCard[] = [];
  let n = 0;
  for (let r = 2; r <= 14; r++) for (let s = 0; s < 4; s++) out.push({ id: `s${n++}`, rank: r, suit: s });
  return out;
}

/* ---------- 组合判定（斗地主向） ---------- */
export type ComboKind = "single" | "pair" | "triple" | "triple1" | "triple2" | "straight" | "pairStraight" | "bomb" | "rocket" | "quad2" | "invalid";
export interface Combo { kind: ComboKind; main: number; len: number; cards?: PCard[]; typeName?: string }

const cnt = (cards: PCard[]) => { const m = new Map<number, number>(); for (const c of cards) m.set(c.rank, (m.get(c.rank) ?? 0) + 1); return m; };

export function comboOf(cards: PCard[]): Combo {
  const n = cards.length;
  if (!n) return { kind: "invalid", main: 0, len: 0 };
  const m = cnt(cards);
  const ranks = [...m.keys()].sort((a, b) => a - b);
  const vals = [...m.values()];
  const max = Math.max(...ranks.filter((r) => r <= 15));
  if (n === 1) return { kind: "single", main: ranks[0], len: 1 };
  if (n === 2) {
    if (ranks[0] === 16 && ranks[1] === 17) return { kind: "rocket", main: 99, len: 2 };
    if (ranks[0] === ranks[1]) return { kind: "pair", main: ranks[0], len: 2 };
    return { kind: "invalid", main: 0, len: 0 };
  }
  if (vals.every((v) => v === 4)) return { kind: "bomb", main: ranks[0], len: 4 };
  if (n === 3 && vals[0] === 3) return { kind: "triple", main: ranks[0], len: 3 };
  if (n === 4 && m.has(4) === false) {
    const t = ranks.find((r) => m.get(r) === 3);
    if (t) return { kind: "triple1", main: t, len: 4 };
  }
  if (n === 5) {
    const t = ranks.find((r) => m.get(r) === 3);
    const p = ranks.find((r) => m.get(r) === 2);
    if (t && p) return { kind: "triple2", main: t, len: 5 };
  }
  if (n >= 5 && !ranks.includes(15) && !ranks.includes(16) && !ranks.includes(17) && vals.every((v) => v === 1) && ranks[ranks.length - 1] - ranks[0] === n - 1) {
    return { kind: "straight", main: ranks[ranks.length - 1], len: n };
  }
  if (n >= 6 && n % 2 === 0 && !ranks.includes(15) && !ranks.includes(16) && !ranks.includes(17) && vals.every((v) => v === 2) && ranks[ranks.length - 1] - ranks[0] === ranks.length - 1) {
    return { kind: "pairStraight", main: ranks[ranks.length - 1], len: n / 2 };
  }
  if (n === 6) {
    const q = ranks.find((r) => m.get(r) === 4);
    if (q) return { kind: "quad2", main: q, len: 6 };
  }
  void max;
  return { kind: "invalid", main: 0, len: 0 };
}
/** a 能否压过 b（同型更大或炸弹/火箭）；level 为级牌点数（掼蛋用），普通玩法不传 */
export function beats(a: Combo, b: Combo, level?: number): boolean {
  void level;
  if (a.kind === "invalid") return false;
  if (b.kind === "invalid") return true;
  if (a.kind === "rocket") return true;
  if (b.kind === "rocket") return false;
  if (a.kind === "bomb" && b.kind !== "bomb") return true;
  if (b.kind === "bomb" && a.kind !== "bomb") return false;
  if (a.kind === "bomb" && b.kind === "bomb") return a.main > b.main;
  return a.kind === b.kind && a.len === b.len && a.main > b.main;
}

/* ---------- 21点点数 ---------- */
export function bjValue(cards: PCard[]): number {
  let v = 0, aces = 0;
  for (const c of cards) {
    if (c.rank === 14) { aces++; v += 11; }
    else if (c.rank >= 10) v += 10;
    else v += c.rank;
  }
  while (v > 21 && aces--) v -= 10;
  return v;
}

/* ---------- 德克萨斯牌型评分 ---------- */
export function holdemScore(cards: PCard[]): { rank: number; tie: number[] } {
  const m = cnt(cards);
  const byRank = [...m.entries()].sort((a, b) => b[0] - a[0]);
  const groups = byRank.map(([r, c]) => ({ r, c })).sort((a, b) => b.c - a.c || b.r - a.r);
  const suits = new Set(cards.map((c) => c.suit));
  const rs = [...new Set(cards.map((c) => c.rank))].sort((a, b) => a - b);
  let flush = false, straightHigh = 0;
  for (const s of [0, 1, 2, 3]) {
    const sc = [...new Set(cards.filter((c) => c.suit === s).map((c) => c.rank))].sort((a, b) => a - b);
    if (sc.length >= 5) { flush = true; const st = longestRun(sc); if (st > straightHigh) straightHigh = st; }
  }
  const isStr = straightHigh >= 5;
  const allRs = [...new Set(cards.map((c) => c.rank))].sort((a, b) => b - a);
  const runHigh = longestRun(rs.slice().sort((a, b) => a - b));
  void allRs; void isStr; void runHigh;
  if (flush && straightHigh >= 5) return { rank: 8, tie: [straightHigh] };
  if (groups[0]?.c === 4) return { rank: 7, tie: [groups[0].r, groups[1]?.r ?? 0] };
  if (groups[0]?.c === 3 && groups[1]?.c === 2) return { rank: 6, tie: [groups[0].r, groups[1].r] };
  if (flush) return { rank: 5, tie: cards.filter((c) => c.suit === [...suits].find((s) => cards.filter((c) => c.suit === s).length >= 5)).map((c) => c.rank).sort((a, b) => b - a).slice(0, 5) };
  if (straightHigh >= 5) return { rank: 4, tie: [straightHigh] };
  if (groups[0]?.c === 3) return { rank: 3, tie: [groups[0].r, ...byRank.filter(([r]) => r !== groups[0].r).map(([r]) => r).slice(0, 2)] };
  if (groups[0]?.c === 2 && groups[1]?.c === 2) return { rank: 2, tie: [Math.max(groups[0].r, groups[1].r), Math.min(groups[0].r, groups[1].r), groups[2]?.r ?? 0] };
  if (groups[0]?.c === 2) return { rank: 1, tie: [groups[0].r, ...byRank.filter(([r]) => r !== groups[0].r).map(([r]) => r).slice(0, 3)] };
  return { rank: 0, tie: byRank.map(([r]) => r).slice(0, 5) };
}
function longestRun(sortedAsc: number[]): number {
  let best = 1, cur = 1;
  for (let i = 1; i < sortedAsc.length; i++) { if (sortedAsc[i] === sortedAsc[i - 1] + 1) { cur++; best = Math.max(best, cur); } else if (sortedAsc[i] !== sortedAsc[i - 1]) cur = 1; }
  if (sortedAsc.includes(14) && sortedAsc.includes(2) && sortedAsc.includes(3) && sortedAsc.includes(4) && sortedAsc.includes(5)) best = Math.max(best, 5);
  return best;
}
