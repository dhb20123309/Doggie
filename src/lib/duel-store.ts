// 双弈数据层：进行中棋局 + 角色战绩，localStorage key vp-phone:duel:*
import { usePersisted } from "./chat-store";
import type { GomokuBoard, XState, DuelGame } from "./duel-engine";

export interface DuelRecord {
  game: DuelGame;
  charId: string;
  /** 五子棋：15×15 扁平数组（0空/1黑玩家/2白AI） */
  gomoku?: number[];
  /** 象棋状态快照 */
  xq?: XState;
  /** r=轮到玩家走 b=轮到AI走（象棋）；五子棋用 gomoku 棋盘上无法直接表达，存 turn */
  turn: "r" | "b";
  startedAt: number;
  moveCount: number;
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

/** 存储损坏防御：字段缺失视为无局可续 */
export function isLiveValid(rec: unknown): rec is DuelRecord {
  if (!rec || typeof rec !== "object") return false;
  const r = rec as DuelRecord;
  if (r.game === "gomoku") return Array.isArray(r.gomoku) && r.gomoku.length === 225;
  if (r.game === "xiangqi") return !!r.xq && Array.isArray(r.xq.board) && r.xq.board.length === 10;
  return false;
}
