# 需求文档

## 1. 概述

本轮共 6 项改动，全部落在现有「虚拟手机恋爱模拟器」网页应用内：修复语音通话页手机端渲染问题、聊天输入栏工具收纳进工具箱、桌面图标可自定义、音乐回到 mp3 直链播放、AI 每日自动生成日记、小剧场按角色归属且可切换可自定义。

## 2. 探索结论（现状与根因）

### ① 语音通话页渲染问题（VoiceCallApp.tsx）
- 根容器 `flex h-full flex-col`（L547）**整页无滚动能力**；中部内容区（转写结果卡 L630-718 + 本段录音结果卡 L720-789，含观察折叠条/隐私长文/按钮行）在"点击结束"后同时展开，总高远超手机视口。
- `<footer className="mt-auto ... pb-14">`（L792-819）被超高内容顶出屏幕——用户看到的就是"结束后页面渲染有问题"：主按钮/挂断键看不见或被内容挤压错位。
- 修复方向：把两块卡片收进一个 `flex-1 min-h-0 overflow-y-auto` 的中间滚动区，头像+波形区加 `shrink-0`，footer 常驻底部。

### ② 聊天输入栏（RoleChatApp.tsx L2119-2191）
- 当前一行里挤了 4 个 `size-9 shrink-0` 图标：ToolboxButton（Wrench）、ImagePlus 发图、Banknote 转账、MapPin 定位，再是 Input(flex-1) + 发送钮——输入框被压得很窄。
- 已有 ToolboxMenu 弹层（L2275-2295，三动作：角色开场白/人物档案/导入档案文本），由 `toolboxOpen` state 控制。
- 目标形态：**只保留一个工具箱按钮**，点击向上展开面板，内含四个小功能（发图 / 转账 / 定位 / 档案菜单），输入框恢复原宽度。发图的隐藏 file input、转账/定位的面板开关逻辑全部原样复用，只是入口挪进弹出面板。

### ③ 桌面图标（companion-store.ts ICON_URLS L8-18 + HomeCarousel APPS L15-21）
- 图标 URL 硬编码 CDN（grid9 抠图产物）。SettingsApp 已有 WallpaperPicker（L443-488：file input → FileReader dataURL → localStorage）可直接照抄交互模式。
- 新增通道：设置页加「桌面图标」Section，逐 App 提供自定义上传（dataURL 存储 key `vp-phone:custom-icons:v1`），HomeCarousel 读取时自定义优先、回落 ICON_URLS，支持单个恢复默认。

### ④ 音乐（media.ts parseMusicSource + ShellApps MusicApp L174-208 + SettingsApp MusicSourceSection L738-776）
- 上轮改成了 JSON/JS 歌单解析，用户要求**改回 mp3 链接播放**。现链路其实已支持每行"歌名|URL"，但 UI 话术和默认形态偏向 JSON 粘贴。
- 改法：SettingsApp 音乐源改为**逐条 mp3 链接列表**（每行一条直链即一首歌，可选"歌名|链接"写法；去掉 JSON/JS 大段粘贴导向）；MusicApp 保持 new Audio(url) 真播，无 url 的 DEMO_TRACKS 占位条目不再显示（有真实链接就只播真实链接）。

### ⑤ AI 每日自动日记（companion-store useDiaries/DIARY + CompanionApps DiaryApp L51-142 + chat-store readLastEntries + call-reply calllog）
- DiaryApp 已有手动 write()（chatCompletion 生成 60-120 字随笔）。缺"每天自动"触发器。
- 方案：新增每日检查 effect（挂在 PhoneShell 全局，参照 RoleChatApp 主动消息定时器模式）：记录 `vp-phone:diary:lastday:v1` 日期戳，跨天后对每个活跃角色取最近私聊 readLastEntries + 通话 calllog 素材，调 chatCompletion 以角色口吻生成一篇"昨日回忆"日记入 useDiaries；无对话素材的角色跳过；未配置 API 静默不跑。

### ⑥ 小剧场（companion-store SCRIPTS L208-296 + TheaterApp CompanionApps L404-465）
- SCRIPTS 硬编码两条剧本，台词写死周晨砚/周风砚名字，无角色关联字段；TheaterApp 列表不分角色。
- 改法：Script 加 `charIds?: string[]`（预置剧本标双子 id）；台词模板化 `{哥哥}`/`{弟弟}`/`{TA}` 占位符，渲染时按当前选中角色替换 displayName；列表顶部加角色分段器（覆盖全部 characters，含自定义角色）；每个角色都有「AI 新剧本」按钮——用该角色人设 + 最近聊天素材调 chatCompletion 生成结构化分支剧本 JSON 存入 `vp-phone:theater:scripts:{charId}:v1`，标明"谁的剧场"，可点开玩、可删除；预置剧本仍保留。

## 3. 实现步骤

1. **VoiceCallApp.tsx**：中部内容包 `flex-1 min-h-0 overflow-y-auto px-0.5 pb-2` 滚动区；头像 section 与 footer 加 `shrink-0`；日志 `[call-ui] layout scroll on`。
2. **RoleChatApp.tsx**：删掉输入行的 ImagePlus/Banknote/MapPin 三个独立按钮（隐藏 file input 保留原位）；ToolboxMenu 扩为四宫格（发图/转账/定位/档案），点击项执行原有 setter 并关面板；日志 `[inputbar] toolbox expand item=`。
3. **companion-store.ts**：新增 `useCustomIcons`（key `vp-phone:custom-icons:v1`，Record<string,string>）+ `iconFor(key)` 合并函数。**HomeCarousel.tsx**：APPS 图标走 iconFor。**SettingsApp.tsx**：新增 IconSection（逐 App 预览卡 + 上传 + 恢复默认，复用 FileReader dataURL 模式）；日志 `[icon] custom set/reset key=`。
4. **media.ts**：parseMusicSource 保留但简化主路径为逐行链接（裸 URL 行自动命名"歌曲N"，`歌名|URL` 兼容）；**SettingsApp MusicSourceSection** 文案与 placeholder 改为"每行一条 mp3 直链"；**ShellApps MusicApp** 只显示有 url 的曲目。
5. **companion-store.ts**：新增 `maybeDailyDiary(characters, cfg)` 纯函数层（日期戳判断 + 素材抓取 + 生成 + 去重写入）；**PhoneShell.tsx** mount effect + 每小时 setInterval 调用；日志 `[diary] daily skip no-material / generated char=`。
6. **companion-store.ts**：Script 接口加 charIds；预置剧本台词换占位符；新增 `loadCharScripts(charId)/saveCharScript/deleteCharScript`（`vp-phone:theater:scripts:{charId}:v1`）与 `generateScriptFor(ch, recentText)`（chatCompletion 输出 JSON 剧本，失败提示不崩 UI）；**CompanionApps TheaterApp** 加角色分段器 + "AI 新剧本"按钮 + 剧本卡标注归属角色头像/名字 + 自定义剧本删除；日志 `[theater] script generated char= / deleted`。
7. 双门禁 `pnpm run build` + `npx tsc --noEmit`，`pnpm run dev` 重启，read-browser-screenshot 验收通话页（h5 视口）与聊天输入栏。

## 4. 涉及文件

- `/home/project/src/components/VoiceCallApp.tsx`（布局滚动修复）
- `/home/project/src/components/RoleChatApp.tsx`（输入栏工具箱收纳）
- `/home/project/src/lib/companion-store.ts`（自定义图标 / 每日日记 / 剧本数据层）
- `/home/project/src/components/HomeCarousel.tsx`（图标读取合并）
- `/home/project/src/components/SettingsApp.tsx`（图标 Section + 音乐源改造）
- `/home/project/src/lib/media.ts`（mp3 逐行解析）
- `/home/project/src/components/ShellApps.tsx`（MusicApp 只播真实链接）
- `/home/project/src/components/PhoneShell.tsx`（每日日记触发器）
- `/home/project/src/components/CompanionApps.tsx`（TheaterApp 角色化）

## 5. 验收标准

- iPhone 尺寸下语音通话点"结束"后，主按钮与挂断键始终可见，上方内容可滚动。
- 聊天底部只剩一个工具箱按钮，输入框明显变宽；点开向上弹四宫格，发图/转账/定位/档案功能不变。
- 设置→桌面图标可为任意 App 换图，桌面立即生效，可恢复默认。
- 音乐设置粘贴多行 mp3 直链即成歌单，音乐 App 真实播放、切歌正常。
- 隔天首次打开（或改系统日期跨天）后，聊过天的角色日记 App 里自动出现一篇当日 AI 日记；没聊过的不生成。
- 小剧场顶部可切换任意角色（含导入的自定义角色），剧本卡标明是谁的剧场；点「AI 新剧本」能生成并游玩该角色的分支剧本。

## 6. 风险与边界

- 每日日记依赖已配置 AI 接口；未配置静默跳过，不报错打扰。
- AI 生成剧本 JSON 可能格式坏：解析失败给黄条提示、不入库存，不影响预置剧本。
- 图标 dataURL 存 localStorage 有容量上限，上传时压缩到 ≤120KB（复用头像 canvas 压缩思路）。
- 通话页布局改造不动状态机与音频链路，仅动 JSX 容器层级。