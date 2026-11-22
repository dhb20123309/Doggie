// AI 接口接入层：OpenAI 兼容协议，候选地址自动兜底（用户填 /xxx 或 /xxx/v1 都能用）
import {
  type AiConfig,
  type TestResult,
  normalizeBaseUrl,
  isConfigured,
} from "./types";

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** 候选基础地址：不带 /v1 时两种写法都试一遍，谁先成功用谁 */
export function getCandidates(rawUrl: string): string[] {
  const base = normalizeBaseUrl(rawUrl);
  if (!base) return [];
  return /\/v\d+$/.test(base) ? [base] : [base, `${base}/v1`];
}

async function requestJson(url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || text.slice(0, 200) || res.statusText;
    throw new HttpError(res.status, String(msg));
  }
  return json;
}

/** 依次尝试候选地址，返回第一个成功结果；全失败时抛出最后一个错误 */
async function withCandidates<T>(
  rawUrl: string,
  headers: Record<string, string>,
  fn: (base: string, h: Record<string, string>) => Promise<T>
): Promise<T> {
  let lastErr: unknown = null;
  for (const base of getCandidates(rawUrl)) {
    try {
      return await fn(base, headers);
    } catch (e) {
      // 404 可能是基础地址少/多了一层 /v1，继续换候选；其余错误直接判定
      if (e instanceof HttpError && e.status === 404) lastErr = e;
      else throw e;
    }
  }
  throw lastErr ?? new Error("未知错误");
}

const authHeaders = (cfg: AiConfig) => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${cfg.apiKey.trim()}`,
});

/** 拉取模型列表（GET /models），供设置页“拉取模型”按钮使用 */
export async function fetchModelList(cfg: AiConfig): Promise<string[]> {
  if (!normalizeBaseUrl(cfg.baseUrl) || !cfg.apiKey.trim()) {
    throw new Error("需要先填写接口地址和 API Key");
  }
  const json = await withCandidates(cfg.baseUrl, authHeaders(cfg), (base, h) =>
    requestJson(`${base}/models`, { headers: h })
  );
  const list: any[] = json?.data || json?.models || [];
  const ids = list.map((m) => (typeof m === "string" ? m : m?.id)).filter(Boolean) as string[];
  if (!ids.length) throw new Error("接口通了，但没返回模型列表，可能是地址填错了");
  return ids;
}

async function chatOnce(base: string, cfg: AiConfig, body: Record<string, unknown>, signal?: AbortSignal) {
  return requestJson(
    `${base}/chat/completions`,
    { method: "POST", headers: authHeaders(cfg), body: JSON.stringify(body), signal }
  );
}

/** 连接测试：最小对话请求，按状态码翻译成人话并给排查建议 */
export async function testConnection(cfg: AiConfig, signal?: AbortSignal): Promise<TestResult> {
  const at = Date.now();
  if (!isConfigured(cfg)) {
    return {
      status: "error",
      title: "配置不完整",
      detail: "接口地址、API Key、模型名三项都必须填写后才能测试。",
      hints: ["逐项检查设置页的三个输入框是否有空值"],
      at,
    };
  }
  const start = performance.now();
  try {
    const json = await withCandidates(cfg.baseUrl, {}, (base) =>
      chatOnce(base, cfg, { model: cfg.model.trim(), messages: [{ role: "user", content: "ping" }], max_tokens: 16 }, signal)
    );
    const latency = Math.round(performance.now() - start);
    const reply: string = json?.choices?.[0]?.message?.content ?? "(接口返回成功，但未包含文本内容)";
    return {
      status: "success",
      title: "连接成功",
      detail: `模型「${cfg.model.trim()}」已正常响应，往返耗时 ${latency}ms。`,
      hints: [],
      latency,
      sampleReply: String(reply).trim().slice(0, 120),
      at,
    };
  } catch (err) {
    const latency = Math.round(performance.now() - start);
    return { ...toFriendlyTestError(err, cfg), latency, at };
  }
}

function toFriendlyTestError(err: unknown, cfg: AiConfig): Omit<TestResult, "latency" | "at"> {
  if (err instanceof HttpError) {
    const map: Record<number, { title: string; hints: string[] }> = {
      401: { title: "鉴权失败（401）", hints: ["密钥不对，或者密钥没有这个模型的权限", "API Key 是否复制完整、有无多余空格", "Key 是否已过期或被重置"] },
      403: { title: "禁止访问（403）", hints: ["Key 无此模型权限", "账户欠费或未开通该模型"] },
      404: { title: "地址或模型不存在（404）", hints: [`已尝试过 ${getCandidates(cfg.baseUrl).join(" 和 ")}，都不通`, "模型名是否与服务商文档一致（区分大小写）"] },
      429: { title: "请求过于频繁（429）", hints: ["请求太快被限流了，稍等再试", "检查额度 / RPM 限制"] },
      500: { title: "服务端错误（500）", hints: ["稍后重试", "到服务商状态页确认服务是否正常"] },
      503: { title: "服务不可用（503）", hints: ["服务商繁忙，稍后重试"] },
    };
    const info = map[err.status] ?? { title: `请求失败（HTTP ${err.status}）`, hints: ["对照服务商文档确认参数格式"] };
    return { status: "error", title: info.title, detail: err.message, hints: info.hints };
  }
  if (err instanceof DOMException && err.name === "AbortError") {
    return { status: "error", title: "请求超时", detail: "20 秒内没有收到响应。", hints: ["确认接口地址是否可访问，或服务商是否需要代理"] };
  }
  if (err instanceof TypeError) {
    return {
      status: "error",
      title: "连不上，检查网络或者接口地址是否正确",
      detail: err.message,
      hints: [
        "检查接口地址拼写（如 https://api.deepseek.com 或 https://api.deepseek.com/v1 均可，代码会自动补 /v1 试一遍）",
        "该地址可能不允许浏览器跨域访问（CORS），可换用支持浏览器直连的服务商或自建网关",
      ],
    };
  }
  return { status: "error", title: "出错了", detail: err instanceof Error ? err.message : String(err), hints: [] };
}

/** 聊天补全：走候选地址兜底，temperature 可配 */
export async function chatCompletion(
  cfg: AiConfig,
  history: { role: string; content: string }[],
  signal?: AbortSignal
): Promise<string> {
  const json = await withCandidates(cfg.baseUrl, {}, (base) =>
    chatOnce(base, cfg, { model: cfg.model.trim(), messages: history, temperature: cfg.temperature ?? 0.8 }, signal)
  );
  const reply = json?.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || !reply.trim()) {
    throw new Error("接口未返回文本内容，请检查模型名或服务商响应格式");
  }
  return reply.trim();
}
