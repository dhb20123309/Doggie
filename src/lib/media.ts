// 外部媒体接入：真实音乐音源 URL 列表 + 角色"日常照片"生成提示词与回落素材
import { normalizeBaseUrl } from "./types";

const MUSIC_KEY = "vp-phone:music-urls:v1";

export interface MusicTrack {
  title: string;
  url: string;
  artist?: string;
  cover?: string;
}

/** 默认演示曲库（无真实音源）；用户在设置里填入外部音频 URL 后启用真机播放 */
export const DEMO_TRACKS: MusicTrack[] = [
  { title: "晨间轻音乐", url: "" },
  { title: "午后钢琴", url: "" },
  { title: "夜色大提琴", url: "" },
  { title: "雨天白噪音", url: "" },
];

/** 从歌单条目提取标题：兼容字符串 / {title|name|song} / 嵌套 tracks|playlist.data */
function pickTitle(o: unknown): string {
  if (typeof o === "string") return o.trim();
  if (o && typeof o === "object") {
    const r = o as Record<string, unknown>;
    const t = r.title ?? r.name ?? r.song ?? r.songname ?? r.songName;
    if (typeof t === "string" && t.trim()) return t.trim();
  }
  return "";
}
function pickUrl(o: unknown): string {
  if (typeof o === "string") return /^https?:\/\//.test(o.trim()) ? o.trim() : "";
  if (o && typeof o === "object") {
    const r = o as Record<string, unknown>;
    for (const k of ["url", "src", "link", "playUrl", "br", "mp3Url"]) {
      const v = r[k];
      if (typeof v === "number") return String(v); // 网易云 song id
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return "";
}
function pickField(o: unknown, keys: string[]): string | undefined {
  if (!o || typeof o !== "object") return undefined;
  const r = o as Record<string, unknown>;
  for (const k of keys) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

/** 归一化任意数组为曲目列表 */
function normalizeTracks(arr: unknown[]): MusicTrack[] {
  const out: MusicTrack[] = [];
  for (const item of arr) {
    const url = pickUrl(item);
    const title = pickTitle(item);
    if (!url && !title) continue;
    out.push({
      title: title || `外部曲目 ${out.length + 1}`,
      url,
      artist: pickField(item, ["artist", "author", "singer", "ar"]),
      cover: pickField(item, ["cover", "pic", "image", "album", "img"]),
    });
  }
  return out;
}

/** 解析用户粘贴的歌单文本：支持 JSON 数组/对象、js 赋值语句（如 window.x = [...]）、每行一个 URL */
export function parseMusicSource(raw: string): MusicTrack[] {
  const text = raw.trim();
  if (!text) return [];
  // 1) 尝试提取 JSON 片段（容忍 js 文件里的赋值前缀）
  const jsonStart = Math.min(
    ...[text.indexOf("["), text.indexOf("{")].filter((i) => i >= 0).concat(Number.MAX_SAFE_INTEGER)
  );
  if (jsonStart !== Number.MAX_SAFE_INTEGER) {
    const candidate = text.slice(jsonStart);
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      // 去掉尾部分号/注释再试
      try {
        parsed = JSON.parse(candidate.replace(/;\s*$/, ""));
      } catch {
        parsed = null;
      }
    }
    if (parsed != null) {
      // 对象：在常见字段里找数组
      let arr: unknown[] | null = null;
      if (Array.isArray(parsed)) arr = parsed;
      else if (typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        for (const key of ["tracks", "list", "songs", "data", "music", "playlist", "items"]) {
          const v = obj[key];
          if (Array.isArray(v)) { arr = v; break; }
          if (v && typeof v === "object") {
            const inner = (v as Record<string, unknown>).tracks ?? (v as Record<string, unknown>).list;
            if (Array.isArray(inner)) { arr = inner; break; }
          }
        }
      }
      if (arr) {
        const tracks = normalizeTracks(arr);
        if (tracks.length) return tracks;
      }
    }
  }
  // 2) 纯文本按行：每行一个 URL 或 "歌名|URL" / "歌名 - URL"
  const tracks: MusicTrack[] = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith("//") || l.startsWith("#")) continue;
    const m = l.match(/^(.*?)[|\t]\s*(https?:\/\/\S+)$/) ?? l.match(/^(.*?)\s+-\s+(https?:\/\/\S+)$/);
    if (m) tracks.push({ title: m[1].trim() || `曲目 ${tracks.length + 1}`, url: m[2] });
    else if (/^https?:\/\//.test(l)) tracks.push({ title: `曲目 ${tracks.length + 1}`, url: l });
  }
  return tracks;
}

export function loadMusicTracks(): MusicTrack[] {
  try {
    const raw = localStorage.getItem(MUSIC_KEY);
    if (raw) {
      const list = JSON.parse(raw) as MusicTrack[];
      const real = list.filter((u) => u.url?.trim());
      if (real.length) return real;
    }
  } catch {
    /* ignore */
  }
  return DEMO_TRACKS;
}

export function saveMusicTracks(tracks: MusicTrack[]): void {
  try {
    localStorage.setItem(MUSIC_KEY, JSON.stringify(tracks));
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

/** 默认走 gpt-image-2（OpenAI 官方 /v1/images/generations 支持的模型名） */
export const DEFAULT_IMAGE_CONFIG: ImageConfig = { baseUrl: "", apiKey: "", mode: "openai", model: "gpt-image-2" };

/** gpt-image 系列快捷选项（自定义网关中转站同款命名） */
export const GPT_IMAGE_MODELS = ["gpt-image-2", "gpt-image-2.5-sunburst", "gpt-image-2.5-flare", "gpt-image-1.5"];

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
  // gpt-image 系列只认 1024x1024 / 1024x1536 / 1536x1024 / auto；其他模型沿用旧尺寸
  const isGptImage = /^gpt-image/i.test(model.trim());
  const size = isGptImage ? "1024x1536" : "768x1024";
  for (const url of candidates) {
    try {
      const res = await fetch(`${url}/images/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ prompt, n: 1, size, response_format: "b64_json", ...(model.trim() ? { model: model.trim() } : {}) }),
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

/** 场景关键词 → 英文拍摄场景：让生成的照片贴合聊天话题，而不是随机发莫名其妙的图 */
const SCENE_MATCHERS: [RegExp, string][] = [
  [/球|赛|运动|锻炼|健身|操场/, "after school on the basketball court, slightly sweaty and smiling at the camera"],
  [/琴|钢琴|排练|音乐|歌|演奏|曲子/, "at a piano in the school music room, glancing up mid-phrase"],
  [/奶茶|咖啡|吃|喝|饭|餐|零食|外卖|饿/, "holding a bubble tea on a tree-lined street at dusk"],
  [/车|兜风|路|旅行|高速|自驾/, "in the passenger seat of a car on a sunny afternoon road trip"],
  [/夜|晚|月亮|星星|灯|天台|风景/, "on the rooftop railing looking at the evening city lights"],
  [/雨|伞|湿|阴天/, "under an umbrella on a rainy street, puddles reflecting neon lights"],
  [/图书馆|书|作业|题|考试|学习|自习/, "at a desk in the library, textbooks open, looking up from studying"],
  [/画|速写|美术|颜料/, "in the art room holding a sketch pad, pencil behind the ear"],
  [/猫|狗|宠物/, "crouching on a sunny lawn playing with a small pet"],
];

/**
 * 根据最近聊天内容挑一个贴合话题的拍照场景；
 * 没有明显话题时返回空串——此时宁可不发图，也不发莫名其妙的图。
 */
export function matchPhotoScene(text: string): string {
  for (const [re, scene] of SCENE_MATCHERS) {
    if (re.test(text)) return scene;
  }
  return "";
}

/** 主动分享照片时的日常场景池 */
export const PHOTO_SCENES = [
  "after school on the basketball court, slightly sweaty and smiling at the camera",
  "in the passenger seat of a car on a sunny afternoon road trip",
  "at a piano in the school music room, glancing up mid-phrase",
  "holding a bubble tea on a tree-lined street at dusk",
  "on the rooftop railing looking at the evening city lights",
];
