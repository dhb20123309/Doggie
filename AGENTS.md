# AGENTS.md

## 依赖
- 无额外第三方依赖（仅使用模板内置的 shadcn/ui、lucide-react、TanStack Router）。

## 架构
- `src/lib/types.ts`：共享契约（AiConfig 含 temperature / TestResult / ScreenId：home|settings|chat|rolechat|worldbook|sticker / normalizeBaseUrl）。
- `src/lib/ai-api.ts`：OpenAI 兼容对接层。getCandidates 候选地址兜底（不带 /vN 时自动补 /v1 再试一次，404 才换候选）；fetchModelList 拉模型列表；testConnection/chatCompletion 均走候选；错误按状态码翻译成人话。
- `src/lib/chat-types.ts`：Character（含 boundWorldBookIds）/ ChatEntry / SendPrefs / splitBubbles。
- `src/lib/worldbook.ts`：世界书（global/local 过滤 + 拼 system prompt）与表情包（buildStickerHint 名单约束 + parseReplyToMessages 解析 [表情:名字]，未知名字退回文字、结尾未闭合标记丢弃）。
- `src/lib/config-store.ts`：API 配置存 localStorage（vp-phone:aiconfig:v1）；代码中禁止出现真实密钥。
- `src/lib/chat-store.ts`：usePersisted 通用 hook；角色/聊天记录/发送习惯/世界书/表情库存 vp-phone:* 各 key。
- `src/components/RoleChatApp.tsx`：聊天主页，内部视图 chat/edit/prefs/worldbooks/stickers；发送前现算 system = 人设+分条指令+生效世界书+表情名单。
- `src/styles.css`：jelly-btn/jelly-icon/jelly-blob 果冻反馈类——按下 ≤0.08s 快压、松开 cubic-bezier 过冲慢弹回，只动 transform，不与美化层冲突；交互组件统一挂这些类。

## Lessons
- Button 没有 "success" variant；成功态用自定义 CSS token（--color-success）配合边框/背景类。
- 外部网关返回 401 属鉴权业务失败（Key 错误/缺失），不是前端代码问题。
- 非 async 回调里不能 await（如 onChange 处理压缩图片），改 .then 写法。
- 表情/头像图片必须转 base64 data URL 持久化，blob URL 刷新即失效导致裂图；上传时 canvas 压缩到 200KB 内。
