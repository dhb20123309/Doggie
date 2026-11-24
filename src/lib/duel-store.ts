// 双弈数据层：进行中棋局 + 角色战绩，localStorage key vp-phone:duel:*
import { usePersisted } from "./chat-store";
import type { XState, DuelGame } from "./duel-engine";
import { getGame, gameName } from "./games";

export interface DuelRecord {
  game: DuelGame;
  charId: string;
  /** 五子棋：15×15 扁平数组（0空/1黑玩家/2白AI）——旧结构兼容 */
  gomoku?: number[];
  /** 象棋状态快照——旧结构兼容 */
  xq?: XState;
  /** r=轮到玩家走 b=轮到AI走（象棋）；五子棋用 gomoku 棋盘上无法直接表达，存 turn */
  turn: "r" | "b";
  startedAt: number;
  moveCount: number;
  /** 多玩法扩展：gameId + 通用局面快照（新对局必写） */
  gameId?: string;
  state?: unknown;
}

export interface DuelStats {
  win: number;
  lose: number;
  draw: number;
  /** 当前连败（≥3 触发角色不服气句式） */
  streakLose: number;
  streakWin: number;
}

const EMPTY_STATS: Record<string, DuelStats> = {};

/** 按角色隔离的进行中棋局：vp-phone:duel-live:v1 → Record<charId, DuelRecord> */
export function useDuelLive() {
  return usePersisted<Record<string, DuelRecord>>("vp-phone:duel-live:v1", {});
}

/** 角色战绩：vp-phone:duel-stats:v1 → Record<charId, DuelStats> */
export function useDuelStats() {
  return usePersisted<Record<string, DuelStats>>("vp-phone:duel-stats:v1", EMPTY_STATS);
}

export function bumpStats(prev: Record<string, DuelStats>, charId: string, result: "win" | "lose" | "draw"): Record<string, DuelStats> {
  const s = prev[charId] ?? { win: 0, lose: 0, draw: 0, streakLose: 0, streakWin: 0 };
  const next: DuelStats = { ...s };
  if (result === "win") {
    next.win++;
    next.streakWin++;
    next.streakLose = 0;
  } else if (result === "lose") {
    next.lose++;
    next.streakLose++;
    next.streakWin = 0;
  } else {
    next.draw++;
  }
  console.log(`[duel] stats ${charId} ${result} W${next.win}/L${next.lose}/D${next.draw} streakLose=${next.streakLose}`);
  return { ...prev, [charId]: next };
}

/** 存储损坏防御：新结构走 spec.deserialize，旧结构保留原字段校验 */
export function isLiveValid(rec: unknown): rec is DuelRecord {
  if (!rec || typeof rec !== "object") return false;
  const r = rec as DuelRecord;
  if (r.gameId) {
    const spec = getGame(r.gameId);
    return !!spec && !!r.state && spec.deserialize(r.state) !== null;
  }
  if (r.game === "gomoku") return Array.isArray(r.gomoku) && r.gomoku.length === 225;
  if (r.game === "xiangqi") return !!r.xq && Array.isArray(r.xq.board) && r.xq.board.length === 10;
  return false;
}

/* ---------- 对局记忆（角色"记得一起玩过什么"） ---------- */

export interface DuelMemoryItem {
  game: DuelGame;
  /** win=玩家胜 / lose=玩家输 / draw=和棋 / ongoing=中途退出未下完 */
  result: "win" | "lose" | "draw" | "ongoing";
  at: number;
  /** 多玩法扩展：具体玩法 id（缺省按旧数据视为五子棋） */
  gameId?: string;
}

const MEM_KEY = "vp-phone:duel-memory:v1";
const MEM_MAX = 30;

type MemMap = Record<string, DuelMemoryItem[]>;

function loadMem(): MemMap {
  try {
    const raw = JSON.parse(localStorage.getItem(MEM_KEY) || "{}") as MemMap;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

/** 记一笔对局（终局或带局面退出时调用），每角色保留最近 30 条 */
export function recordDuel(charId: string, game: DuelGame, result: DuelMemoryItem["result"], gameId?: string) {
  const map = loadMem();
  const list = [...(map[charId] ?? []), { game, result, at: Date.now(), gameId }].slice(-MEM_MAX);
  localStorage.setItem(MEM_KEY, JSON.stringify({ ...map, [charId]: list }));
  console.log(`[duel] memory recorded char=${charId} ${gameId ?? game} ${result}`);
}

/** 同步读取（供 system prompt 现算，与 maskText 同模式） */
export function loadDuelMemory(charId: string): DuelMemoryItem[] {
  return loadMem()[charId] ?? [];
}

const RESULT_CN: Record<DuelMemoryItem["result"], string> = { win: "你输了", lose: "你赢了", draw: "和棋", ongoing: "中途退出，没下完" };
/** 记忆里的结果视角是"TA 的胜负"：recordDuel 传的是玩家视角，展示时反转 */
const nameOf = (i: DuelMemoryItem) => (i.gameId ? gameName(i.gameId) : i.game === "xiangqi" ? "中国象棋" : "五子棋");

/** 拼【棋局记忆】片段：统计 + 最近 6 局明细；无记录返回空串不占 token */
export function buildDuelMemorySection(charId: string): string {
  const list = loadDuelMemory(charId);
  if (!list.length) return "";
  const counter = new Map<string, number>();
  for (const i of list) {
    const n = nameOf(i);
    counter.set(n, (counter.get(n) ?? 0) + 1);
  }
  const parts = [...counter.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, c]) => `${n} ${c} 局`);
  const lines = list.slice(-6).map((i) => {
    const d = new Date(i.at);
    return `- ${d.getMonth() + 1}月${d.getDate()}日 ${nameOf(i)}：${RESULT_CN[i.result]}`;
  });
  return (
    `\n【棋局记忆】你和对方累计对弈过 ${list.length} 场（${parts.join("、")}）。最近几局：\n${lines.join("\n")}\n` +
    "（这些是你们真实一起玩过的对局。聊天时可以自然地提起——比如复盘某步棋、炫耀赢过的局、不服气要再来一局、约下次再玩；但严禁编造这里没有的对局结果，也不许每句话都提棋。）"
  );
}
