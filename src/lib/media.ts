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

/**
 * 角色"写实日常照片"生成：走 OpenAI 兼容 /images/generations。
 * 未配置生图通道或失败时回落到该角色的预置素材照。
 */
export async function generateCharPhoto(
  cfg: { baseUrl: string; apiKey: string },
  prompt: string,
  fallbackUrl: string
): Promise<string> {
  const base = normalizeBaseUrl(cfg.baseUrl);
  const key = cfg.apiKey.trim();
  if (!base || !key) return fallbackUrl;
  const candidates = /\/v\d+$/.test(base) ? [base] : [base, `${base}/v1`];
  for (const url of candidates) {
    try {
      const res = await fetch(`${url}/images/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ prompt, n: 1, size: "768x1024", response_format: "b64_json" }),
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
  return fallbackUrl;
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
