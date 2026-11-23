# 需求文档

## 一、概述

在现有「虚拟手机恋爱模拟器」中新增两项能力：

1. **流式输出开关**：聊天回复支持逐字/逐段实时上屏（打字机效果），可在设置中开启或关闭；关闭时维持现在的一次性返回。
2. **用户发图 + AI 识图回应**：聊天输入栏新增图片按钮，用户可从相册选图或直接拍照上传发给角色；表情包发送链路同步升级——AI 请求体改为多模态格式，把图片真实喂给模型，让 TA 能"看见"图片内容并针对性回应。

## 二、现状分析

### 已确认的关键代码位置

| 文件 | 行号 | 现状 |
|------|------|------|
| `src/lib/ai-api.ts` L148-161 | chatCompletion 纯一次性 JSON 返回，无 stream/SSE 解析 |
| `src/components/RoleChatApp.tsx` L923/936/951/960/1242/1294 | 共 7 处调用 chatCompletion，全部传 string content |
| `src/components/RoleChatApp.tsx` L823-914 | toHist 构造 messages，content 全是纯 string |
| `src/components/RoleChatApp.tsx` L1029-1049 | settleReply 落库结构（第9参 mcpNote） |
| `src/components/RoleChatApp.tsx` L1799-1848 | 输入栏 JSX，目前无图片按钮 |
| `src/lib/chat-types.ts` L31-74 | ChatEntry 有 stickerUrl?，无通用 imageUrl 字段 |
| `src/lib/chat-types.ts` L194-203 | SendPrefs 有 sendReplacesGenerate 等 4 个开关，无 streamingEnabled |
| `src/lib/types.ts` L3-12 | AiConfig 无 stream 字段 |
| `src/lib/photo-store.ts` L4-18 | Photo.url 是 data URL（base64） |
| `src/components/StickerApp.tsx` L14-43 | compressToDataUrl 压缩到 200KB 以内转 data URL |
| `src/lib/media.ts` L230-285 | fetchPollinations/tryOpenAIImages 已有 base64/data URL 处理路径 |

### 核心约束

- 项目无任何现成 SSE/fetch ReadableStream 代码，需从零实现流式解析。
- vision 改动影响所有 chatCompletion 调用点（私聊/剧情/主动消息/regenWith 重试）。
- localStorage 持久化 key 前缀 vp-phone:*，SendPrefs 存 vp-phone:send-prefs:v1。

## 三、方案设计

### 方案选型

**流式输出**：采用 OpenAI 兼容协议的 `stream: true` + SSE 解析（`data: {...}\n\n` 行协议），新建 `chatStream` 函数，回调式逐 chunk 上报文本片段，由 RoleChatApp 维护临时 state 实时刷新界面，最终完整文本走既有 settleReply 落库。候选地址兜底逻辑复用 withCandidates。

**用户发图**：ChatEntry 新增 `imageUrl?: string`（data URL）；输入栏加 ImagePlus 按钮触发隐藏 file input，选中后 compressToDataUrl 压缩、构造 user entry 立即上屏；toHist fmt 检测到 imageUrl 时将 content 改为多模态 array `[{type:"text",...},{type:"image_url",image_url:{url}}]`；表情包同理（stickerUrl 存在时也转多模态）。

### 备选方案对比

- 流式：SSE vs WebSocket → SSE 更轻量、OpenAI 协议原生支持，无需额外依赖。
- 发图入口：相册 App 跳转 vs 输入栏直接选图 → 输入栏直接选图体验更连贯，与转账/定位卡片同级。
- 识图范围：仅最新一条用户图片 vs 最近 N 条历史图片均带 vision → 仅最新一条控制 token 消耗，历史记录保持文本摘要。

## 四、实现步骤

### Step 1：扩展类型契约（chat-types.ts / types.ts）

- `src/lib/chat-types.ts` L31-74：ChatEntry 新增 `imageUrl?: string`（注释说明为 data URL，vision 输入用）。
- `src/lib/chat-types.ts` L194-203：SendPrefs 新增 `streamingEnabled?: boolean`（默认 false，旧数据自动兼容）。
- `src/lib/types.ts`：AiConfig 无需改动（stream 由 SendPrefs 控制，不进接口配置）。

### Step 2：新建流式 API 层（ai-api.ts）

- 新增导出函数 `chatStream(cfg, history, onChunk, signal?): Promise<string>`：
  - body 带 `stream: true`，走 withCandidates 兜底。
  - 读取 response.body.getReader()，TextDecoder 按 `\n` 分行，解析 `data: ` 前缀的 JSON，提取 `choices[0].delta.content`，拼接全量文本并每次调用 onChunk(累计文本)。
  - 遇到 `data: [DONE]` 结束，返回完整字符串。
  - 错误处理复用 HttpError/toFriendlyTestError 模式。
- 保留原 `chatCompletion` 不动（非流式场景仍用）。

### Step 3：改造 toHist 支持 vision（RoleChatApp.tsx）

- L823-914 toHist 内 fmt 函数：当 entry 有 `imageUrl` 或 `stickerUrl` 且为本轮最后一条用户消息时，content 改为 array：
  ```ts
  content: [
    { type: "text", text: e.content || "[图片]" },
    { type: "image_url", image_url: { url: e.imageUrl ?? e.stickerUrl! } }
  ]
  ```
- 其余历史消息保持纯 string（控制 token）。
- 类型层面：messages 参数从 `{ role: string; content: string }[]` 放宽为 `{ role: string; content: string | VisionPart[] }[]`，chatCompletion/chatStream 签名同步。

### Step 4：接入流式开关到 requestReply（RoleChatApp.tsx）

- L839 requestReply 开头读取 `prefs.streamingEnabled`。
- 若开启：调用 chatStream，onChunk 回调里 setLog 更新一个临时 assistant entry（id 固定如 `streaming-temp`，content 实时更新），流结束后删除临时 entry、走 settleReply 正式落库。
- 若关闭：维持现有 chatCompletion 一次性返回。
- regenWith 内部两处调用同样分支（跟随全局开关）。
- fireOne 主动消息暂不接流式（后台静默生成，无界面感知）。

### Step 5：输入栏新增图片按钮（RoleChatApp.tsx）

- L1799-1848 输入区 JSX：在 ToolboxButton 旁插入 `<button onClick={() => fileInputRef.current?.click()}><ImagePlus/></button>`。
- 隐藏 `<input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden"/>`。
- handleFileSelect：compressToDataUrl(file) → 构造 `{ id, role:"user", content:"", imageUrl: dataUrl, at }` → setLog + writeLogNow → 触发 requestReply。
- 渲染层：assistant/user 气泡区域检测 entry.imageUrl 显示 `<img src={entry.imageUrl} className="max-w-[200px] rounded-lg"/>`。

### Step 6：设置页新增流式开关（SettingsApp.tsx）

- 找到 SendPrefs 相关 UI 区块（L340-354 NotificationSection 样式参照）。
- 新增 Switch 项「流式输出」，绑定 prefs.streamingEnabled，保存走 vp-phone:send-prefs:v1。
- 描述文案："开启后角色回复逐字显示，模拟真人打字节奏"。

### Step 7：表情包发送链路升级（StickerApp.tsx / RoleChatApp.tsx）

- sendSticker 构造 entry 时同时写入 `stickerUrl`（已有）和可选 `imageUrl`（同值，便于统一 vision 判断）。
- toHist fmt 对 stickerUrl 消息同样转多模态（见 Step 3）。

## 五、涉及文件清单

| 文件绝对路径 | 改动类型 | 具体改动 |
|-------------|---------|---------|
| `/home/project/src/lib/chat-types.ts` | 修改 | L31-74 ChatEntry 加 imageUrl?；L194-203 SendPrefs 加 streamingEnabled? |
| `/home/project/src/lib/ai-api.ts` | 修改 | 新增 chatStream 导出函数；chatCompletion 签名放宽 content 类型 |
| `/home/project/src/components/RoleChatApp.tsx` | 修改 | L823-914 toHist fmt 支持 vision array；L839 requestReply 分支流式；L1799-1848 输入栏加图片按钮+file input；渲染层显示 imageUrl；regenWith 两处同步 |
| `/home/project/src/components/SettingsApp.tsx` | 修改 | SendPrefs 区块加流式开关 Switch |
| `/home/project/src/components/StickerApp.tsx` | 可选微调 | sendSticker 写 imageUrl 字段（若 stickerUrl 已足够则不改） |

## 六、测试与验证

1. **构建门禁**：`pnpm run build` 零错误 + `npx tsc --noEmit` 零类型错误。
2. **流式开关**：开启后发消息观察是否逐字上屏；关闭后恢复一次性返回；切换会话/退出重进不影响开关持久化。
3. **发图识别**：上传一张含明显物体的照片，TA 回复应提及图片内容；表情包发送后 TA 能针对表情含义回应。
4. **兼容性**：旧聊天记录（无 imageUrl/streamingEnabled）加载不报错；非 vision 模型（如 deepseek-chat）收到图片时接口报 400 应有友好提示而非白屏。
5. **预览验收**：dev 启动后截图验证输入栏图片按钮可见、设置页流式开关渲染正常。

## 七、风险评估

| 风险点 | 影响 | 缓解措施 |
|--------|------|---------|
| 网关不支持 stream | 部分中转站 SSE 格式差异导致解析失败 | chatStream 内置 fallback：解析异常时退回等待完整响应再一次性返回 |
| vision 增加 token 消耗 | 长对话带多图成本上升 | 仅本轮最后一条用户图片转多模态，历史图片保持文本摘要 |
| 大图片 base64 超 localStorage 配额 | 存储写入失败 | compressToDataUrl 强制 ≤200KB；catch QuotaExceededError 给出提示 |
| 非 vision 模型报错 | 用户体验断裂 | 捕获 400/415 错误，翻译成人话"当前模型不支持看图，请换 gpt-4o 等视觉模型" |