// AI 接口接入层：OpenAI 兼容协议（/chat/completions）
// 绝大多数国内服务商（DeepSeek、通义千问 compatible-mode、Kimi、智谱 GLM、
// 豆包 ark、OneAPI/NewAPI 网关等）都支持该格式。
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

async function fetchChat(
  cfg: AiConfig,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<any> {
  const base = normalizeBaseUrl(cfg.baseUrl);
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey.trim()}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON 响应 */
  }
  if (!res.ok) {
    const msg =
      json?.error?.message || json?.message || text.slice(0, 200) || res.statusText;
    throw new HttpError(res.status, String(msg));
  }
  return json;
}

function networkHint(err: unknown): TestResult["hints"] {
  if (err instanceof DOMException && err.name === "AbortError") {
    return ["请求超时：确认接口地址是否可访问，或服务商是否需要代理"];
  }
  if (err instanceof TypeError) {
    // fetch 网络层失败（DNS / CORS / 混合内容），浏览器不提供具体原因
    return [
      "检查接口地址拼写与协议（需以 https:// 开头且不带 /chat/completions 后缀）",
      "该地址可能不允许浏览器跨域访问（CORS），可换用支持浏览器直连的服务商或自建网关",
      "若页面通过 http 打开而接口是 https，一般不会有问题；反之会被浏览器拦截",
    ];
  }
  return ["查看浏览器控制台 Network 面板中的具体报错"];
}

/** 连接测试：发送一条最小对话请求，验证地址 / Key / 模型三要素 */
export async function testConnection(
  cfg: AiConfig,
  signal?: AbortSignal
): Promise<TestResult> {
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
    const json = await fetchChat(
      cfg,
      {
        model: cfg.model.trim(),
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 16,
      },
      signal
    );
    const latency = Math.round(performance.now() - start);
    const reply: string =
      json?.choices?.[0]?.message?.content ??
      json?.choices?.[0]?.text ??
      "(接口返回成功，但未包含文本内容)";
    return {
      status: "success",
      title: "连接成功",
      detail: `模型「${cfg.model.trim()}」已正常响应，往返耗时 ${latency}ms。`,
      hints: [],
      latency,
      sampleReply: reply.trim().slice(0, 120),
      at,
    };
  } catch (err) {
    const latency = Math.round(performance.now() - start);
    if (err instanceof HttpError) {
      const map: Record<number, { title: string; hints: string[] }> = {
        401: {
          title: "鉴权失败（401）",
          hints: ["API Key 是否正确、有无多余空格", "Key 是否已过期或被重置", "服务商是否要求其他前缀（部分网关不需要 Bearer）"],
        },
        403: {
          title: "禁止访问（403）",
          hints: ["Key 无此模型权限", "账户欠费或未开通该模型"],
        },
        404: {
          title: "地址或模型不存在（404）",
          hints: ["接口地址应填服务商的基础地址（如 https://api.deepseek.com/v1），不要带 /chat/completions", "模型名是否与服务商文档一致（区分大小写）"],
        },
        429: {
          title: "请求过于频繁（429）",
          hints: ["稍后再试", "检查额度 / RPM 限制"],
        },
        500: { title: "服务端错误（500）", hints: ["稍后重试", "到服务商状态页确认服务是否正常"] },
        503: { title: "服务不可用（503）", hints: ["服务商繁忙，稍后重试"] },
      };
      const info =
        map[err.status] ?? {
          title: `请求失败（HTTP ${err.status}）`,
          hints: ["对照服务商文档确认参数格式"],
        };
      return {
        status: "error",
        title: info.title,
        detail: err.message,
        hints: info.hints,
        latency,
        at,
      };
    }
    return {
      status: "error",
      title: "无法连接到接口地址",
      detail: err instanceof Error ? err.message : String(err),
      hints: networkHint(err),
      at,
    };
  }
}

/** 聊天补全：供手机里的「AI 助手」使用 */
export async function chatCompletion(
  cfg: AiConfig,
  history: { role: string; content: string }[],
  signal?: AbortSignal
): Promise<string> {
  const json = await fetchChat(
    cfg,
    {
      model: cfg.model.trim(),
      messages: [
        {
          role: "system",
          content:
            "你住在一台虚拟小手机里，是机主的贴身 AI 助手。回答简洁、口语化、中文优先。",
        },
        ...history,
      ],
    },
    signal
  );
  const reply = json?.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || !reply.trim()) {
    throw new Error("接口未返回文本内容，请检查模型名或服务商响应格式");
  }
  return reply.trim();
}
