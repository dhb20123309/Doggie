# 需求文档

## 1. 问题陈述
当前游戏大厅的 31 款玩法全部按「你 + 1 个角色」双人对局运行：对局壳 GameStage 硬编码 `create(2, ...)`，界面只传单个对手名。用户希望：
- **多人游戏**（斗地主、麻将、UNO 等本身支持多人的玩法）可以选择添加多个角色当对手，或直接使用默认 AI（人机位）；
- **不固定人数的小游戏**（炸金花、德州、大富翁、宝石商人等标注 2-N 人的玩法）支持自定义人数。

## 2. 现状分析（Explore 测绘结论）
关键文件与现状：
- `/home/project/src/lib/games/types.ts`：GameSpec 契约里 `create(seats: number, rng)` **本来就接收座位数参数**，但绝大多数引擎忽略它、内部写死 2 人；`doudizhu.ts`（L61-71，写死 3 人含 NPC）、`uno.ts`（L19，写死 3 人）、`xiangyang-kawuxing.ts`（写死 3 人）是仅有的多人实现参照。
- `/home/project/src/components/games/GameStage.tsx`：L36/L155 硬编码 `spec.create(2, ...)`；AI 调度 L60-74 只区分 seat0/非seat0（天然可推广到多 AI 座）；终局 L162 只看 `resultFor(state, 0)`；顶栏与 CardView 只传单个 `charName`。
- `/home/project/src/components/games/GameViews.tsx`：CardView L58-59 只取 seat0/seat1 两个手牌区，需改为渲染全部对手手牌。
- `/home/project/src/components/DuelApp.tsx`：`pickChar` 单角色 state → GameHall/GameStage；战绩/进行中局/记忆均按 `live[charId]`、`stats[charId]`、`recordDuel(charId,...)` 单键存储。
- `/home/project/src/lib/duel-store.ts`：DuelRecord/统计结构以主角色 charId 为键。
- `/home/project/tmp/smoke-games.cjs`：L19 `spec.create(2, Math.random)`，冒烟需增加多座位用例。

## 3. 方案（含备选取舍）
**选定方案：契约加 `seats` 能力声明 + 大厅开局前人数配置弹层 + 引擎按 seats 泛化。**
- 备选 A「只做 UI 假多人」被否：局面里没有真座位，规则（如斗地主发牌、麻将摸牌圈）无法成立。
- 备选 B「所有 31 款全支持任意人数」被否：棋类（五子/象棋/围棋等）数学上只有两席，强行开放会产生非法局面。
- 因此按玩法分三类处理：
  1. **固定 2 人棋类**（井字/五子/黑白/四连/国际象/西洋跳/军棋/斗兽/翻翻/围棋/中国象棋/飞行棋对冲版等棋盘类）：保持现状，不出人数选择。
  2. **声明了可变人数的玩法**（players 文案形如 "2-6人"/"2-4人"/"3人"）：引擎 create 真正按 `seats` 生成对应座位（手牌数组、玩家状态数组、轮转取模全部参数化），大厅开局前提供人数步进器（在 spec 允许范围内调节）。涉及：斗地主(3)、卡五星(3)、UNO(2-6)、炸金花(2-6)、德州(2-6)、干瞪眼(2-4)、四色牌(2-4)、拉密(2-5)、开火车(2-6)、掼蛋/麻将(2-4，麻将从简化单挑扩到可选 3-4 人)、大富翁(2-6)/大富翁·改(2-4)、宝石商人(2-4)、卡卡颂(2-5)、跳棋(2-6)、快艇骰(2-4)。
  3. **庄家制特殊玩法**（21点=玩家 vs 庄家、吹牛骰）：21 点保持单桌不改人数；吹牛骰按 seats 扩成多人叫骰。

- **对手席位分配规则**：seat 0 = 你；seat 1..k = 依次选中的角色（可 0~N 个）；剩余座位自动补「小机 N 号」默认 AI 人机位。即"添加多个人机或直接使用默认 AI"都满足：只选 1 个角色+人数>2 时其余全是人机；一个角色都不选也可以纯人机陪坐（此时仍必须有至少 1 个座位给 AI）。
- **UI 链路改造**：
  - GameHall：点「开局」不再直接进对局，而是弹出开局配置卡——人数步进器（仅 `minSeats/maxSeats` 存在时显示）+ 角色多选 chips（上限 seats-1）+「开始对局」。固定 2 人玩法保持一点即开。
  - GameStage：props 从 `charName: string` 改为 `opponents: { seat: number; name: string }[]` + `seats: number`；AI 调度按当前 turn 查 opponents 决定思考延迟文案（"XX 思考中…" / "小机 2 思考中…"）；CardView/PanelView 渲染全部对手行；终局播报按每个对手分别记胜负。
  - types.ts：GameSpec 增加可选成员 `minSeats?: number; maxSeats?: number;`（缺省视为固定 2 人）。
- **数据层兼容**：进行中局仍存 `live[主角色Id]`（未选角色时存 `"ai"` 键），state 内已含全部座位信息可直接续局；战绩对局结束后**为每个参与的角色席位分别 recordDuel/bumpStats**（人机位不记战绩不写聊天记忆）；聊天感想 `onFinish` 只对真实角色触发（第一参 charId 逐个回调）。

## 4. 实施步骤
1. `src/lib/games/types.ts`：GameSpec 加 `minSeats?/maxSeats?` 可选字段。
2. 逐引擎泛化（约 18 个文件，均在 `src/lib/games/`）：create 用 seats 参数建数组、轮转 `(turn+1)%seats`、resultFor 按名次/存活判定各座位、view 输出全部 hands/panels、aiMove 对"当前座位"给动作（现有 aiMove 已是该模式，多数只需把写死的 2/3 换成 s.seats 并存档位）。每改一个跑对应冒烟。
3. `GameHall.tsx`：新增 OpponentPicker 开局配置弹层（人数步进 + 角色多选 + 人机位预览），`onStart(spec, seats, charIds)` 签名升级。
4. `GameStage.tsx`：seats/opponents props、多 AI 串行调度（同一 effect 按当前 turn 走 aiMove，间隔 700ms）、终局逐座 resultFor、顶栏当前思考者名字。
5. `GameViews.tsx`：CardView 循环渲染 seat≥1 全部对手手牌（折叠样式防挤爆）；PanelView 已有 seat 数组天然兼容。
6. `DuelApp.tsx`：持有 seats/charIds 选择态；exit 时对每个真实角色 recordDuel+bumpStats+onFinish；live 续局键=首个角色 id 或 "ai"。
7. `tmp/smoke-games.cjs`：对声明 minSeats 的引擎追加 `create(maxSeats)` 与 `create(minSeats)` 两组冒烟。
8. 双门禁 + dev + 截图验收（大厅配置弹层、3 人斗地主、4 人大富翁至少两张）。
9. bundle 重导 + AGENTS.md 增量。

## 5. 涉及文件清单
- 修改：`src/lib/games/types.ts`、`src/components/games/GameHall.tsx`、`src/components/games/GameStage.tsx`、`src/components/games/GameViews.tsx`、`src/components/DuelApp.tsx`、`src/lib/duel-store.ts`（键说明注释与 ai 伪键兼容）、`tmp/smoke-games.cjs`
- 引擎泛化（约 18 个）：`src/lib/games/doudizhu.ts`、`uno.ts`、`xiangyang-kawuxing.ts`、`mahjong.ts`、`guandan.ts`、`zha-jin-hua.ts`、`texas-holdem.ts`、`gan-deng-yan.ts`、`four-color.ts`、`rummy.ts`、`kai-huo-che.ts`、`bluff-dice.ts`、`yacht-dice.ts`、`monopoly.ts`、`monopoly-plus.ts`、`splendor.ts`、`carcassonne.ts`、`jump-checker.ts`、`ludo.ts`
- 不动：固定 2 人棋类引擎、blackjack（庄家制单桌维持）、聊天/AI 协议层

## 6. 验收标准
- 大厅点开斗地主出现「3 人」配置：可选 1-2 个角色，空位显示"小机"，开局后三三家手牌正确、叫地主/出牌轮转正常。
- UNO/炸金花/大富翁等出现人数步进器，范围与卡片文案一致；4 人大富翁四个玩家位置、资金、回合都独立。
- 麻将可从 2 人扩到 3-4 人且摸打吃碰轮转正确。
- 对局结束：每个参与角色各自记战绩、各自在聊天里收到对局感想；纯人机局不产生角色消息。
- 退出续局：多人局中途退出后再进大厅能原样恢复（含全部座位）。
- 冒烟脚本 31 款全绿且多座位用例通过；tsc/build 零错误。

## 7. 风险评估
- **引擎改动面大**：18 个引擎逐一泛化最易引入回归，靠冒烟多座位用例兜底；个别复杂规则（麻将吃碰、掼蛋晋级）若多座扩展成本过高，退级为"公示简化：该玩法保持 X 人"并在规则卡注明，如实披露。
- **旧存档兼容**：进行中局 state 无 seats 字段时 deserialize 兜底补 seats=2/3。
- **UI 拥挤**：6 人手牌在 360px 屏会挤，采用对手区横向滚动+张数徽章折叠。