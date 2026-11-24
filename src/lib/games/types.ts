// 双弈游戏中心：所有玩法实现同一契约，UI 与持久化只认 GameSpec，不再按 game id 写分支。
// 约定：座位 seat 从 0 起，seat 0 恒为人类玩家；其余为角色/NPC。

export type GameCategory = "board" | "card" | "dice" | "table";

/** 对局结果（相对某个座位）；ongoing 供未终局的比分类玩法使用 */
export type SeatResult = "win" | "lose" | "draw" | "ongoing";

/** 局面状态：playing 或终局 */
export type GameStatus = "playing" | "over";

/** 可执行动作：kind 由具体玩法定义，payload 携带坐标/牌等；UI 用 label 渲染 */
export interface GAction {
  kind: string;
  /** 棋类：落子/移动坐标；其他玩法自定义 */
  from?: { r: number; c: number };
  to?: { r: number; c: number };
  /** 通用参数（牌 id、叫价数字等） */
  n?: number;
  s?: string;
  /** 驱动按钮文案 */
  label?: string;
}

/** 渲染描述：UI 层据此画棋盘/手牌/骰子，不感知规则 */
export interface GView {
  kind: "grid" | "cards" | "dice" | "panel";
  /** grid：行列与交叉点样式 */
  rows?: number;
  cols?: number;
  lineStyle?: "square" | "cross";
  cells?: { r: number; c: number; token: string; label?: string; sel?: boolean; hint?: boolean }[];
  /** cards：手牌与牌河 */
  hands?: { seat: number; cards: { id: string; token: string; label: string; sub?: string }[] }[];
  tableCards?: { id: string; token: string; label: string }[];
  hiddenCount?: Record<number, number>;
  /** dice：当前点数 */
  dice?: number[];
  diceCup?: string;
  /** panel：桌游数值面板 */
  panels?: { seat: number; title: string; lines: string[] }[];
  /** 任意玩法附加说明行 */
  notes?: string[];
}

/** 每个玩法的实现契约 */
export interface GameSpec<S = any> {
  id: string;
  name: string;
  category: GameCategory;
  /** 展示用人数文案 */
  players: string;
  ruleSummary: string;
  /** 第3档简化规则公示；有则规则卡显示 */
  simplified?: string;
  /** 是否支持悔棋（牌类多为 false） */
  undoable: boolean;
  /** 最大回合数兜底，超限判和 */
  maxTurns: number;
  /** 可变人数玩法：座位范围（缺省视为固定 2 人，UI 不出人数配置） */
  minSeats?: number;
  maxSeats?: number;
  /** 创建初始局面；seats=参与座位数，seedRng=随机函数（可复现） */
  create(seats: number, rng: () => number): S;
  turnOf(s: S): number;
  legalActions(s: S): GAction[];
  apply(s: S, a: GAction): S | null;
  status(s: S): GameStatus;
  /** 终局后各座位结果 */
  resultFor(s: S, seat: number): SeatResult;
  aiMove(s: S): GAction | null;
  serialize(s: S): unknown;
  deserialize(d: unknown): S | null;
  view(s: S, selected: GAction | null, hints: GAction[]): GView;
  /** 提和时 AI 是否接受：默认看局势，返回 true 接受 */
  acceptDraw?(s: S): boolean;
  /** 一句话终局播报（相对玩家），供聊天灰字 */
  endLine(s: S, name: string): string;
}

/** 确定性随机（mulberry32），序列化时可存 seed 以便续局一致 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randInt = (rng: () => number, n: number) => Math.floor(rng() * n);

/** Fisher–Yates 原地洗牌 */
export function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** 通用兜底：AI 拿不到合法动作时的跳过动作 */
export const PASS: GAction = { kind: "pass", label: "不出" };
