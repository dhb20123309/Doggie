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
  // 2) 纯文本按行（主通道）：每行一个 mp3 直链，或 "歌名|URL" / "歌名 - URL"
  const tracks: MusicTrack[] = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith("//") || l.startsWith("#")) continue;
    const m = l.match(/^(.*?)[|\t]\s*(https?:\/\/\S+)$/) ?? l.match(/^(.*?)\s+-\s+(https?:\/\/\S+)$/);
    if (m) tracks.push({ title: m[1].trim() || `曲目 ${tracks.length + 1}`, url: m[2] });
    else if (/^https?:\/\//.test(l)) tracks.push({ title: `曲目 ${tracks.length + 1}`, url: l });
  }
  if (tracks.length) return tracks;
  // 3) 单行裸链接兜底
  if (/^https?:\/\//.test(text)) return [{ title: "曲目 1", url: text }];
  return [];
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

/**
 * 「gpt生图指令」by朝汐屿（用户 docx 全文收录）：第一人称俯拍日常照协议。
 * 正面提示词作为照片 prompt 骨架，负面提示词随模型能力附带（见 tryOpenAIImages）。
 */
export const PHOTO_STYLE_POSITIVE =
  "First-person POV, looking down at own body, strictly cropped shot from collarbone down, headless framing, faceless, selfie POV, the character is holding the phone themselves to take a casual photo, 3D real-world, everyday real-life atmosphere, Instagram lifestyle aesthetic, luxurious and wealthy vibe. Natural lighting, warm light or cool light, unfixed color tone. Slim and well-proportioned figure, not bulky, accurate human anatomy and correct body proportions, natural and relaxed posture. Clothing is unfixed, appropriately matching the season, unfixed colors, not always black, high-end texture. Food and scenes are unfixed, can be a pure food shot or scenery shot with no character in frame (focusing entirely on the food or view, strictly no character's body), or a lifestyle shot with the character's lower body present, but if any part of the character's body appears, it must be strictly confined to a small corner of the frame, no large-scale prominence of the character's body, the composition must focus primarily on the food and scenery. Food is not the main focus and not fixed, high-end cuisine or everyday casual food / takeout / junk food, occupying about a quarter of the frame, small and non-prominent, no close-up shots, surrounded by a natural daily-life environment. Scene is everyday-life yet elegant, unfixed setting, luxury setting or natural everyday scene. If a hand appears, it must be slender with defined knuckles, visible veins allowed, natural and not deliberately posed, no scars, no accessories unless specified. Real photographic quality, film grain, highly detailed.";

export const PHOTO_STYLE_NEGATIVE =
  "Head, face, neck, chin, mouth, nose, eyes, upper chest above collarbone, looking at camera, full body shot, third-person shooting, photographed by others, side profile, any action involving the head, mirror selfie, phone in frame, character in pure food or scenery shot, photographer visible, two hands, deliberate posing, unnatural posture, twisted body, distorted limbs, deformed anatomy, incorrect body proportions, bad anatomy, bulky body, scars, random accessories, close-up food shot, oversized food, food as main subject, smoke, AI look, anime style, plastic feel, fake feel, fake textures, over-editing, low resolution, blurry, distortion, clipping, mesh interpenetration, extra limbs, text, watermark, always black clothes, single outfit, inappropriate clothing for the season, large-scale prominent character body, character body dominating the frame, character body as main subject.";

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
  // pollinations 支持负面提示词，与协议同步带上
  params.set("negative_prompt", PHOTO_STYLE_NEGATIVE.slice(0, 800));
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
  fallbackUrl: string,
  /** 角色绑定的生图模型（Character.imageModel）；留空=跟随全局生图配置 */
  charModel?: string
): Promise<string> {
  const ic = loadImageConfig();
  // 角色级模型覆盖：TA 分享日常照片时优先用自己绑定的模型
  const model = charModel?.trim() || ic.model;
  // ① 独立通道：pollinations 免 Key 直链
  if (ic.mode === "pollinations") {
    try {
      const url = await fetchPollinations(prompt, 768, 1024, model);
      if (url) return url;
    } catch {
      /* 继续下一通道 */
    }
  }
  // ①' 独立通道：自定义 OpenAI 兼容网关
  if (ic.mode === "openai" && ic.baseUrl.trim()) {
    const url = await tryOpenAIImages(ic.baseUrl.trim(), ic.apiKey.trim() || cfg.apiKey.trim(), model, prompt);
    if (url) return url;
  }
  // ② 回落聊天接口网关
  const base = normalizeBaseUrl(cfg.baseUrl);
  const key = cfg.apiKey.trim();
  if (base && key) {
    const url = await tryOpenAIImages(base, key, model, prompt);
    if (url) return url;
  }
  return fallbackUrl;
}

/**
 * 被动要照片专用：与 generateCharPhoto 同四级通道，但**全失败返回空串**（不塞定妆照）——
 * 无生图额度/网关报错时角色只回文字，不会硬发一张假照糊弄用户。
 */
export async function generateCharPhotoSafe(
  cfg: { baseUrl: string; apiKey: string },
  prompt: string,
  charModel?: string
): Promise<string> {
  const ic = loadImageConfig();
  const model = charModel?.trim() || ic.model;
  if (ic.mode === "pollinations") {
    try {
      const url = await fetchPollinations(prompt, 768, 1024, model);
      if (url) return url;
    } catch {
      /* 继续下一通道 */
    }
  }
  if (ic.baseUrl.trim()) {
    const url = await tryOpenAIImages(ic.baseUrl.trim(), ic.apiKey.trim() || cfg.apiKey.trim(), model, prompt);
    if (url) return url;
  }
  const base = normalizeBaseUrl(cfg.baseUrl);
  const key = cfg.apiKey.trim();
  if (base && key) {
    const url = await tryOpenAIImages(base, key, model, prompt);
    if (url) return url;
  }
  return "";
}

/**
 * 真实生图连接测试：向 /images/generations 发一次最小生图请求（小尺寸、固定测试句），
 * 能出图才算通过——不再复用聊天接口的 testConnection，避免拿聊天模型撞生图网关的误导报错。
 * ⚠️ 会实际消耗一次生图额度。
 */
export async function testImageChannel(
  ic: ImageConfig,
  fallbackCfg: { baseUrl: string; apiKey: string }
): Promise<{ ok: boolean; detail: string; ms: number }> {
  const t0 = Date.now();
  const model = ic.model.trim() || DEFAULT_IMAGE_CONFIG.model;
  if (ic.mode === "pollinations") {
    try {
      const url = await fetchPollinations("a small red apple on a white table, simple photo", 256, 256, ic.model);
      const ms = Date.now() - t0;
      console.log(`[image] channel test ${url ? "ok" : "fail"} mode=pollinations ms=${ms}`);
      return url ? { ok: true, detail: `免费网关出图成功`, ms } : { ok: false, detail: "免费网关未返回图片，可能暂时不可用", ms };
    } catch (e) {
      const ms = Date.now() - t0;
      console.warn("[image] channel test threw mode=pollinations:", e);
      return { ok: false, detail: e instanceof Error ? e.message : "网络请求失败", ms };
    }
  }
  const base = ic.baseUrl.trim() || fallbackCfg.baseUrl;
  const key = ic.apiKey.trim() || fallbackCfg.apiKey;
  if (!normalizeBaseUrl(base)) return { ok: false, detail: "请先填写生图地址（或先在上方配置聊天接口以启用回落）", ms: 0 };
  const norm = normalizeBaseUrl(base);
  const candidates = /\/v\d+$/.test(norm) ? [norm] : [norm, `${norm}/v1`];
  const isGptImage = /^gpt-image/i.test(model);
  let lastErr = "";
  for (const url of candidates) {
    try {
      const res = await fetch(`${url}/images/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({
          prompt: "A tiny red apple on a plain white table, simple product photo",
          n: 1,
          size: isGptImage ? "1024x1024" : "512x512",
          response_format: "b64_json",
          model,
        }),
      });
      if (res.status === 401 || res.status === 403) {
        const ms = Date.now() - t0;
        console.warn(`[image] channel test fail status=${res.status} auth model=${model}`);
        return { ok: false, detail: `密钥无效（${res.status}）：请检查 API Key 是否属于该站点`, ms };
      }
      if (res.status === 404) {
        lastErr = "该地址下找不到生图接口（404），确认站点是否提供 /images/generations";
        continue;
      }
      if (!res.ok) {
        // 透传网关错误信息（如"模型无可用渠道"），人话化展示
        const json = await res.json().catch(() => null);
        const msg = json?.error?.message || json?.message || `服务返回 ${res.status}`;
        const ms = Date.now() - t0;
        console.warn(`[image] channel test fail status=${res.status} model=${model} msg=${msg}`);
        return { ok: false, detail: `生图请求失败：${msg}`, ms };
      }
      const json = await res.json().catch(() => null);
      const item = json?.data?.[0];
      const ms = Date.now() - t0;
      if (item?.url || item?.b64_json) {
        console.log(`[image] channel test ok model=${model} ms=${ms}`);
        return { ok: true, detail: `「${model}」出图成功`, ms };
      }
      lastErr = "接口返回了空结果，换模型再试";
    } catch (e) {
      lastErr = e instanceof Error ? `无法连接该地址（${e.message}）` : "网络请求失败";
    }
  }
  const ms = Date.now() - t0;
  console.warn(`[image] channel test fail model=${model} detail=${lastErr}`);
  return { ok: false, detail: lastErr, ms };
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
        // 负面提示词随请求透传：官方 gpt-image 会忽略未知字段，中转网关常支持 negative_prompt
        body: JSON.stringify({ prompt, n: 1, size, response_format: "b64_json", negative_prompt: PHOTO_STYLE_NEGATIVE, ...(model.trim() ? { model: model.trim() } : {}) }),
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

/** 按人设拼写实照片提示词：套用「gpt生图指令」by朝汐屿（第一人称俯拍、不露脸的生活照协议），场景与人设特征作为变量注入 */
export function photoPrompt(charName: string, persona: string, scene: string): string {
  // 人设全量注入（原截 160 字符常把穿着/习惯部分切掉，导致服装不贴人设）；仅压掉换行防破坏提示词结构
  const traits = persona.replace(/\s+/g, " ").trim().slice(0, 600);
  // 指令原文要求构图以食物/风景为主、身体只入一角，故把话题场景写成画面主体
  return [
    PHOTO_STYLE_POSITIVE,
    `Subject context: this photo is taken by ${charName} themselves.`,
    `Character persona (outfit style, habits, lifestyle and props in the frame must stay consistent with this; never contradict it): ${traits}`,
    scene ? `Today's moment: ${scene}.` : "",
    "Outfit, carried items and environment details should read as this exact character's daily life while keeping the strict headless first-person composition above.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** 负面提示词：官方 gpt-image 系列无 negative_prompt 字段，仅中转/兼容网关透传 */
export const PHOTO_NEGATIVE_PROMPT = PHOTO_STYLE_NEGATIVE;

/** 场景关键词 → 英文拍摄主体：套用「gpt生图指令」的俯拍不露脸协议，场景必须是画面主体（食物/风景为主、身体只入一角），不能出现看镜头等冲突描述 */
const SCENE_MATCHERS: [RegExp, string][] = [
  [/球|赛|运动|锻炼|健身|操场/, "looking down at the basketball spinning in hand on the outdoor court, court lines and water bottle in frame"],
  [/琴|钢琴|排练|音乐|歌|演奏|曲子/, "hands resting on piano keys mid-rehearsal, sheet music on the stand filling the frame"],
  [/奶茶|咖啡|吃|喝|饭|餐|零食|外卖|饿/, "an overhead view of a bubble tea and small snacks on a table, one hand reaching for the cup"],
  [/车|兜风|路|旅行|高速|自驾/, "first-person view from the passenger seat, road ahead through the windshield and a hand on the door"],
  [/夜|晚|月亮|星星|灯|天台|风景/, "looking down over a rooftop railing at evening city lights far below"],
  [/雨|伞|湿|阴天/, "pointing down at puddles reflecting neon lights under an umbrella tip entering the frame corner"],
  [/图书馆|书|作业|题|考试|学习|自习/, "overhead view of open textbooks and notes on a library desk, pen held in one hand"],
  [/画|速写|美术|颜料/, "looking down at a half-finished sketch on a drawing pad in the art room, paint tubes nearby"],
  [/猫|狗|宠物/, "a small pet curled on a sunny lawn filling most of the frame, one hand petting it"],
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

/** 主动分享照片时的日常场景池（与 SCENE_MATCHERS 同口径：俯拍主体、不露脸） */
export const PHOTO_SCENES = [
  "looking down at the basketball spinning in hand on the outdoor court, court lines and water bottle in frame",
  "first-person view from the passenger seat, road ahead through the windshield and a hand on the door",
  "hands resting on piano keys mid-rehearsal, sheet music on the stand filling the frame",
  "an overhead view of a bubble tea and small snacks on a table, one hand reaching for the cup",
  "looking down over a rooftop railing at evening city lights far below",
];
