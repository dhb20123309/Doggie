# 需求文档

## 一、概述

修复与增强三件事：

1. **进会话默认停在最新消息**：点进对话界面时消息列表应自动滚到底部（上一次聊到的地方），不需要用户手动往下滑。
2. **世界书植入核实与可视化**：确认世界书内容确实拼进了发给 API 模型的 system prompt，并解释"为什么感觉没体现"，同时把注入情况变得可见可验证。
3. **多选一键删除**：世界书管理工具条在「改为全局/改为局部」旁新增「删除选中」，带二次确认。

## 二、现状分析（Explore + 定点阅读结论）

### 问题①：进入会话不滚动

- `src/components/RoleChatApp.tsx` L870-873：`scrollBottom()` 用 `requestAnimationFrame` + `scrollTo({ behavior: "smooth" })`。
- 全文 11 处 `scrollBottom()` 调用（L384/578/637/702/739/1001/1029/1155/1232/1245/1273/1292）全部发生在**发消息/落库/加载剧情**等动作里；**没有任何一处是"进入会话（view 切到 chat / activeId 切换 / log 从 localStorage 恢复完成）时"触发的**。这就是每次点进会话都停在中上部、要手动下滑的直接根因。
- 加重因素：开场白档案卡（OpenerCard）默认展开撑高内容、图片气泡懒加载后高度变化，即使有滚动也需等内容稳定后二次校正；smooth 行为在容器高度未定时会被截断。

### 问题②：世界书是否真的喂给了模型

链路逐环核实（结论：**代码上确实植入了**）：

1. `src/components/RoleChatApp.tsx` L807-809 `buildSys`：`getActiveWorldBooks(ch.id, books, ch.boundWorldBookIds ?? [])` → `buildWorldSectionV2(activeBooks, recentText, unlocked)` 得 `worldText`。
2. L828（剧情分支）与 L855（私聊分支）均把 `worldText` 拼进 system 字符串。
3. L895 requestReply：`sysPrompt = buildSys(...)`；L960 私聊 messages[0] = `{ role:"system", content: sysPrompt + transferCtx + richCtx + mcpCtx }`；剧情分支同样含 worldText。fireOne 主动消息 L1341 `buildSys(ch, false, ...)` 走私聊分支也含。→ **发送请求体第一句 system 里就有【世界设定】段**。
4. `src/lib/worldbook.ts` L30-31：`scope==="global"` 全角色生效；`local` 必须角色设定页勾选绑定（`boundWorldBookIds`）。
5. L116-118 深度分层：`depth=0` 常驻全文；**`depth=1`（默认值）只有触发词命中最近消息才输出全文**（L115 子串或 ≥2 字公共片段匹配）；`depth=2` 只进目录、AI 申请 `[查设定:名]` 才展开。

**"植入没体现"的三个真实原因**（非 bug，是机制+可见性问题）：
- a) 导入条目默认 `depth=1`（触发式），聊天里没出现触发词就永远不进 system——用户以为注入了其实没有；
- b) `local` 条目没在角色设定页绑定该角色，直接被过滤掉；
- c) 协议明令"不要复述或提及这是设定"，模型遵守后用户看不到任何痕迹，无从验证。

现有佐证日志：`[worldbook] section resident=x triggered=y unlocked=z catalog=n`（worldbook.ts L136）与 `[reply] start … sysLen=`（RoleChatApp L987），但界面上不可见。

### 问题③：多选工具栏现状

- `src/components/WorldBookApp.tsx` L56-57：`managing` + `sel: Set<string>`；L76-80 `applyScope(scope)` 批量改 scope 并清空选择；L163-199 工具条 JSX（全选/改为全局/改为局部/清空选择）。
- 单条删除已有模式：L59-62 `save({ ...wb, __del: true })` → `prev.filter(b => b.id !== wb.id)`。
- 项目已有 `@/components/ui/alert-dialog.tsx` 可作二次确认。

## 三、方案设计

### ① 进入会话自动滚到底

RoleChatApp 新增 effect：依赖 `[view, active?.id]`，当 `view === "chat"` 时用**瞬时滚动**（behavior:"auto"，避免 smooth 被内容增长截断）滚到底，并在 300ms 后（开场白卡/图片渲染完成后）再校正一次；打日志 `[chat] enter scroll bottom char=… len=…`。为不影响流式输出的连续滚动体验，仅"进入会话"这一时机用瞬时定位。

实现细节：
- 复用 listRef；effect 内 `requestAnimationFrame(() => listRef.current?.scrollTo({ top: scrollHeight }))` + `setTimeout(300)` 二次校正（cleanup 清 timer）。
- 若 log 尚未从存储恢复完（usePersisted 同步读取，首帧即有数据），无需额外等待。

### ② 世界书注入可视化 + 降低"未命中"困惑

- **诊断日志增强**（worldbook.ts buildWorldSectionV2）：现有日志追加未触发条目名单与各自关键词，形如 `[worldbook] miss=<名字(关键词)>…`，控制台可直接核对为何某条没进 system。
- **角色编辑页提示保持现状**（已有说明文案），不改交互。
- **可选优化（纳入本次）**：ImportPanel 导入档位文案已含深度说明，不动。
- 回复用户疑问的结论会写进交付总结：世界书确实已接入 API（system 第一段），"没体现"多为 depth=1 未命中触发词或 local 未绑定。

### ③ 多选一键删除

WorldBookApp：
- 新增 `deleteSelected()`：仿 applyScope，`setBooks(prev => prev.filter(b => !sel.has(b.id)))`，日志 `[worldbook] batch delete count=N`，清空 sel。
- 工具条在「改为局部」后加 rose 色「删除」按钮（Trash2 图标，disabled={!sel.size}）。
- 点击先弹 AlertDialog 确认（标题"删除选中的 N 条世界书？"，说明"删除后不再注入模型，不可恢复"，取消/删除两键）；确认后执行。

## 四、涉及文件清单

| 文件绝对路径 | 改动 |
|---|---|
| `/home/project/src/components/RoleChatApp.tsx` | 新增进入会话滚动 effect（view/activeId 变化时瞬时滚底 + 300ms 校正，带 [chat] enter scroll 日志） |
| `/home/project/src/lib/worldbook.ts` | buildWorldSectionV2 日志追加 miss 明细（未命中的触发式条目名+关键词） |
| `/home/project/src/components/WorldBookApp.tsx` | 工具条加「删除」按钮 + AlertDialog 二次确认 + deleteSelected()（[worldbook] batch delete 日志） |

## 五、验收标准

1. 从会话列表/桌面点进一个已有大量历史的对话，界面直接停在最底部最新消息处，无需手动下滑；来回切换两个会话均正确。
2. 打开浏览器控制台发一条消息，能看到 `[worldbook] section resident/triggered/...` 与 `[reply] start … sysLen=`；把某 local 条目绑定角色并把某条目设为常驻后，sysLen 明显增大、miss 日志列出未命中条目——证明注入链路真实有效。
3. 世界书页进入管理模式→勾选若干条目→点「删除」→弹确认框→确认后条目消失且刷新后不复现；取消则不删；全选删除也可用。
4. `pnpm run build` + `npx tsc --noEmit` 零错误，dev 预览正常。

## 六、风险与兼容

- 进入会话瞬时滚动不影响消息流内的 smooth 滚动体验（只在 view/charId 切换时机触发）。
- 删除为不可恢复操作，故强制 AlertDialog 确认；不影响热梗世界书（预置 300 条独立存储，不在本列表）。
- 世界书机制本身零改动（scope/depth/触发逻辑原样保留），只加日志与 UI，不会改变现有 AI 行为。