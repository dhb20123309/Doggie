# 需求文档

## 1. 应用概述
在现有「虚拟手机恋爱模拟器」里，把只支持五子棋/中国象棋的「双弈」升级为一个**完整的游戏中心 App**：收录约 35 款可玩对局（棋类 / 牌类 / 骰子 / 桌游四类），并在手机桌面建立独立 App 图标，点图标直接进入游戏大厅开新局，不再依赖聊天页工具箱。对手仍然是你养的角色（AI 会下棋、会记得战绩、会在聊天里主动提起一起玩过的对局）。

## 2. 用户与使用场景
- **目标用户**：在手机壳界面里和 AI 恋人日常聊天的用户。
- **核心场景**：
  1. 桌面点「双弈」图标 → 进大厅 → 选棋种分类 → 选对手角色 → 开新局；
  2. 下完一局直接「再来一局」或换一种玩法；
  3. 中途退出，下次进来这盘棋还在（续局）；
  4. 回到聊天页跟 TA 说"刚才那步棋你走错了"，TA 记得你们下过什么；
  5. 从聊天页左下角工具箱快捷进入（保留旧入口）。

## 3. 页面结构与功能说明

```
手机桌面（屏1 App 网格）
└─ 新增「双弈」App 图标 ──→ 双弈 · 游戏中心（全屏 App）
                             ├─ 顶部：返回 + 标题 + 累计场次
                             ├─ 分类标签栏：全部 / 棋类 / 牌类 / 骰子 / 桌游
                             ├─ 游戏卡片网格（每卡：名称 + 人数 + 规则一句话 + 「有续局」徽章）
                             ├─ 选中游戏 → 对手选择（角色列表 + 头像 + 该角色战绩）
                             ├─ 对局页（按玩法分四种交互形态，见下）
                             └─ 我的战绩（各游戏胜/负/平 + 总场次）
聊天页工具箱
└─ 「下棋 · 双弈」按钮（保留，直达双弈并预选当前角色）
```

### 四种对局形态（决定 UI 与引擎写法）
| 形态 | 交互 | 收录玩法 |
|---|---|---|
| A 纯策略棋盘 | 点格子/棋子落子，悔棋限 3 次、认输、提和 | 井字棋、四子连珠、黑白棋、国际象棋、西洋跳棋、五子棋、中国象棋、翻翻棋、斗兽棋、军棋、围棋 |
| B 手牌出牌 | 底部扇形手牌、点选打出、要不起/不出、摸牌 | 斗地主、UNO、干瞪眼、四色牌、开火车、炸金花、德州扑克、21点、拉密、卡卡颂、宝石商人、掼蛋、襄阳卡五星、麻将、大富翁、大富翁·改、飞行棋、中国跳棋 |
| C 骰子 | 摇骰动画 + 叫价/开盅面板 | 吹牛骰子、快艇骰子 |
| D 回合制经营/掷骰推进 | 状态面板 + 阶段按钮 | 大富翁系列、卡卡颂、宝石商人（B/D 共用一套轮流通用层） |

### 通用对局页要素（所有玩法一致）
- 顶栏：返回（未终局则记为"中途退出"）、对手头像+名、本局玩法名、重开按钮
- 状态条：轮到谁 / 被将军等提示 / 结果文案
- 主区：对应形态的棋盘或手牌区
- 底栏：悔棋(剩余次数) / 提和 / 认输（牌类骰子类改为 不出·要不起·弃牌）
- 终局弹层：胜负 + 一句角色口吻评语 + 「回聊天」「再来一局」
- AI 思考时显示"TA 正在想…"占位（沿用现有 700~2000ms 拟真延迟）

## 4. 业务规则与逻辑

### 4.1 游戏清单与实现深度（关键取舍）
按"规则可实现复杂度"分三档，**全部做成真的能下完、能分出胜负**，不搞假按钮：

- **第 1 档 完整规则 + 本地 AI（11 款）**：井字棋、五子棋、中国象棋（已有）、黑白棋、四子连珠、国际象棋、西洋跳棋、斗兽棋、翻翻棋、军棋（明棋简化版）、围棋（13 路 + 气/禁自杀 + 贴目数子判定，不做打劫长循环判定的严格规则）
- **第 2 档 完整流程 + 启发式 AI（16 款）**：斗地主、UNO、干瞪眼、四色牌、开火车、炸金花、21 点、德州扑克、拉密、襄阳卡五星、掼蛋、麻将（三人/四人基础胡牌判定：碰碰胡/顺子刻子/将牌，不含吃碰杠全变例时用简化牌河）、卡卡颂、宝石商人、大富翁、大富翁·改、飞行棋、中国跳棋中的核心项
- **第 3 档 简化规则但可玩到底（其余）**：凡官方规则含大量地方变体或需要长程规划的（如麻将番种、大富翁地产交易谈判、卡卡颂地图拼接全规则），采用**明确公示的简化规则**：进入该玩法时在规则卡上写清"本版本采用简化规则：……"，保证玩家知情且对局能正常结束。

> 说明：40 款里有若干重复/近似项（掼蛋出现两次、大富翁与大富翁·改、吹牛骰子与快艇骰子），实现时合并同类引擎、参数化差异，避免代码翻倍。

### 4.2 统一引擎契约（重构核心）
所有玩法实现同一个接口，UI 与持久化只认这个接口，不再写 `if (game === "gomoku")` 分支：

```ts
interface GameSpec {
  id: string;              // "gomoku" | "doudizhu" | ...
  name: string;            // "五子棋"
  category: "board" | "card" | "dice" | "table";
  players: string;         // "2人" / "2-6人"（展示用）
  ruleSummary: string;     // 卡片上一句话规则
  simplified?: string;     // 第3档必填：本版本简化规则说明
  create(opts): GameState; // 初始局面（含随机种子，可复现）
  turnOf(state): Seat;     // 当前行动座位
  legalActions(state): Action[];      // 当前可执行动作（驱动 UI 高亮）
  apply(state, action): GameState;    // 执行动作，非法动作返回 null
  status(state): "playing" | Result;  // 终局判定
  resultFor(state, seat): "win"|"lose"|"draw";
  aiMove(state, level): Action | null;// 本地 AI（不联网）
  serialize(state) / deserialize(data)
  undoable(state): boolean;           // 是否支持悔棋（牌类多数不支持，UI 自动禁用）
}
```
- 现有 `duel-engine.ts` 的五子棋/象棋函数保留原样，只是外面包一层 `GameSpec` 适配器，不动已验证过的规则代码。
- 每个新玩法一个独立文件 `src/lib/games/<id>.ts` 导出自己的 spec，注册表 `src/lib/games/index.ts` 汇总成 `GAME_SPECS`——加一款游戏 = 加一个文件 + 注册一行。

### 4.3 座位与 NPC 补位
- 座位 1 = 玩家（人类）；座位 2 = 所选角色；多人玩法（3~6 人）空位由**同一角色的分身或预置小机**补齐，界面上标注"NPC"，与截图里的席位卡样式一致（席位号 + 金币 + 身份）。
- 金币筹码：沿用已有钱包体系（`wallet-store`）做展示性记分，不新增真实扣款；牌类/桌游的"底注 X"仅作为计分倍率显示。

### 4.4 记忆与战绩（延续上一轮已上线的能力并扩展）
- `vp-phone:duel-memory:v1` 记录结构扩展为 `{ gameId, gameName, result, at }`，`result` 增加 `"ongoing"`（已有）；每角色上限 30 局不变。
- `buildDuelMemorySection` 统计改为按玩法分组列出（最多列 4 种玩法 + 最近 6 局明细），注入私聊与剧情两条链路的 system（已接好，只需让新玩法也调用 `recordDuel`）。
- 战绩 `vp-phone:duel-stats:v1` 改为 `charId → { perGame: Record<gameId, Stats>, total... }`，读取时对旧结构（只有 win/lose/draw 顶层字段）做兼容回落，不清空历史数据。
- 终局仍向会话写一条居中灰字（`blockedTip`，不进模型上下文，靠记忆层保证 TA 真记得）。

### 4.5 入口调整
- 桌面：`HomeCarousel` 的 App 网格新增「双弈」图标（渐变底 + lucide `Swords` 图标，与饿了么/表情包/语音通话同一种 EXTRA 按钮写法，无需生成图片素材），点击 `onOpen("duel")`。
- 聊天工具箱「下棋 · 双弈」按钮**保留**，行为升级为携带当前角色直达大厅。

## 5. 异常与边界情况
| 场景 | 处理方式 |
|---|---|
| 老存档里 `duel-live` 是旧格式（只有 gomoku/xiangqi 字段） | `isLiveValid` 逐玩法委托给各自 `spec.deserialize`，解析失败即视为无续局、静默丢弃并打日志，不白屏 |
| 某玩法 AI 算不出合法动作（死局/极端牌型） | 强制走"跳过/弃牌/认输"兜底动作，绝不让回合卡在 AI 侧 |
| 牌类洗牌后玩家一方必然无法结束（如发牌导致死循环） | 每个玩法设最大回合数上限，超限判和并提示"超时判和" |
| 悔棋不可用的玩法 | 按钮置灰 + 长按提示"这局棋类不支持悔棋哦" |
| 角色被拉黑 / 角色不存在 | 大厅对手列表过滤 blocked；已进入的对局若角色被删，显示"对手已不在"并允许以 NPC 继续 |
| 用户在 AI 思考中切后台/返回 | 定时器清理，返回时按存储局面恢复，不重复落子 |
| 同一玩法连续多局 | 每局独立 `startedAt`，记忆条目按局追加，不去重 |
| 窄屏（真手机 H5）40 张卡片 | 分类标签 + 3 列网格 + 纵向滚动，卡片文字两行截断 |

## 6. 验收标准
1. 桌面能看到「双弈」图标，点进去是游戏大厅，不需要经过设置或聊天工具箱。
2. 大厅有 全部/棋类/牌类/骰子/桌游 四个分类，切换后卡片列表正确变化，总数与清单一致（约 35 款去重后）。
3. 任选一款棋类（如黑白棋）：能选对手 → 开局 → 双方轮流落子 → 合法着法有高亮 → 下完弹出胜负 → 聊天页出现一条居中灰字对局结果。
4. 任选一款牌类（如斗地主）：能看到手牌、点选打牌、AI 会跟牌或不出、牌局能正常打到有人出完牌并结算。
5. 任选一款骰子（吹牛骰子）：能摇骰、叫价、开盅并判定胜负。
6. 中途点返回退出，重新进入大厅时该玩法卡片带「有续局」徽章，点进去局面与退出前一致。
7. 悔棋：棋类可悔且次数递减到 0 后禁用；牌类按钮为禁用态。
8. 提和：AI 明显优势时拒绝并出一句挑衅话，均势时接受判和。
9. 战绩页显示各玩法胜/负/平与总场次；刷新页面后不丢失。
10. 下完棋后在聊天里问 TA"我们下过什么"，回复能提到具体玩法与胜负（体现记忆生效）。
11. 第 3 档玩法的规则卡上能看到"本版本采用简化规则"说明文字。
12. 手机竖屏与桌面宽屏两种尺寸下大厅、对局页均无横向溢出、无遮挡。
13. `pnpm run build` 与类型检查零错误，预览无白屏。

## 7. 本期不实现功能
- 真人联机对战 / 房间码 / 邀请链接（截图里的"邀请联机""加入联机房间""本局筹码""观战席"属于外部 CedarDuet 服务，本项目为纯前端单机，本期不做）。
- 需要云端仲裁的反作弊、跨设备同步对局。
- LLM 实时决策玩法（全部用本地算法，保证离线可用、不额外消耗额度）。
- 麻将完整番种体系、大富翁自由地产交易谈判、卡卡颂全地图规则、围棋打劫严格判定等专业深度规则。
- 段位/排行榜/成就系统。
- 音效与震动反馈。

## 8. 影响面与调用链

```
桌面 HomeCarousel(APPS/EXTRA 按钮) ──onOpen("duel")──┐
聊天 RoleChatApp 工具箱 ToolboxMenu ─onOpenDuel──────┤
                                                     ▼
                              PhoneShell(screen==="duel") ──→ DuelApp(大厅)
                                     │                          │
                                     │                          ├─ src/lib/games/index.ts (GAME_SPECS 注册表)
                                     │                          ├─ src/lib/games/*.ts (各玩法 GameSpec)
                                     │                          └─ duel-engine.ts (五子棋/象棋原语，保留)
                                     │                                   │
                                     ├─ onFinish → duelFinish ──────────┤
                                     │        写 vp-phone:rolechat-log:{charId} 居中灰字
                                     │                                   │
                                     └─ 记忆/战绩 duel-store ◄── recordDuel/bumpStats
                                                │
                                                └─ buildDuelMemorySection → RoleChatApp.buildSys
                                                   （私聊 + 剧情两条链路 system 注入【棋局记忆】）
```

## 9. 涉及文件定位
**新增**
- `src/lib/games/types.ts`：GameSpec / GameState / Action / Seat / Result 契约
- `src/lib/games/index.ts`：GAME_SPECS 注册表 + 分类元数据
- `src/lib/games/tic-tac-toe.ts`、`reversi.ts`、`connect-four.ts`、`chess-intl.ts`、`checkers.ts`、`junqi.ts`、`dou-shou-qi.ts`、`memory-chess.ts`、`go.ts`（棋类各一文件）
- `src/lib/games/doudizhu.ts`、`uno.ts`、`gan-deng-yan.ts`、`four-color.ts`、`kai-huo-che.ts`、`zha-jin-hua.ts`、`blackjack.ts`、`texas-holdem.ts`、`rummy.ts`、`guandan.ts`、`xiangyang-kawuxing.ts`、`mahjong.ts`（牌类）
- `src/lib/games/lia-ma.ts`（骰子：吹牛骰子 + 快艇骰子参数化）
- `src/lib/games/monopoly.ts`、`monopoly-plus.ts`、`ludo.ts`、`jump-checker.ts`、`carcassonne.ts`、`splendor.ts`（桌游）
- `src/components/games/GameHall.tsx`：分类标签 + 卡片网格 + 对手选择
- `src/components/games/GameStage.tsx`：通用对局外壳（顶栏/状态条/AI 调度/悔棋提和认输/终局弹层，只依赖 GameSpec）
- `src/components/games/BoardView.tsx`：通用棋盘渲染（网格 + 交叉线两种栅格模式，复用现有 Gomoku/Xiangqi 画法）
- `src/components/games/CardView.tsx`：通用手牌/牌河/出牌区
- `src/components/games/DiceView.tsx`：骰子与叫价面板
- `src/components/games/TablePanelView.tsx`：桌游状态面板（金钱/地产/分数轨）
- `src/components/games/GameRulesSheet.tsx`：规则卡（含简化规则声明）

**修改**
- `src/lib/duel-engine.ts`：保留原语，导出供适配器调用（不改规则逻辑）
- `src/lib/duel-store.ts`：DuelRecord 增 `gameId`、记忆条目按玩法、stats 结构升级 + 旧数据兼容、isLiveValid 委托 spec
- `src/components/DuelApp.tsx`：改为薄壳（路由到大厅/对局），删除 `game === "gomoku"` 硬编码分支（现约 17 处）
- `src/components/HomeCarousel.tsx`：App 网格新增「双弈」图标按钮
- `src/components/ProfileSheet.tsx`：ToolboxMenu 按钮文案改「双弈 · 游戏中心」，回调带上当前角色
- `src/components/RoleChatApp.tsx`：`onOpenDuel` 传 charId；buildSys 记忆片段自动包含新玩法
- `src/components/PhoneShell.tsx`：duel 路由参数化（可带 gameId/charId 直达某局）、duelFinish 文案改用玩法名
- `src/lib/types.ts`：ScreenId 无需新增（沿用 "duel"）

## 10. 回归与兼容风险
| 风险点 | 是否破坏现有行为 | 兼容策略 | 需回归的点 |
|---|---|---|---|
| DuelRecord/stats 存储结构升级 | 可能读不到旧值 | 读取时字段缺失即回落默认，不 wipe；保留 v1 key 名 | 旧续局能否打开、旧战绩是否还在 |
| 移除 DuelApp 内 17 处 game 分支 | 五子棋/象棋行为可能被改动 | 两玩法走原语适配器，规则函数一字不动 | 五子棋连五判定、象棋蹩马腿/炮翻山/送将过滤、悔棋、提和 |
| 单文件体积膨胀（40 款挤一起） | 否 | 一玩法一文件 + 注册表，符合 ~260 行规范 | 构建产物体积、首屏加载 |
| 记忆注入 token 增长 | 否 | 仍只列最近 6 局 + 最多 4 种玩法统计 | 聊天回复成本与速度 |
| 桌面网格新增图标致换行 | 轻微视觉变化 | 沿用现有 4/5 列自适应网格 | 桌面屏1 布局不错位 |
| 简化规则引发"这不是我认识的玩法"争议 | 否 | 规则卡显式公示简化条款 | 规则文案可读性 |
| 围棋/麻将等重型规则实现不完备导致死局 | 否 | 最大回合数 + 强制兜底动作 | 长局能否正常结束 |

## 11. 测试与验证方式
- 每个 GameSpec 一份 node/tsx 冒烟：`create → 反复 aiMove/legalActions 遍历 → apply → status` 直到终局，断言 ①AI 动作恒合法 ②必能在上限回合内结束 ③序列化往返一致 ④resultFor 三方一致。
- 棋类补充规则用例（黑白棋翻转数、国际象棋易位与兵升变、斗兽棋象克鼠例外、围棋气尽提子）。
- 双门禁：`npx tsc --noEmit` + `pnpm run build`，再 `pnpm run dev` 重启预览。
- 截图验收：大厅（含分类切换）、一款棋类对局、一款牌类对局、骰子对局、终局弹层，以及聊天里问"我们下过什么"的记忆生效验证。
- 交付后重导 Git bundle，供本地同步发布到 GitHub Pages。
