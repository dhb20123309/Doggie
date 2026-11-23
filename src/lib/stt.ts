// MiniMax 语音识别（STT/ASR）接入层（步骤B）：POST /v1/speech_to_text multipart/form-data
// 官方协议（platform.minimax.cn/docs/api-reference/speech-to-text，2026-11 实测校正）：
//   - 请求体字段：model=asr-1.0（必填）、file（音频文件，wav/mp3/aac/opus 等容器格式，≤500s、≤50MB）、
//     response_format=json|verbose_json|srt|vtt、stream；语种走 **language 请求头**（不是表单字段）。
//   - 响应：json → {text, duration, trace_id}；verbose_json → 另含 n_speakers + segments[]。
//   - ⚠️ 官方接口不返回逐词置信度字段——"置信度"只能由本地信号估算（音量 RMS + 有效语音时长占比），
//     并在界面上如实标注为"本地估算"，绝不冒充模型置信度。
//   - 错误为 OpenAI 风格 {"type":"error","error":{...}}，HTTP 状态码即错误码（400/401/402/413/422/429/500）。
import type { VoiceConfig } from "./tts";
import type { RecordedAudio } from "./recorder";

export interface SttResult {
  /** 转写文本 */
  text: string;
  /** 服务端回传的音频时长（秒）；缺省用录音端时长 */
  durationSec: number;
  /** 置信度 0~100（本地估算：音量与有效语音占比，非模型返回值） */
  confidence: number;
  /** 置信度来源说明（界面展示用，诚实标注） */
  confidenceSource: "local-estimate";
  /** 本次请求追踪 id，排查问题用 */
  traceId?: string;
}

/** MiniMax STT 域名与 Key 大区对应（同 T2A 规则）：国内 Key 打 api.minimaxi.com，国际打 api.minimax.io */
function sttHost(vc: VoiceConfig): string {
  return vc.minimaxRegion === "global" ? "https://api.minimax.io" : "https://api.minimaxi.com";
}

/** HTTP 错误码 → 明确失败原因（人话） */
export function sttErrorMessage(status: number, body?: string): string {
  const detail = (body ?? "").slice(0, 160);
  switch (status) {
    case 400:
      return `音频不符合要求（400）：时长需在 500 秒内且为 wav/mp3 等有容器格式${detail ? `——${detail}` : ""}`;
    case 401:
      return "API Key 缺失或无效（401）：请到设置·语音服务确认粘贴的是完整 Key（sk- 开头、无空格），并检查区域是否与 Key 同大区";
    case 402:
      return "MiniMax 账户余额或资源包不足（402）：去 MiniMax 控制台充值/开通语音识别后再试";
    case 403:
      return "账号未开通语音识别服务（403）：请在 MiniMax 控制台开通 ASR 能力后重试";
    case 413:
      return "音频超过 50MB 上限（413）：请缩短录音时长";
    case 422:
      return "音频内容被判定涉及敏感信息（422），换个内容再录";
    case 429:
      return "触发 MiniMax 限流（429）：稍等几秒再点重试";
    case 500:
    case 502:
    case 503:
      return `MiniMax 服务端异常（${status}）：稍后重试，持续失败可带 trace_id 联系官方`;
    default:
      return `转写失败（HTTP ${status}）${detail ? `：${detail}` : ""}`;
  }
}

/**
 * 本地声学估算（纯函数，可单测）：从 PCM Float32 采样估两个信号——
 * 峰值响度（太小说明离麦远/音量低）与有效语音帧占比（静音碎片多说明断断续续）。
 * 输出 0~100；这只是参考值，界面必须标注"本地估算"。
 */
export function estimateConfidence(samples: Float32Array): number {
  if (samples.length < 1600) return 0; // 不足 0.1s
  const FRAME = 320; // 20ms @16k
  let voiced = 0;
  let frames = 0;
  let peak = 0;
  for (let i = 0; i + FRAME <= samples.length; i += FRAME) {
    let sum = 0;
    for (let j = 0; j < FRAME; j++) {
      const v = samples[i + j];
      sum += v * v;
      if (Math.abs(v) > peak) peak = Math.abs(v);
    }
    const rms = Math.sqrt(sum / FRAME);
    frames++;
    if (rms > 0.01) voiced++;
  }
  if (!frames) return 0;
  const ratio = voiced / frames; // 有效语音占比
  const loud = Math.min(1, peak / 0.35); // 峰值到 0.35 视为满
  const score = 100 * (0.6 * ratio + 0.4 * loud);
  return Math.round(Math.max(5, Math.min(99, score)));
}

/**
 * 调 MiniMax speech_to_text 转写一段录音。
 * audio.samples 传录音器原始 16k PCM（用于本地置信度估算）；不传则置信度按文本长度粗估。
 * 失败抛出带分类原因的 Error（调用方直接展示 message）。
 */
export async function transcribeRecording(
  vc: VoiceConfig,
  audio: RecordedAudio,
  samples?: Float32Array,
  signal?: AbortSignal
): Promise<SttResult> {
  const key = vc.minimaxKey.trim();
  if (!key) throw new Error("未填写 MiniMax API Key：请到设置·语音服务·MiniMax 通道填入 Key 并保存");
  if (audio.durationSec < 0.3) throw new Error("录音太短（不足 0.3 秒），没听到有效内容，请靠近麦克风再说一句");
  if (audio.blob.size > 50 * 1024 * 1024) throw new Error("音频超过 50MB 上限，请缩短录音时长");

  const host = sttHost(vc);
  const form = new FormData();
  form.append("model", vc.minimaxSttModel?.trim() || "asr-1.0");
  form.append("file", audio.blob, `call_${Date.now()}.wav`);
  form.append("response_format", "json");

  let res: Response;
  try {
    res = await fetch(`${host}/v1/speech_to_text`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, language: "zh" },
      body: form,
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw new Error("已取消转写");
    throw new Error(`连不上 MiniMax 语音识别服务：${e instanceof Error ? e.message : String(e)}（检查网络或在设置里切换 cn/global 区域）`);
  }

  const rawText = await res.text().catch(() => "");
  if (!res.ok) {
    console.log(`[stt] fail http=${res.status} body=${rawText.slice(0, 200)}`);
    throw new Error(sttErrorMessage(res.status, rawText));
  }
  interface SttJson {
    text?: string;
    duration?: number;
    trace_id?: string;
    base_resp?: { status_code?: number; status_msg?: string };
  }
  let json: SttJson | null = null;
  try {
    json = JSON.parse(rawText) as SttJson;
  } catch {
    throw new Error(`识别接口返回了非 JSON 内容（HTTP ${res.status}），大概率是网关地址不对，请核对区域设置`);
  }
  // 部分网关把业务错误包在 200 里（base_resp 风格），一并兜底
  if (json?.base_resp && json.base_resp.status_code && json.base_resp.status_code !== 0) {
    throw new Error(sttErrorMessage(json.base_resp.status_code, json.base_resp.status_msg));
  }
  const text = (json?.text ?? "").trim();
  if (!text) {
    return Promise.reject(new Error("转写结果为空：音频里可能没有说话、声音太小或全是噪音，请重录一段"));
  }
  const confidence = samples ? estimateConfidence(samples) : Math.min(80, 40 + text.length * 2);
  console.log(`[stt] ok chars=${text.length} dur=${json?.duration ?? audio.durationSec}s conf=${confidence} trace=${json?.trace_id ?? "-"}`);
  return {
    text,
    durationSec: json?.duration ?? audio.durationSec,
    confidence,
    confidenceSource: "local-estimate",
    traceId: json?.trace_id,
  };
}
