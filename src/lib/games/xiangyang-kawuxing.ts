// 襄阳卡五星（简化）：只用条/筒两门共 68 张 + 中发白。碰牌为主，胡牌型=4组+对将 或 七对。支持 2-3 人轮流摸打。
import type { GameSpec, GAction, GView } from "./types";
import { shuffle, randInt } from "./types";

// 牌编码：1-9条=t1..t9，1-9筒=b1..b9，中=z1 发=z2 白=z3（字牌仅做刻子/对）
type S = { wall: string[]; hands: string[][]; melds: string[][][]; discards: string[][]; turn: number; phase: "draw" | "discard" | "claim"; claim: { tile: string; from: number } | null; over: boolean; winner: number; plies: number; seats: number };

function countMap(tiles: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tiles) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}
function canFormGroups(counts: Map<string, number>, needPair: boolean): boolean {
  const keys = [...counts.keys()].filter((k) => counts.get(k)! > 0).sort();
  if (!keys.length) return !needPair;
  const k = keys[0], c = counts.get(k)!;
  // 作将
  if (needPair && c >= 2) {
    counts.set(k, c - 2);
    if (canFormGroups(counts, false)) { counts.set(k, c); return true; }
    counts.set(k, c);
  }
  // 刻
  if (c >= 3) {
    counts.set(k, c - 3);
    if (canFormGroups(counts, needPair)) { counts.set(k, c); return true; }
    counts.set(k, c);
  }
  // 顺（仅数牌，同花色数字连续；t/b 前缀一致）
  if (k[0] !== "z") {
    const num = parseInt(k.slice(1));
    const a = `${k[0]}${num}`, b = `${k[0]}${num + 1}`, c2 = `${k[0]}${num + 2}`;
    if (num <= 7 && (counts.get(a) ?? 0) >= 1 && (counts.get(b) ?? 0) >= 1 && (counts.get(c2) ?? 0) >= 1) {
      counts.set(a, counts.get(a)! - 1); counts.set(b, counts.get(b)! - 1); counts.set(c2, counts.get(c2)! - 1);
      if (canFormGroups(counts, needPair)) { counts.set(a, counts.get(a)! + 1); counts.set(b, counts.get(b)! + 1); counts.set(c2, counts.get(c2)! + 1); return true; }
      counts.set(a, counts.get(a)! + 1); counts.set(b, counts.get(b)! + 1); counts.set(c2, counts.get(c2)! + 1);
    }
  }
  return false;
}
function isWin(hand: string[], meldCount: number): boolean {
  const cnt = countMap(hand);
  const total = hand.length + meldCount * 3;
  if (total !== 14) return false;
  if (canFormGroups(new Map(cnt), true)) return true;
  // 七对
  if (meldCount === 0 && hand.length === 14 && [...cnt.values()].every((v) => v === 2)) return true;
  return false;
}
const TILE_CN: Record<string, string> = {};
for (let i = 1; i <= 9; i++) { TILE_CN[`t${i}`] = `${i}条`; TILE_CN[`b${i}`] = `${i}筒`; }
TILE_CN["z1"] = "中"; TILE_CN["z2"] = "发"; TILE_CN["z3"] = "白";
const tileCn = (t: string) => TILE_CN[t] ?? t;
const seatName = (seat: number) => (seat === 0 ? "你" : seat === 1 ? "TA" : `小机 ${seat - 1}`);

const spec: GameSpec<S> = {
  id: "xiangyang-kawuxing",
  name: "襄阳卡五星",
  category: "card",
  players: "2-3人",
  ruleSummary: "条筒两门加字牌，碰牌凑四组一将对胡，七对也算",
  simplified: "本版本采用简化规则：只可碰不可吃；「五星」（中）按普通字牌处理；多人时出牌后其他家依次可碰/胡；自摸或对方打出你听的牌即胡，无番数结算，胡了就赢。",
  undoable: false,
  maxTurns: 140,
  minSeats: 2,
  maxSeats: 3,
  create: (seatsRaw, rng) => {
    const seats = Math.max(2, Math.min(3, Math.floor(seatsRaw || 2)));
    const wall: string[] = [];
    for (let i = 1; i <= 9; i++) for (let k = 0; k < 4; k++) { wall.push(`t${i}`); wall.push(`b${i}`); }
    for (const z of ["z1", "z2", "z3"]) for (let k = 0; k < 4; k++) wall.push(z);
    const d = shuffle(wall, rng);
    // seat0 庄 7 张，其余各 6 张（靠摸牌推进到 14 判胡）
    const hands = Array.from({ length: seats }, (_, i) => (i === 0 ? [...d.slice(0, 7)].sort() : [...d.slice(1 + (i - 1) * 6, 1 + (i - 1) * 6 + 6)].sort()));
    return { wall: d.slice(6 * seats + 1), hands, melds: Array.from({ length: seats }, () => [] as string[][]), discards: Array.from({ length: seats }, () => [] as string[]), turn: 0, phase: "draw", claim: null, over: false, winner: -1, plies: 0, seats };
  },
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over) return [];
    const acts: GAction[] = [];
    if (s.phase === "claim" && s.claim) {
      const me = s.turn;
      const t = s.claim.tile;
      const hand = s.hands[me];
      if (isWin([...hand, t], s.melds[me].length)) acts.push({ kind: "hu", s: t, label: `胡 ${tileCn(t)}！` });
      if (hand.filter((x) => x === t).length >= 2) acts.push({ kind: "peng", s: t, label: `碰 ${tileCn(t)}` });
      acts.push({ kind: "passc", label: "过" });
      return acts;
    }
    const hand = s.hands[s.turn];
    if (s.phase === "draw" && hand.length % 3 === 2 && isWin(hand, s.melds[s.turn].length)) acts.unshift({ kind: "hu", s: "self", label: "自摸胡！" });
    if (s.phase === "draw" && hand.length % 3 === 1 && s.wall.length) acts.push({ kind: "draw", label: `摸牌（余${s.wall.length}）` });
    if (s.phase === "discard" || (s.phase === "draw" && hand.length % 3 === 2)) {
      for (const t of [...new Set(hand)]) acts.push({ kind: "discard", s: t, label: `打 ${tileCn(t)}` });
    }
    return acts;
  },
  apply: (s, a) => {
    if (s.over) return null;
    let wall = s.wall, turn = s.turn, phase = s.phase, claim = s.claim, over: boolean = s.over, winner = s.winner, plies = s.plies;
    const hands = s.hands.map((h) => h.slice());
    const melds = s.melds.map((m) => m.slice());
    const discards = s.discards.map((d) => d.slice());
    if (a.kind === "draw") {
      if (!wall.length || hands[turn].length % 3 !== 1) return null;
      hands[turn] = [...hands[turn], wall[0]].sort();
      wall = wall.slice(1);
      return { ...s, hands, wall, melds, discards, turn, phase: "discard", claim: null, over, winner, plies: plies + 1 };
    }
    if (a.kind === "hu") {
      over = true; winner = turn;
      if (a.s !== "self" && claim) hands[turn].push(claim.tile);
      return { ...s, hands, wall, melds, discards, turn, phase: "claim", claim: null, over, winner, plies: plies + 1 };
    }
    if (phase === "claim" && claim) {
      const me = turn;
      if (a.kind === "peng") {
        let removed = 0;
        hands[me] = hands[me].filter((x) => !(x === claim!.tile && removed++ < 2));
        melds[me].push([claim.tile, claim.tile, claim.tile]);
        discards[claim.from].pop();
        return { ...s, hands, wall, melds, discards, turn: me, phase: "discard", claim: null, over, winner, plies: plies + 1 };
      }
      // 过 → 依次问下一家；都没有则原出牌方下家摸牌
      const nextClaimer = (me + 1) % s.seats;
      if (nextClaimer !== claim.from) {
        const t = claim.tile;
        const nh = hands[nextClaimer];
        if (isWin([...nh, t], melds[nextClaimer].length) || nh.filter((x) => x === t).length >= 2) {
          return { ...s, hands, wall, melds, discards, turn: nextClaimer, phase: "claim", claim, over, winner, plies: plies + 1 };
        }
      }
      return { ...s, hands, wall, melds, discards, turn: (claim.from + 1) % s.seats, phase: "draw", claim: null, over, winner, plies: plies + 1 };
    }
    if (a.kind === "discard" && a.s) {
      const idx = hands[turn].indexOf(a.s);
      if (idx < 0) return null;
      hands[turn].splice(idx, 1);
      discards[turn].push(a.s);
      // 从下家起依次找可碰/胡的第一家
      for (let k = 1; k < s.seats; k++) {
        const foe = (turn + k) % s.seats;
        const canPeng = hands[foe].filter((x) => x === a.s).length >= 2;
        const canHu = isWin([...hands[foe], a.s], melds[foe].length);
        if (canPeng || canHu) return { ...s, hands, wall, melds, discards, turn: foe, phase: "claim", claim: { tile: a.s, from: turn }, over, winner, plies: plies + 1 };
      }
      if (!wall.length) return { ...s, hands, wall, melds, discards, turn: (turn + 1) % s.seats, phase: "draw", claim: null, over: true, winner: -1, plies: plies + 1 };
      return { ...s, hands, wall, melds, discards, turn: (turn + 1) % s.seats, phase: "draw", claim: null, over, winner, plies: plies + 1 };
    }
    return null;
  },
  status: (s) => (s.over ? "over" : "playing"),
  resultFor: (s, seat) => (s.winner === -1 ? "draw" : s.winner === seat ? "win" : "lose"),
  aiMove: (s) => {
    const acts = spec.legalActions(s);
    if (!acts.length) return null;
    const hu = acts.find((a) => a.kind === "hu");
    if (hu) return hu;
    const peng = acts.find((a) => a.kind === "peng");
    if (peng && Math.random() < 0.7) return peng;
    if (acts.some((a) => a.kind === "passc")) return acts.find((a) => a.kind === "passc")!;
    const draw = acts.find((a) => a.kind === "draw");
    if (draw) return draw;
    const discards = acts.filter((a) => a.kind === "discard");
    if (!discards.length) return null;
    // 优先打字牌孤张
    const zi = discards.find((a) => a.s?.startsWith("z"));
    if (zi && Math.random() < 0.6) return zi;
    return discards[randInt(Math.random, discards.length)];
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.hands) && o.hands.length >= 2 && o.hands.length === (o.seats ?? o.hands.length) ? o : null; },
  view: (s) => ({
    kind: "cards",
    hands: s.hands.map((h, i) => ({ seat: i, cards: h.map((t, j) => ({ id: `${i}-${j}-${t}`, token: t[0], label: tileCn(t) })) })),
    tableCards: s.discards.flatMap((ds, i) => ds.slice(-4).map((t, j) => ({ id: `d-${i}-${j}-${t}`, token: t[0], label: `${seatName(i)[0]}${tileCn(t)}` }))),
    hiddenCount: {},
    notes: [`余牌 ${s.wall.length} · ${s.seats}人局 · 你的碰：${s.melds[0].map((m) => m.map(tileCn).join("")).join(" | ") || "无"} · ${s.over ? (s.winner >= 0 ? `【${seatName(s.winner)}】胡牌！` : "流局") : s.phase === "claim" ? `${seatName(s.claim!.from)} 打出 ${tileCn(s.claim!.tile)}，请决定` : `${seatName(s.turn)}的回合`}`],
  }),
  acceptDraw: () => false,
  endLine: (s, name) => (s.winner === 0 ? `${name} 的卡五星被你胡了` : s.winner === 1 ? `${name} 卡五星一把胡了你` : s.winner > 1 ? "小机抢下了这局卡五星" : "卡五星打到了流局"),
};

export default spec;
