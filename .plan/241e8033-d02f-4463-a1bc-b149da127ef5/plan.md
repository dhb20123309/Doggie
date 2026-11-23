# 需求文档

## 一、概述

新增「建群」功能：用户可把多个角色拉进群聊，在群里同时与她们对话、推进剧情；每个角色在群里说的话、你说的话都会同步进该角色的私聊记忆——群里聊过的事，回到私聊她记得；私聊里发生的事，群里她也知道。

## 二、现状分析（Explore 结论）

### 受影响文件全清单

| 文件绝对路径 | 现状与关联点 |
|---|---|
| `/home/project/src/components/RoleChatApp.tsx` | L2301-2398 ConversationList 仅枚举 characters[]；L905-1170 requestReply/settleReply 硬编码单 charId；L1397-1494 fireOne 主动消息调度（20s interval、跳过 storyMode）；L2498-2572 AssistantRow 固定单头像；L177-193 进入会话 log 对齐 effect |
| `/home/project/src/lib/chat-store.ts` | L203 usePersisted；L253 useChatLog(charId)→vp-phone:rolechat-log:{charId}；L287 readLastEntry；L263 clearChatLog |
| `/home/project/src/lib/chat-types.ts` | ChatEntry{id,role,content,at,...} 无发送者标识；Character 含 storyMode/blocked/alias |
| `/home/project/src/lib/types.ts` | ScreenId 联合类型（无 groupchat，本方案不新增 screen，复用 rolechat 内 view） |
| `/home/project/src/lib/companion-store.ts` | L200-296 Theater SCRIPTS 静态多人剧本——仅作多人轮次编排文案参照，不复用其数据 |
| `/home/project/src/components/PhoneShell.tsx` | 路由分发保持不动（群聊在 RoleChatApp 内部视图，不加新 ScreenId） |

### 关键机制确认

- 记忆存储天然互通的前提：所有会话都是 `ChatEntry[]`，人设注入走 `buildSys(ch)`，模型请求历史走 `toHist(entries)`。
- 转账/定位/外卖/MCP 标记消化、OOC 过滤、复读检测、流式输出都在 requestReply 主链路内，群聊复用同一链路即可继承全部能力。
- 通知横幅 emitNotify 按 charId 定位会话，群聊消息需带群 id 直达。

## 三、方案设计

### 核心决策：独立群 log + 私聊双写镜像（记忆双向同步）

- **群聊记录**存 `vp-phone:groupchat-log:{groupId}`（GroupEntry = ChatEntry + senderId），群界面只读这份，干净可控。
- **记忆同步（群→私）**：群里每条消息落库的同时，向每位成员的私聊 log 追加一条"镜像条目"——assistant 消息以该角色第一人称原样写入她的私聊（她说过什么自己记得）；user 消息写成 `[群聊] 你在「群名」说：…` 前缀条目；其他角色的话写成 `[群聊] ${名字}说：…` 第三人称旁白条目。私聊 toHist 现有 fmt 原样带出这些文本，模型自然理解那是共同经历。
- **记忆同步（私→群）**：喂群聊模型时，除群历史外，为每个在场角色额外拼接其私聊最近 N 条摘要（`【你和对方最近的私聊】`锚点），保证群里也能接住私聊话题。零迁移、零破坏：私聊 log 结构不变，只是多了几条可读的镜像消息。
- **备选对比**：曾考虑"群聊直接合并读取各成员私聊 log 展示"——被否，因为会出现同一句话重复渲染、无法表达"谁对谁说的"场景，且清空私聊会连带毁群史。

### 发言人编排（剧情发展引擎）

- 每轮由你（用户）发消息触发：系统按"点名优先，否则自动轮换"选 1~2 位在场角色依次回复。
- **@点名**：输入含某成员名字（displayName/alias 匹配）则该角色必回；无人被点名时按 least-recently-spoken 轮换。
- **角色互聊**：每次回复后小概率（约 35%）追加"另一位成员接话"一轮——system 里给接话者【当前情境】+对方刚说的话，制造哥哥弟弟争宠、互相拆台这类剧情推进。
- 每人回复都走完整既有链路：buildSys(该角色)+群专属协议 GROUP_PROTOCOL（多人场景文体：第三人称叙述可选、禁止替别人说话、可引用群内公开信息）→ digest 序列（转账/定位/外卖/MCP/表情/OOC/复读）→ settleGroupReply。
- 群内也支持剧情模式开关（整群叙事体，一次一段而非碎句）。

### UI 与入口

- **会话列表混排**：ConversationList 行数据改为 `characters ∪ groups` 统一按最后消息时间排序；群条目显示多头像堆叠（前3个成员 Avatar 错位叠加）+ 群名 + 预览"[群名] 周晨砚：…"；未读角标沿用 chat-read:v1 水位（key 用 groupId）。
- **建群流程**：列表顶栏加「+ 建群」按钮 → 弹层：群名输入（默认"和 XX、XX 的小群"）+ 成员多选（checkbox 卡片，已拉黑角色置灰不可选）→ 创建即进群，首条系统提示"你创建了群聊「…」"。
- **群聊天页**：复用 chat 视图骨架——顶栏返回+群名+成员头像横排（点开成员速览）；消息行 assistant 显示各自头像+名字（小字灰色）；输入栏保留图片/转账/定位/表情按钮（转账需先选收款人，简化为首个被 @ 成员或弹出选择）。
- **群管理**：顶栏菜单：改名、添加/移除成员、解散群（清群 log，镜像条目保留在私聊）。
- **主动消息兼容**：fireOne 保持只针对私聊角色；群聊不做不请自来（避免多人群刷屏），后续可迭代。

## 四、实现步骤

1. **数据层** `src/lib/group-chat-store.ts`（新建）：GroupChat{id,name,memberIds,createdAt,storyMode?}；useGroups()（vp-phone:groups:v1）；useGroupLog(groupId)（复用 usePersisted）；appendGroupEntry + mirrorToMembers(groupId, entry)（双写镜像，防重入标记 mirroredFrom）；readGroupLast(groupId) 供列表排序。
2. **契约扩展** `src/lib/chat-types.ts`：ChatEntry 加 `senderId?: string`、`groupTip?: boolean`（系统提示行）、`mirroredFrom?: string`（镜像来源群 id，幂等去重）。
3. **群聊视图** `src/components/GroupChatView.tsx`（新建，紧耦合子组件同文件内联）：群消息渲染（头像+名字行、镜像无关）、发送→pickSpeakers→逐人 requestGroupReply（复用 ai-api chatCompletion/chatStream 与 worldbook/meme 注入）、digest 精简版（转账/定位/MCP 标记保留，钱包收款人=发言者）、建群弹层与群管理弹层。
4. **接线** `RoleChatApp.tsx`：view 增加 "group"（携带 activeGroupId state）；ConversationList 混排群条目与建群按钮；unreadCount 扩展支持 group key；emitNotify 群消息 tag:"群聊"。
5. **私聊侧承接记忆**：`chat-store.ts` readLastEntry 无需改；`RoleChatApp` 私聊 toHist fmt 对 `[群聊]` 前缀镜像条目正常输出文本即可（零改动验证）；镜像条目渲染为普通气泡但带小字"来自群聊「…」"角标（entry.mirroredFrom 存在时）。
6. **样式**：styles.css 复用 glass/bubble-cream/msg-time，多头像堆叠用 -ml-2 z-index 错位，fade-up 入场。

## 五、涉及文件清单

| 文件 | 类型 |
|---|---|
| `/home/project/src/lib/group-chat-store.ts` | 新建（群数据层+镜像双写） |
| `/home/project/src/components/GroupChatView.tsx` | 新建（群聊天页+建群/群管理弹层，内联子组件） |
| `/home/project/src/lib/chat-types.ts` | 修改（senderId/groupTip/mirroredFrom） |
| `/home/project/src/components/RoleChatApp.tsx` | 修改（view="group" 分支、ConversationList 混排、建群入口、私聊镜像角标渲染） |
| `/home/project/src/styles.css` | 微调（头像堆叠辅助类，如需） |

## 六、验收标准

1. 会话列表点「+ 建群」→ 勾选周晨砚、周风砚 → 创建成功进入群聊，列表出现双头像堆叠的群条目。
2. 群里发"你们俩谁先去洗澡"→ 两位角色按性格先后接话、互相拆台，@周风砚 则他必回；开启群剧情后变为一段叙事推进。
3. 回到周晨砚私聊，能看到群里她说过的话（第一人称）和你说的话（[群聊] 前缀），且她回复时会主动提及群里刚发生的事（如"你刚才在群里还说我…"）；反过来在私聊说过的事，群里她也能自然提起。
4. 群里发的转账卡片收款人是被 @/发言的角色，钱包流水正确记到该 charId；MCP 标记照常执行并留执行记录。
5. 移除成员/解散群：群 log 处理正确，私聊镜像不删；旧存档（无 groups key）首次打开不报错。
6. build + tsc 零错误，dev 预览截图验收列表混排与群聊界面。

## 七、风险评估

| 风险 | 缓解 |
|---|---|
| 镜像双写导致私聊 log 膨胀/循环复制 | mirroredFrom 幂等标记：同一群同一 entry id 只镜像一次；镜像条目自身不再二次镜像 |
| 多角色轮流回复 token 翻倍 | 每轮最多 2 人次回复；私聊摘要注入限最近 6 条且截断 |
| 模型替他人说话/串人格 | GROUP_PROTOCOL 明令"只扮演你自己，不许代写他人台词"；接话轮单独请求天然隔离 |
| 清空私聊记录误删群记忆 | 群 log 独立存储，clearChatLog 不动群；解散群反向亦然 |
| 会话列表排序逻辑回归 | 混排仅在 rows 构造处合并，点击分流 onSelectChar/onSelectGroup 两条独立路径 |