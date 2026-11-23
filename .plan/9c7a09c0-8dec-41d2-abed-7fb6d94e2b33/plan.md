# 需求文档

## 1. 改动目标
新增一个对标截图的「Reality MCP · 手机能力」设置页：9 项手机能力开关卡片（标题 + 说明 + 权限标签 + Switch），并让角色在聊天中真实调用这些能力。用户核心诉求是**手机端打开网页时能力尽量真实可用**。

## 2. 现状 vs 目标
- **现状**：项目没有任何 `navigator.*` API 使用；已有应用内横幅通知（notification-store）、TTS 通道（tts.ts，仅聊天页朗读按钮用）；设置页只有接口/密码/壁纸等区块，没有系统能力开关中心；AI 完全感知不到设备。
- **目标**：设置 → 连接区下方出现「MCP 手机能力」入口卡 → 进入独立全屏页，9 个能力开关持久化保存；开启的能力即时生效（震动、系统通知、语音播报、提醒写入日历等走真实浏览器 API），角色回复时能主动使用这些能力并在聊天里留下"执行记录"；不支持的能力明确灰显标注原因，不假装可用。

## 3. 真机可行性结论（逐能力，基于 Explore 回执 + 浏览器 API 事实）
| # | 能力 | 权限标签 | 手机端真实实现 | 平台限制与降级 |
|---|------|---------|----------------|---------------|
| 1 | 读取手机状态 | 只读查询 | ✅ 全平台可用：`navigator.userAgentData`（设备/平台）、`navigator.connection`（网络类型）、`navigator.storage.estimate()`（存储占用）、`navigator.onLine`、屏幕尺寸、语言、深色模式 | iOS Safari 无 userAgentData → 回落 UA 字符串解析；电量 Battery API iOS 不支持 → 显示"本机不支持读取电量" |
| 2 | 发送手机通知 | 会执行操作 | ✅ Android Chrome / iOS 主屏启动模式：`Notification.requestPermission()` + `new Notification(...)` | iOS Safari 标签页内不支持系统通知 → 自动降级为已有的应用内横幅（PhoneShell notify-banner），卡片上标注"iOS 将以内置横幅代替" |
| 3 | 震动手持 | 会执行操作 | ✅ Android：`navigator.vibrate(ms)`（轻微20/标准60/强烈200 三档） | iOS Safari 不支持 vibrate → 降级为机身视觉抖动动画（复用 styles.css shake-x）+ 可选提示音 |
| 4 | 对用户说话 | 会执行操作 | ✅ 复用 tts.ts synthesizeSpeech（已配网关则外部 TTS，否则回落 `speechSynthesis` 浏览器原生朗读，中文 voice 自动选择） | 两处都不可用时提示去设置配置语音 |
| 5 | 设置提醒 | 会执行操作 | ✅ 写 Web Cal 订阅格式 .ics 文件（含 VALARM），调起系统"添加到日历"——Android Chrome 与 iOS Safari 均支持下载打开 | 无法静默写入，必须用户点一下确认；页面文案如实说明 |
| 6 | 查看提醒 | 只读查询 | ⚠️ 浏览器沙箱读不回系统日历 → 展示"本应用创建过的提醒清单"（localStorage 记录 + 未到期倒计时），标注"第三方备忘录记录读不到" | 与截图描述一致（截图原文也声明第三方备忘录读不到） |
| 7 | 读取最近通知 | 只读查询 | ❌ 浏览器无法读取系统通知栏（截图描述也是仅 Android App 原生权限）→ 提供"读取应用内消息记录"版：返回最近 24h 本应用收到的 TA 的消息（复用 rolechat-log） | 卡片标注"仅应用内消息，系统通知栏需原生 App" |
| 8 | 读取 App 使用时长 | 只读查询 | ❌ UsageStatsManager 是 Android 原生权限，Web 拿不到 → 提供"应用内使用统计"版：本应用累计前台时长、今日时长、上次打开时间（visibilitychange 计时落库） | 卡片标注"仅统计本应用，其他 App 时长需原生 App" |
| 9 | 发送到本机音乐 App | 会执行操作 | ✅ `navigator.share({files})` 分享音频文件到系统任意播放器；无 Web Share Level 2（iOS Safari 不支持 files）→ 新窗口打开音频直链交给系统播放器/长按另存 | 音乐 App 取歌单里配置的音频 URL（media.ts music-urls） |

> 诚实原则：7/8 两项在 Web 形态下只能做成"应用内数据版"，UI 上明确写出边界，不冒充原生能力。

## 4. 方案设计
**选定**：新建独立全屏 App 页（ScreenId "mcp"）+ 独立能力执行模块 `src/lib/reality-mcp.ts` + CustomEvent 总线（沿用 notification-store 模式）。
- 备选A（塞进 SettingsApp 内联 Section）：否决——9 张卡片太长，且截图就是独立页带返回箭头和右上角 MCP 徽标。
- 备选B（每个能力各自散落在组件里实现）：否决——需要统一开关状态、统一供 AI 协议消化标记、统一执行日志，集中模块才可控。

### 数据契约（reality-mcp.ts）
```ts
export type McpCapabilityId = "device_status" | "app_notifications" | "app_usage" | "send_music" | "system_notify" | "speak" | "vibrate" | "set_reminder" | "list_reminders";
export interface McpPrefs { enabled: Record<McpCapabilityId, boolean>; } // 默认除 speak/vibrate 外全开（对齐截图开关态）
useMcpPrefs()            // vp-phone:mcp-prefs:v1，usePersisted
McpCardMeta[]            // id/title/desc/tag(只读查询|会执行操作)/platformNote —— UI 文案单一来源
detectSupport(id)        // 运行时探测：vibrate/notification/battery/share files…返回 "full"|"fallback"|"unavailable"+原因人话
// 执行器（全部 try-catch，失败返回 {ok:false,error}）：
readDeviceStatus() / fireSystemNotification(title,body) / vibrate(level) / speakToUser(text,fallbackCfg)
createReminder(title,minutes) → 生成 .ics Blob + a.download 触发 + 落库 vp-phone:mcp-reminders:v1
listReminders() / readRecentAppMessages(hours=24) / useAppUsageStats()（visibilitychange 计时 vp-phone:mcp-usage:v1）
shareTrackToMusicApp(url,title)
// AI 侧协议与解析：
REALITY_MCP_PROTOCOL     // 【手机能力】教学：单独一行 [震动:轻|标准|强烈] [播报:文本] [提醒:分钟数:内容] [状态]，只在对方明确要求或情绪时刻克制使用
extractMcpMarks(text)    // 拆出标记 → { actions: McpAction[], clean: string }
execMcpActions(actions, cfg) // 按开关逐个执行，返回执行结果行（成功/失败/未授权），供写回聊天流
```

### 接线链路（ASCII）
```
DeliveryApp 注册方式参照 ─┐
HomeCarousel APPS 网格 ──► PhoneShell screen==="mcp" ──► McpApp（9卡片+开关+测试按钮+提醒清单+使用说明）
SettingsApp 连接区 ──────► 「MCP 手机能力」入口卡 ──► onOpenMcp={() => setScreen("mcp")}
RoleChatApp.settleReply/fireOne ──► extractMcpMarks(clean) ──► execMcpActions(按 McpPrefs)
        │                                        │
        ▼                                        ▼
  剩余文字照常渲染气泡          聊天流插入 assistant "执行记录"条目（entry.mcpNote，如 ✓已震动·标准 / ✗提醒未授权）
  buildSys 私聊+剧情分支拼 REALITY_MCP_PROTOCOL
  requestReply mcpCtx IIFE：把开关状态清单+未到期提醒数描述进 system
```

## 5. 实现步骤
1. **`src/lib/reality-mcp.ts`（新建）**：类型 + useMcpPrefs + detectSupport + 9 个执行器 + REALITY_MCP_PROTOCOL + extractMcpMarks + execMcpActions；Notification/vibrate/speechSynthesis 全部特性检测后调用。
2. **`src/components/McpApp.tsx`（新建）**：全屏页——glass-nav 顶栏（返回 + "Reality MCP · 手机能力" + 右上 MCP 星芒徽标）；卡片列表照截图排版（标题加粗、描述两行、左下权限胶囊标签【只读查询=绿底 / 会执行操作=红底】、右侧 Switch）；每卡底部小字显示当前设备支持态（"本机完整支持 / iOS 将降级为横幅 / 需原生 App"）；可点的"试一下"按钮（震动/通知/播报/提醒各给一个测试动作）；页尾"我创建的提醒"清单（名称+剩余时间+删除）。
3. **`src/lib/types.ts`**：ScreenId 加 `| "mcp"`。
4. **`src/components/PhoneShell.tsx`**：screen 分支渲染 `<McpApp onBack={goHome} config={config} />`；SettingsApp 传 `onOpenMcp`。
5. **`src/components/SettingsApp.tsx`**：NotificationSection 后加一张入口卡（Sparkles 图标 + "Reality MCP · 手机能力" + 已启用 N 项摘要 + ChevronRight）→ onOpenMcp。
6. **`src/components/HomeCarousel.tsx`**：仿 EXTRA_APP 再加一个桌面宫格入口（lucide Sparkles + 渐变底，label "手机能力"）。
7. **`src/lib/chat-types.ts`**：ChatEntry 加 `mcpNote?: string`（执行记录展示字段）。
8. **`src/components/RoleChatApp.tsx`**：
   - buildSys 私聊与剧情分支均在 ORDER_PROTOCOL 附近拼 REALITY_MCP_PROTOCOL（私聊放 QUOTE_PROTOCOL 前、剧情放 ORDER_PROTOCOL 后）；
   - requestReply 增加 mcpCtx IIFE（开关清单 + 提醒待办数）拼进 sysPrompt；
   - settleReply 签名第 9 参 `mcpNote?`；digestRichCards 同级新增 digestMcpActions：extractMcpMarks 拆标记 → 有动作时 execMcpActions 现执行 → 结果串作为 mcpNote 随该条 assistant 落库，clean 文字继续走原链路；regen 链路同步；
   - 渲染层：assistant 气泡下方若 entry.mcpNote 显示一行细灰字执行记录（✓/✗ 前缀）；wrapCitable 排除 mcpNote-only 条目。
9. **`src/styles.css`**：如需补 mcp 卡片淡入复用 fade-up，不新增。

## 6. 涉及文件定位
- 新建：`/home/project/src/lib/reality-mcp.ts`、`/home/project/src/components/McpApp.tsx`
- 修改：`/home/project/src/lib/types.ts`（ScreenId）、`/home/project/src/lib/chat-types.ts`（ChatEntry.mcpNote）、`/home/project/src/components/PhoneShell.tsx`（路由+prop 传递）、`/home/project/src/components/SettingsApp.tsx`（入口卡）、`/home/project/src/components/HomeCarousel.tsx`（桌面入口）、`/home/project/src/components/RoleChatApp.tsx`（协议注入/mcpCtx/digest/渲染）、`/home/project/AGENTS.md`（第58轮补记）

## 7. 验收标准
1. 桌面宫格与设置页两个入口都能进入「Reality MCP · 手机能力」页，页面结构与截图一致（9 卡片、权限标签、开关位置正确）。
2. 手机（H5 视口）打开：开关状态刷新后保持；点"试一下震动"Android 真机有振感、iPhone 有机身抖动动画并标注原因；点"试一下通知"Android Chrome 弹系统通知、iOS 弹应用内横幅并有说明。
3. "对用户说话"开启后点试听能出声（外部 TTS 或浏览器合成语音均可）。
4. "设置提醒"创建一个 2 分钟后提醒：触发下载 .ics 且"我创建的提醒"清单出现该项倒计时；角色回复里出现 `[提醒:10分钟:喝水]` 标记时，聊天流显示"✓ 已创建提醒"执行记录且文字不带标记。
5. 对 TA 说"手机还剩多少电/什么型号"，TA 能依据【手机能力】上下文回答（Android 报电量、iOS 说不支持读取电量）。
6. 关闭某能力开关后，TA 再输出对应标记时执行记录显示"（该能力已被你关闭）"且不执行。
7. `pnpm run build` + `pnpm run dev` 双门禁通过，预览无白屏无报错。

## 8. 风险与兼容
| 风险点 | 是否破坏现有行为 | 策略 |
|---|---|---|
| settleReply 签名再加第 9 参 | 低（默认参数向后兼容） | 与既有 transfer/location/order 参数同模式 spread 可选 |
| 旧聊天记录无 mcpNote | 否 | 字段可选，渲染层条件分支 |
| Notification 权限弹窗时机 | 否 | 只在用户点开关/试一下时请求，不在加载时打扰 |
| speechSynthesis 与 MiniMax 冲突 | 否 | 优先外部 TTS，失败或未配置才回落浏览器合成 |
| .ics 在部分安卓浏览器直接下载而非打开日历 | 可接受 | 文案引导"下载后点击添加到日历" |
| AI 滥用标记刷屏 | 否 | 协议明令"仅在对方明确要求或情绪时刻使用，一轮最多一个动作" |

## 9. 本期不实现
- 真实读取系统通知栏 / 其他 App 使用时长 / 静默写系统日历（Web 沙箱无此 API，需原生 App 形态，页面内如实标注边界）
- PWA service worker 离线化与推送（涉及 manifest 改造，另行迭代）
- 后台定时任务让角色"人在手机外"发通知（应用关闭后浏览器 JS 停止，不做假承诺）