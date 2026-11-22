# AGENTS.md

## 依赖
- 无额外第三方依赖（仅使用模板内置的 shadcn/ui、lucide-react、TanStack Router）。

## 架构
- `src/lib/types.ts`：共享契约（AiConfig / TestResult / ScreenId / normalizeBaseUrl）。
- `src/lib/ai-api.ts`：OpenAI 兼容协议接入层（POST {baseUrl}/chat/completions），testConnection 按 HTTP 状态码映射失败原因与排查建议；浏览器直连受 CORS 限制，fetch 网络层失败时无法区分 DNS/CORS。
- `src/lib/config-store.ts`：API Key 等配置仅存 localStorage（key: vp-phone:aiconfig:v1），通过 useAiConfig 订阅器跨组件同步；代码中禁止出现真实密钥。
- `src/components/PhoneShell.tsx`：手机外壳 + 屏幕内路由（home/settings/chat），非首页屏幕的状态栏需切深色文字（dark prop）。

## Lessons
- Button 没有 "success" variant；成功态用自定义 CSS token（--color-success）配合边框/背景类。
