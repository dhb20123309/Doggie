# AGENTS.md

## 依赖
- 无额外第三方依赖（仅使用模板内置的 shadcn/ui、lucide-react、TanStack Router）。

## 架构
- `src/lib/types.ts`：共享契约（AiConfig / TestResult / ScreenId：home|settings|chat|rolechat / normalizeBaseUrl）。
- `src/lib/chat-types.ts`：单角色聊天契约（Character / ChatEntry / SendPrefs / splitBubbles / buildHistory），人设作为 system prompt，上下文取最近 20 条并过滤 failed 消息；system 末尾固定追加「逐行分条、只输出角色消息」指令，配合 splitBubbles 实现日常聊天式多条气泡。
- `src/components/RoleChatApp.tsx`：输入与发送习惯按 SullyOS 四模式实现——sendReplacesGenerate（发送即生成）/ enterSendsText（回车发文字）/ autoReplyAfterSend（无草稿且最后一条为 user 时停 2s 自动生成，输入变化重置计时）；prefs 存 vp-phone:send-prefs:v1。
- `src/lib/ai-api.ts`：OpenAI 兼容协议接入层（POST {baseUrl}/chat/completions），testConnection 按 HTTP 状态码映射失败原因；浏览器直连受 CORS 限制。
- `src/lib/config-store.ts`：API 配置存 localStorage（vp-phone:aiconfig:v1），useAiConfig 订阅器跨组件同步；代码中禁止出现真实密钥。
- `src/lib/chat-store.ts`：角色设定与聊天记录存 localStorage（vp-phone:character:v1 / vp-phone:rolechat-log:v1），usePersisted 通用 hook。
- `src/components/PhoneShell.tsx`：手机外壳 + 屏幕内路由；非 home 屏状态栏切深色文字。RoleChatApp 内部再分 chat/edit 两个视图。

## Lessons
- Button 没有 "success" variant；成功态用自定义 CSS token（--color-success）配合边框/背景类。
- 外部网关返回 401 属鉴权业务失败（Key 错误/缺失），不是前端代码问题；连接测试按钮已把状态码映射为原因与排查建议。
