// 共享契约：AI 接口配置、连接测试结果、屏幕导航

export interface AiConfig {
  /** 服务商接口地址，例如 https://api.openai.com/v1 或兼容网关地址 */
  baseUrl: string;
  /** API Key，仅保存在浏览器本地，不写进代码 */
  apiKey: string;
  /** 模型名，例如 gpt-4o-mini / qwen-plus / deepseek-chat */
  model: string;
}

export const EMPTY_CONFIG: AiConfig = { baseUrl: "", apiKey: "", model: "" };

export type ScreenId = "home" | "settings" | "chat" | "rolechat";

export type TestStatus = "idle" | "testing" | "success" | "error";

export interface TestResult {
  status: Exclude<TestStatus, "idle" | "testing">;
  /** 一句话结论 */
  title: string;
  /** 详细原因（含 HTTP 状态码 / 错误信息） */
  detail: string;
  /** 下一步检查建议 */
  hints: string[];
  /** 往返耗时 ms */
  latency?: number;
  /** 模型返回的示例回复 */
  sampleReply?: string;
  at: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

/** 规范化接口地址：去掉末尾斜杠，补 https:// */
export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, "");
}

export function isConfigured(cfg: AiConfig): boolean {
  return Boolean(normalizeBaseUrl(cfg.baseUrl) && cfg.apiKey.trim() && cfg.model.trim());
}
