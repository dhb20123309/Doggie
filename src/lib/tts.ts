// 外部语音 API 接入通道：OpenAI 兼容 /audio/speech；音色库可各角色单独绑定
import { normalizeBaseUrl } from "./types";

export interface VoiceConfig {
  /** 语音服务接口地址（留空则复用聊天接口的 baseUrl） */
  baseUrl: string;
  /** 语音服务 Key（留空则复用聊天接口的 apiKey） */
  apiKey: string;
  /** TTS 模型名，例如 tts-1 / openai-audio 兼容网关的模型 */
  model: string;
  /** 可用音色列表（可从服务商文档手工维护） */
  voices: { id: string; label: string }[];
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  baseUrl: "",
  apiKey: "",
  model: "tts-1",
  voices: [
    { id: "alloy", label: "alloy · 中性" },
    { id: "echo", label: "echo · 男声" },
    { id: "fable", label: "fable · 少年" },
    { id: "onyx", label: "onyx · 低沉" },
    { id: "nova", label: "nova · 女声" },
    { id: "shimmer", label: "shimmer · 轻柔" },
  ],
};

const VC_KEY = "vp-phone:voiceconfig:v1";

export function loadVoiceConfig(): VoiceConfig {
  try {
    const raw = localStorage.getItem(VC_KEY);
    if (raw) return { ...DEFAULT_VOICE_CONFIG, ...(JSON.parse(raw) as Partial<VoiceConfig>) };
  } catch {
    /* ignore */
  }
  return DEFAULT_VOICE_CONFIG;
}

export function saveVoiceConfig(cfg: VoiceConfig): void {
  try {
    localStorage.setItem(VC_KEY, JSON.stringify(cfg));
  } catch {
    /* 隐私模式忽略 */
  }
}

/** 是否具备合成条件：有可用地址+Key（显式配置或回落到聊天接口） */
export function voiceReady(
  vc: VoiceConfig,
  fallback: { baseUrl: string; apiKey: string }
): boolean {
  const base = normalizeBaseUrl(vc.baseUrl || fallback.baseUrl);
  const key = (vc.apiKey || fallback.apiKey).trim();
  return Boolean(base && key && vc.model.trim());
}

/**
 * 调用外部 TTS 合成一段语音，返回可播放的对象 URL。
 * 候选地址兜底逻辑与聊天接口一致：不带版本号时自动补 /v1 再试。
 */
export async function synthesizeSpeech(
  vc: VoiceConfig,
  fallback: { baseUrl: string; apiKey: string },
  text: string,
  voiceId?: string
): Promise<string> {
  const base = normalizeBaseUrl(vc.baseUrl || fallback.baseUrl);
  const key = (vc.apiKey || fallback.apiKey).trim();
  if (!base || !key) throw new Error("未配置语音接口：请在设置里填写语音服务的地址和 Key");
  const candidates = /\/v\d+$/.test(base) ? [base] : [base, `${base}/v1`];
  let lastErr: unknown = null;
  for (const url of candidates) {
    try {
      const res = await fetch(`${url}/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: vc.model.trim(),
          input: text.slice(0, 600),
          voice: voiceId || vc.voices[0]?.id || "alloy",
          response_format: "mp3",
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`语音接口返回 ${res.status}${txt ? `：${txt.slice(0, 120)}` : ""}`);
      }
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("语音合成失败");
}
