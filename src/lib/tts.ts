// 外部语音 API 接入通道：provider=openai 走 OpenAI 兼容 /audio/speech；provider=minimax 走官方 t2a_v2
import { normalizeBaseUrl } from "./types";

export type VoiceProvider = "openai" | "minimax";

export interface VoiceConfig {
  /** 语音通道：通用 OpenAI 兼容网关 / MiniMax 官方 */
  provider: VoiceProvider;
  /** 语音服务接口地址（留空则复用聊天接口的 baseUrl）——仅 openai 通道使用 */
  baseUrl: string;
  /** 语音服务 Key（留空则复用聊天接口的 apiKey）——仅 openai 通道使用 */
  apiKey: string;
  /** TTS 模型名，例如 tts-1 / openai-audio 兼容网关的模型 */
  model: string;
  /** 可用音色列表（可从服务商文档手工维护） */
  voices: { id: string; label: string }[];
  /** MiniMax API Key（GroupID 后的 Bearer Token） */
  minimaxKey: string;
  /** MiniMax 接口区域：cn=api.minimaxi.com（国内 platform.minimax.cn 的 Key），global=api.minimax.io（国际平台 Key） */
  minimaxRegion: "cn" | "global";
  /** MiniMax TTS 模型名，如 speech-02-hd / speech-2.8-hd */
  minimaxModel: string;
  /** MiniMax 默认音色 voice_id，如 male-qn-qingse */
  minimaxVoice: string;
  /** MiniMax 语音识别（ASR）模型名，官方当前仅 asr-1.0 */
  minimaxSttModel?: string;
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  provider: "openai",
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
  minimaxKey: "",
  minimaxRegion: "cn",
  minimaxModel: "speech-02-hd",
  minimaxVoice: "male-qn-qingse",
};

/** MiniMax 常用男声快捷项（voice_id 可手填其它值） */
export const MINIMAX_VOICES: { id: string; label: string }[] = [
  { id: "male-qn-qingse", label: "青涩青年" },
  { id: "male-qn-jingying", label: "精英青年" },
  { id: "male-qn-badao", label: "霸道青年" },
  { id: "male-zh-acoustic", label: "磁性男声" },
];

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

/** 是否具备合成条件：minimax 通道只看 Key；openai 通道沿用显式配置或回落聊天接口 */
export function voiceReady(
  vc: VoiceConfig,
  fallback: { baseUrl: string; apiKey: string }
): boolean {
  if (vc.provider === "minimax") return Boolean(vc.minimaxKey.trim());
  const base = normalizeBaseUrl(vc.baseUrl || fallback.baseUrl);
  const key = (vc.apiKey || fallback.apiKey).trim();
  return Boolean(base && key && vc.model.trim());
}

/** MiniMax 状态码翻译成人话 */
function minimaxError(status: number, statusMsg?: string): string {
  const map: Record<number, string> = {
    1001: "输入内容不当，换个说法再试",
    1002: "MiniMax 限流了，稍等几秒再点一次",
    1004: "API Key 无效或已过期，检查粘贴是否完整",
    1008: "MiniMax 账户余额不足，去官网充值后再测",
    1026: "音色 id 不存在，检查 voice_id 拼写",
  };
  return map[status] ?? `MiniMax 返回错误 ${status}${statusMsg ? `：${statusMsg}` : ""}`;
}

/** hex 字符串 → mp3 Blob URL */
function hexToAudioUrl(hex: string): string {
  const clean = hex.trim();
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
}

/**
 * 调用 MiniMax 官方 t2a_v2 合成一段语音，返回可播放的对象 URL。
 * 失败抛出中文可读错误（含状态码翻译）。
 */
async function synthesizeMiniMax(
  vc: VoiceConfig,
  text: string,
  voiceId?: string
): Promise<string> {
  const key = vc.minimaxKey.trim();
  if (!key) throw new Error("未填写 MiniMax API Key");
  // 官方文档：国内 platform.minimax.cn 的 Key 打 api.minimaxi.com；国际平台 Key 打 api.minimax.io
  const host = vc.minimaxRegion === "global" ? "https://api.minimax.io" : "https://api.minimaxi.com";
  let res: Response;
  try {
    res = await fetch(`${host}/v1/t2a_v2`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: vc.minimaxModel.trim() || "speech-02-hd",
        text: text.slice(0, 600),
        // t2a_v2 必填结构是 voice_setting.voice_id / audio_setting（顶层 voice_id/audio 会被判 empty field）
        voice_setting: {
          voice_id: voiceId?.trim() || vc.minimaxVoice.trim() || "male-qn-qingse",
          speed: 1,
          vol: 1,
          pitch: 0,
        },
        audio_setting: { format: "mp3", sample_rate: 32000, bitrate: 128000, channel: 1 },
        stream: false,
      }),
    });
  } catch {
    throw new Error("连不上 MiniMax 服务器，检查网络或切换区域重试");
  }
  const json = (await res.json().catch(() => null)) as {
    data?: { audio?: string };
    base_resp?: { status_code?: number; status_msg?: string };
  } | null;
  if (!json) throw new Error(`MiniMax 接口返回异常（HTTP ${res.status}）`);
  const code = json.base_resp?.status_code ?? 0;
  if (code !== 0) {
    // 1004=鉴权失败：大概率是 Key 与区域不匹配，给出针对性提示
    if (code === 1004) {
      console.warn(`[tts] minimax auth fail code=1004 region=${vc.minimaxRegion} msg=${json.base_resp?.status_msg ?? ""}`);
      throw new Error(
        vc.minimaxRegion === "cn"
          ? "Key 验证失败：请确认粘贴的是 platform.minimax.cn（国内）控制台里完整的 API Key（sk-开头、无空格），且账户已开通语音服务"
          : "Key 验证失败：你当前用的是【国际】区域，但 MiniMax 国内控制台的 Key 只在【国内】区域有效——切回国内再测"
      );
    }
    throw new Error(minimaxError(code, json.base_resp?.status_msg));
  }
  const hex = json.data?.audio;
  if (!hex) throw new Error("接口通了但没返回音频，检查模型/音色名是否正确");
  console.log(`[tts] synth ok provider=minimax host=${host} model=${vc.minimaxModel} voice=${voiceId || vc.minimaxVoice} chars=${text.length}`);
  return hexToAudioUrl(hex);
}

/**
 * 调用外部 TTS 合成一段语音，返回可播放的对象 URL。按 provider 分流。
 * openai 通道候选地址兜底与聊天接口一致：不带版本号时自动补 /v1 再试。
 */
export async function synthesizeSpeech(
  vc: VoiceConfig,
  fallback: { baseUrl: string; apiKey: string },
  text: string,
  voiceId?: string
): Promise<string> {
  if (vc.provider === "minimax") {
    return synthesizeMiniMax(vc, text, voiceId);
  }
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
      console.log(`[tts] synth ok provider=openai chars=${text.length}`);
      return URL.createObjectURL(blob);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("语音合成失败");
}

/** 拉取 MiniMax 音色列表（含克隆音色）：voice_type=all；克隆音色需已成功合成过一次才会出现在结果里 */
export async function fetchMiniMaxVoices(
  vc: VoiceConfig
): Promise<{ id: string; label: string }[]> {
  const key = vc.minimaxKey.trim();
  if (!key) throw new Error("请先填写 MiniMax API Key");
  const host = vc.minimaxRegion === "global" ? "https://api.minimax.io" : "https://api.minimaxi.com";
  let res: Response;
  try {
    res = await fetch(`${host}/v1/get_voice`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ voice_type: "all" }),
    });
  } catch {
    throw new Error("连不上 MiniMax 服务器，检查网络或切换区域重试");
  }
  const json = (await res.json().catch(() => null)) as {
    base_resp?: { status_code?: number; status_msg?: string };
    /** 兼容不同版本字段：voice_list / voices，元素含 voice_id、voice_type、preview_text 等 */
    voice_list?: { voice_id?: string; voice_type?: string; name?: string }[];
    voices?: { voice_id?: string; voice_type?: string; name?: string }[];
  } | null;
  if (!json) throw new Error(`音色列表接口返回异常（HTTP ${res.status}）`);
  const code = json.base_resp?.status_code ?? 0;
  if (code !== 0) throw new Error(minimaxError(code, json.base_resp?.status_msg));
  const list = json.voice_list ?? json.voices ?? [];
  return list
    .filter((v) => v.voice_id)
    .map((v) => ({
      id: v.voice_id!,
      label: `${v.name || v.voice_id}${v.voice_type === "voice_cloning" ? " · 克隆" : v.voice_type === "voice_generation" ? " · 文生" : ""}`,
    }));
}

/** 设置页"测试并保存"用：合成一小段试听文本验证通道可用 */
export async function testVoiceChannel(
  vc: VoiceConfig,
  fallback: { baseUrl: string; apiKey: string }
): Promise<void> {
  const url = await synthesizeSpeech(vc, fallback, "你好，这是语音测试。", vc.provider === "minimax" ? vc.minimaxVoice : undefined);
  // 测试成功即释放，避免内存泄漏
  URL.revokeObjectURL(url);
}
