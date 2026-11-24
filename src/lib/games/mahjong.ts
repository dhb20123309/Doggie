// 麻将（简化单挑推倒胡）：只用万/条/筒三门 108 张，可碰可胡，4组+1将对。
import type { GameSpec, GAction, GView } from "./types";
import { shuffle, randInt } from "./types";

type S = { wall: string[]; hands: string[][]; melds: string[][][]; discards: string[][]; turn: number; claim: { tile: string; from: number } | null; over: boolean; winner: number; winTile: string; plies: number };

const SUITS = ["w", "t", "b"];
const SUIT_CN: Record<string, string> = { w: "万", t: "条", b: "筒" };
const NUM_CN = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
export function mjTileCn(t: string): string {
  const n = parseInt(t.slice(1));
  return `${NUM_CN[n]}${SUIT_CN[t[0]]}`;
}
function countMap(tiles: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tiles) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}
function canForm(counts: Map<string, number>, needPair: boolean): boolean {
  const keys = [...counts.keys()].filter((k) => counts.get(k)! > 0).sort();
  if (!keys.length) return !needPair;
  const k = keys[0], c = counts.get(k)!;
  if (needPair && c >= 2) {
    counts.set(k, c - 2);
    if (canForm(counts, false)) { counts.set(k, c); return true; }
    counts.set(k, c);
  }
  if (c >= 3) {
    counts.set(k, c - 3);
    if (canForm(counts, needPair)) { counts.set(k, c); return true; }
    counts.set(k, c);
  }
  const n = parseInt(k.slice(1));
  if (n <= 7) {
    const a = k, b = `${k[0]}${n + 1}`, c2 = `${k[0]}${n + 2}`;
    if ((counts.get(b) ?? 0) >= 1 && (counts.get(c2) ?? 0) >= 1) {
      counts.set(a, c - 1); counts.set(b, counts.get(b)! - 1); counts.set(c2, counts.get(c2)! - 1);
      if (canForm(counts, needPair)) { counts.set(a, counts.get(a)! + 1); counts.set(b, counts.get(b)! + 1); counts.set(c2, counts.get(c2)! + 1); return true; }
      counts.set(a, counts.get(a)! + 1); counts.set(b, counts.get(b)! + 1); counts.set(c2, counts.get(c2)! + 1);
    }
  }
  return false;
}
export function mjIsWin(hand: string[], meldCount: number): boolean {
  if (hand.length + meldCount * 3 !== 14) return false;
  if (canForm(countMap(hand), true)) return true;
  if (meldCount === 0 && hand.length === 14) {
    const cm = countMap(hand);
    if ([...cm.values()].every((v) => v === 2 || v === 4)) return [...cm.values()].reduce((a, b) => a + Math.min(b, 2), 0) === 14 ? true : [...cm.values()].every((v) => v === 2);
  }
  return false;
}

const spec: GameSpec<S> = {
  id: "mahjong",
  name: "麻将",
  category: "card",
  players: "2-4人",
  ruleSummary: "摸打碰胡，凑齐四个面子加一对将即胡",
  simplified: "本版本采用简化规则：两人局（你 vs TA），只用万条筒108张；可碰不可吃、无杠；自摸或对方点炮即胡，不计番种，平胡算赢；牌墙摸完为流局。",
  undoable: false,
  maxTurns: 120,
  create: (_seats, rng) => {
    const wall: string[] = [];
    for (const s of SUITS) for (let n = 1; n <= 9; n++) for (let k = 0; k < 4; k++) wall.push(`${s}${n}`);
    const d = shuffle(wall, rng);
    return { wall: d.slice(13), hands: [[...d.slice(0, 6)].sort(), [...d.slice(6, 13)].sort()], melds: [[], []], discards: [[], []], turn: 0, claim: null, over: false, winner: -1, winTile: "", plies: 0 };
  },
  turnOf: (s) => s.turn,
  legalActions: (s) => {
    if (s.over) return [];
    const acts: GAction[] = [];
    if (s.claim) {
      const me = 1 - s.claim.from, t = s.claim.tile, hand = s.hands[me];
      if (mjIsWin([...hand, t], s.melds[me].length)) acts.push({ kind: "hu", s: t, label: `胡 ${mjTileCn(t)}！` });
      if (hand.filter((x) => x === t).length >= 2) acts.push({ kind: "peng", s: t, label: `碰 ${mjTileCn(t)}` });
      acts.push({ kind: "passc", label: "过" });
      return acts;
    }
    let hand = s.hands[s.turn];
    if (hand.length % 3 === 2) {
      if (mjIsWin(hand, s.melds[s.turn].length)) acts.push({ kind: "hu", s: "self", label: "自摸胡！" });
      for (const t of [...new Set(hand)]) acts.push({ kind: "discard", s: t, label: `打 ${mjTileCn(t)}` });
      return acts;
    }
    // 需摸牌
    if (!s.wall.length) return [];
    return [{ kind: "draw", label: `摸牌（余${s.wall.length}）` }];
  },
  apply: (s, a) => {
    if (s.over) return null;
    let { wall, turn, over, winner, winTile, plies } = s;
    const hands = s.hands.map((h) => h.slice());
    const melds = s.melds.map((m) => m.slice());
    const discards = s.discards.map((d) => d.slice());
    let claim = s.claim;
    if (a.kind === "draw") {
      if (!wall.length || hands[turn].length % 3 === 2) return null;
      hands[turn] = [...hands[turn], wall[0]].sort();
      wall = wall.slice(1);
      return { ...s, hands, wall, melds, discards, turn, claim: null, over, winner, winTile, plies: plies + 1 };
    }
    if (a.kind === "hu") {
      if (a.s !== "self" && claim) hands[turn].push(claim.tile);
      return { ...s, hands, wall, melds, discards, turn, claim: null, over: true, winner: turn, winTile: a.s === "self" ? hands[turn][hands[turn].length - 1] : String(a.s), plies: plies + 1 };
    }
    if (claim) {
      const me = 1 - claim.from;
      if (a.kind === "peng") {
        let removed = 0;
        hands[me] = hands[me].filter((x) => !(x === claim!.tile && removed++ < 2));
        melds[me].push([claim.tile, claim.tile, claim.tile]);
        discards[claim.from].pop();
        return { ...s, hands, wall, melds, discards, turn: me, claim: null, over, winner, winTile, plies: plies + 1 };
      }
      // 过 → 原出牌方继续（其手牌已是 3n+2 待打状态）
      return { ...s, hands, wall, melds, discards, turn: claim.from, claim: null, over, winner, winTile, plies: plies + 1 };
    }
    if (a.kind === "discard" && a.s) {
      const idx = hands[turn].indexOf(a.s);
      if (idx < 0) return null;
      hands[turn].splice(idx, 1);
      discards[turn].push(a.s);
      const foe = 1 - turn;
      const canPeng = hands[foe].filter((x) => x === a.s).length >= 2;
      const canHu = mjIsWin([...hands[foe], a.s], melds[foe].length);
      if (canPeng || canHu) return { ...s, hands, wall, melds, discards, turn, claim: { tile: a.s, from: turn }, over, winner, winTile, plies: plies + 1 };
      if (!wall.length) return { ...s, hands, wall, melds, discards, turn: foe, claim: null, over: true, winner: -1, winTile, plies: plies + 1 };
      return { ...s, hands, wall, melds, discards, turn: foe, claim: null, over, winner, winTile, plies: plies + 1 };
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
    if (peng && Math.random() < 0.65) return peng;
    if (acts.some((a) => a.kind === "passc")) return acts.find((a) => a.kind === "passc")!;
    const draw = acts.find((a) => a.kind === "draw");
    if (draw) return draw;
    const ds = acts.filter((a) => a.kind === "discard");
    // 打孤张字感最弱牌：优先边张与单张
    const hand = s.hands[s.turn];
    const cm = countMap(hand);
    const scored = ds.map((d) => {
      const t = d.s!, n = parseInt(t.slice(1));
      let v = cm.get(t)! * 10;
      if ((cm.get(`${t[0]}${n - 1}`) ?? 0) > 0) v += 6;
      if ((cm.get(`${t[0]}${n + 1}`) ?? 0) > 0) v += 6;
      if (n === 1 || n === 9) v -= 2;
      return { d, v };
    });
    scored.sort((a, b) => a.v - b.v);
    return Math.random() < 0.85 ? scored[0].d : ds[randInt(Math.random, ds.length)];
  },
  serialize: (s) => s,
  deserialize: (d) => { const o = d as S; return o && Array.isArray(o.hands) && o.hands.length === 2 ? o : null; },
  view: (s) => ({
    kind: "cards",
    hands: s.hands.map((h, i) => ({ seat: i, cards: h.map((t, j) => ({ id: `${i}-${j}-${t}`, token: t[0], label: mjTileCn(t) })) })),
    tableCards: s.discards[1].slice(-10).map((t, j) => ({ id: `d-${j}-${t}`, token: t[0], label: mjTileCn(t) })),
    notes: [
      `牌墙 ${s.wall.length} 张 · 你：${s.melds[0].map((m) => m.map(mjTileCn).join("")).join("｜") || "门前清"}`,
      s.over ? (s.winner >= 0 ? `【${["你", "TA"][s.winner]}】胡 ${mjTileCn(s.winTile)}！` : "流局，牌墙摸完了") : s.claim ? `TA 打出 ${mjTileCn(s.claim.tile)}，轮到你了` : ["你的回合", "TA思考中…"][s.turn],
    ],
  }),
  acceptDraw: () => false,
  endLine: (s, name) => (s.winner === 0 ? `${name} 的麻将被你胡了个 ${mjTileCn(s.winTile)}` : s.winner === 1 ? `${name} 麻将点了你一把 ${mjTileCn(s.winTile)}` : "这圈麻将打到流局，谁也没胡"),
};

export default spec;
