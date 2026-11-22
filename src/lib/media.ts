// 外部媒体接入：真实音乐音源 URL 列表 + 角色"日常照片"生成提示词与回落素材
import { normalizeBaseUrl } from "./types";

const MUSIC_KEY = "vp-phone:music-urls:v1";

export interface MusicTrack {
  title: string;
  url: string;
}

/** 默认演示曲库（无真实音源）；用户在设置里填入外部音频 URL 后启用真机播放 */
export const DEMO_TRACKS: MusicTrack[] = [
  { title: "晨间轻音乐", url: "" },
  { title: "午后钢琴", url: "" },
  { title: "夜色大提琴", url: "" },
  { title: "雨天白噪音", url: "" },
];

export function loadMusicTracks(): MusicTrack[] {
  try {
    const raw = localStorage.getItem(MUSIC_KEY);
    if (raw) {
      const list = JSON.parse(raw) as string[];
      const real = list.filter((u) => u.trim());
      if (real.length) {
        return real.map((url, i) => ({ title: `外部曲目 ${i + 1}`, url: url.trim() }));
      }
    }
  } catch {
    /* ignore */
  }
  return DEMO_TRACKS;
}

export function saveMusicTracks(urls: string[]): void {
  try {
    localStorage.setItem(MUSIC_KEY, JSON.stringify(urls));
  } catch {
    /* 隐私模式忽略 */
  }
}

/** 是否配置了真实音源 */
export function hasRealAudio(): boolean {
  return loadMusicTracks().some((t) => t.url);
}

/** 独立生图通道（vp-phone:imageconfig:v1）：地址留空则回落聊天接口；填免费网关地址即可在不改聊天 API 的前提下启用生图 */
export interface ImageConfig {
  baseUrl: string;
  apiKey: string;
  /** openai=OpenAI兼容 /images/generations；pollinations=GET 直链免 Key */
  mode: "openai" | "pollinations";
  model: string;
}

const IMG_KEY = "vp-phone:imageconfig:v1";

export const DEFAULT_IMAGE_CONFIG: ImageConfig = { baseUrl: "", apiKey: "", mode: "openai", model: "" };

export function loadImageConfig(): ImageConfig {
  try {
    const raw = localStorage.getItem(IMG_KEY);
    if (raw) return { ...DEFAULT_IMAGE_CONFIG, ...(JSON.parse(raw) as Partial<ImageConfig>) };
  } catch {
    /* ignore */
  }
  return DEFAULT_IMAGE_CONFIG;
}

export function saveImageConfig(cfg: ImageConfig): void {
  try {
    localStorage.setItem(IMG_KEY, JSON.stringify(cfg));
  } catch {
    /* 隐私模式忽略 */
  }
}

/** Pollinations 免费生图：GET 直链即图片本体，无需注册拿 Key；转 data URL 以便随聊天记录持久化（blob URL 刷新即裂图） */
async function fetchPollinations(prompt: string, width: number, height: number, model: string): Promise<string> {
  const params = new URLSearchParams({ width: String(width), height: String(height), nologo: "true", seed: String(Math.floor(Math.random() * 1e9)) });
  if (model.trim()) params.set("model", model.trim());
  const res = await fetch(`https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params.toString()}`);
  if (!res.ok) return "";
  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) return "";
  return new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => resolve("");
    fr.readAsDataURL(blob);
  });
}

/**
 * 角色"写实日常照片"生成，按优先级尝试：
 * ① 设置里的独立生图通道（OpenAI 兼容或 pollinations 免费网关）
 * ② 聊天接口同址的 /images/generations
 * ③ 全部失败回落该角色的预置素材照。
 */
export async function generateCharPhoto(
  cfg: { baseUrl: string; apiKey: string },
  prompt: string,
  fallbackUrl: string
): Promise<string> {
  const ic = loadImageConfig();
  // ① 独立通道：pollinations 免 Key 直链
  if (ic.mode === "pollinations") {
    try {
      const url = await fetchPollinations(prompt, 768, 1024, ic.model);
      if (url) return url;
    } catch {
      /* 继续下一通道 */
    }
  }
  // ①' 独立通道：自定义 OpenAI 兼容网关
  if (ic.mode === "openai" && ic.baseUrl.trim()) {
    const url = await tryOpenAIImages(ic.baseUrl.trim(), ic.apiKey.trim() || cfg.apiKey.trim(), ic.model, prompt);
    if (url) return url;
  }
  // ② 回落聊天接口网关
  const base = normalizeBaseUrl(cfg.baseUrl);
  const key = cfg.apiKey.trim();
  if (base && key) {
    const url = await tryOpenAIImages(base, key, ic.model, prompt);
    if (url) return url;
  }
  return fallbackUrl;
}

/** OpenAI 兼容 /images/generations：候选地址兜底（不带 /vN 补 /v1），返回图片 URL 或 data URL，失败返回空串 */
async function tryOpenAIImages(baseUrl: string, key: string, model: string, prompt: string): Promise<string> {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return "";
  const candidates = /\/v\d+$/.test(base) ? [base] : [base, `${base}/v1`];
  for (const url of candidates) {
    try {
      const res = await fetch(`${url}/images/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ prompt, n: 1, size: "768x1024", response_format: "b64_json", ...(model.trim() ? { model: model.trim() } : {}) }),
      });
      if (!res.ok) continue; // 该网关可能没有图像能力，换候选或回落
      const json = await res.json().catch(() => null);
      const item = json?.data?.[0];
      if (item?.url) return String(item.url);
      if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
    } catch {
      /* 继续尝试下一候选 */
    }
  }
  return "";
}

/** 按人设拼写实照片提示词（英文对图像模型更稳） */
export function photoPrompt(charName: string, persona: string, scene: string): string {
  const traits = persona.slice(0, 300).replace(/\s+/g, " ");
  return `Candid realistic smartphone snapshot photo of ${charName}, character traits: ${traits}. Scene: ${scene}. Natural imperfect phone-camera framing, realistic lighting, no text, no watermark.`;
}

/** 主动分享照片时的日常场景池 */
export const PHOTO_SCENES = [
  "after school on the basketball court, slightly sweaty and smiling at the camera",
  "in the passenger seat of a car on a sunny afternoon road trip",
  "at a piano in the school music room, glancing up mid-phrase",
  "holding a bubble tea on a tree-lined street at dusk",
  "on the rooftop railing looking at the evening city lights",
];
