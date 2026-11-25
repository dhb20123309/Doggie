// 表情包广场：兼容 AstrBot meme pack 开放协议（astrbot_plugin_meme_manager / astrbot-meme-pack-index）
// 纯前端直连 GitHub raw，无需任何部署——所有使用者打开即用；安装即把图片转 data URL 落入本地表情库，
// 与自建表情包共用同一套 [表情:名字] 链路（模型名单、点选发送、渲染全部零改动复用）。

export interface SquarePack {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  /** GitHub 源：repo=owner/name, ref=分支, subpath=包根目录 */
  source: { repo: string; ref: string; subpath: string };
}

export interface PackCategory {
  key: string; // memes/ 下目录名
  label: string; // 中文展示名
  description?: string;
}

export interface PackImage {
  path: string; // 相对包根的路径，如 memes/happy/s5-79.png
  catKey: string;
  fileName: string;
}

/** 分类目录名 → 中文名（清单外按原样显示） */
const CAT_CN: Record<string, string> = {
  angry: "生气", baka: "笨蛋", color: "暧昧", confused: "困惑", cpu: "宕机", fool: "自嘲",
  givemoney: "要钱", happy: "开心", like: "喜欢", meow: "卖萌", morning: "早安", reply: "等回复",
  sad: "难过", see: "偷瞄", shy: "害羞", sigh: "叹气", sleep: "睡觉", surprised: "惊讶", work: "工作",
  smile: "微笑", cry: "哭", love: "爱心", greet: "打招呼", bye: "再见", thanks: "谢谢",
  ok: "好的", no: "拒绝", think: "思考", eat: "干饭", game: "游戏", study: "学习",
};
export const catLabel = (key: string): string => CAT_CN[key] ?? key;

/** 官方示例包（社区索引仓库当前未收录条目，此包为协议参考实现、内容稳定） */
export const BUILTIN_SQUARE_PACKS: SquarePack[] = [
  {
    id: "meme-example",
    name: "通用聊天表情（官方示例包）",
    description: "AstrBot 表情包协议官方示例：20 个日常分类，适合通用聊天场景。",
    tags: ["funny", "anime", "daily"],
    source: { repo: "anka-afk/astrbot-meme-pack-example", ref: "main", subpath: "." },
  },
];

const INDEX_URL = "https://raw.githubusercontent.com/anka-afk/astrbot-meme-pack-index/main/community-index.json";

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** 拉取社区索引里的公开表情包（GitHub API 限流或格式异常时静默返回空，内置包不受影响） */
export async function fetchCommunityPacks(): Promise<SquarePack[]> {
  try {
    const j = (await fetchJson(INDEX_URL)) as { packs?: unknown[] };
    const out: SquarePack[] = [];
    for (const p of j.packs ?? []) {
      const o = p as Partial<SquarePack> & { source?: { type?: string; repo?: string; ref?: string; subpath?: string } };
      if (!o.id || !o.name || o.source?.type !== "github" || !o.source.repo) continue;
      out.push({
        id: o.id,
        name: o.name,
        description: o.description,
        tags: Array.isArray(o.tags) ? o.tags.slice(0, 6) : undefined,
        source: { repo: o.source.repo, ref: o.source.ref || "main", subpath: o.source.subpath || "." },
      });
    }
    console.log(`[meme-square] community packs n=${out.length}`);
    return out;
  } catch (e) {
    console.log(`[meme-square] community index unavailable: ${(e as Error).message}`);
    return [];
  }
}

/** 自定义仓库地址解析：支持 owner/repo、github.com 链接、可选子目录 */
export function parseRepoInput(text: string): { repo: string; subpath: string } | null {
  let t = text.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, "");
  t = t.replace(/\.git$/i, "").replace(/\/+$/, "");
  const m = t.match(/^([\w.-]+)\/([\w.-]+)(?:\/tree\/[\w.-]+)?(?:\/(.+))?$/);
  if (!m) return null;
  return { repo: `${m[1]}/${m[2]}`, subpath: m[3] ? `/${m[3].replace(/\/+$/, "")}` : "" };
}

const rawBase = (src: SquarePack["source"]) =>
  `https://raw.githubusercontent.com/${src.repo}/${src.ref}${src.subpath === "." ? "" : src.subpath}`;
const apiBase = (src: SquarePack["source"]) =>
  `https://api.github.com/repos/${src.repo}/contents${src.subpath === "." ? "" : src.subpath}`;

/** jsDelivr CDN 镜像兜底（raw.githubusercontent 在部分地区直连不稳；jsdelivr 带 CORS、纯静态免限流） */
const cdnBase = (src: SquarePack["source"]) =>
  `https://cdn.jsdelivr.net/gh/${src.repo}@${src.ref}${src.subpath === "." ? "" : src.subpath}`;

/** GET JSON：主源失败自动换镜像；两路都挂才抛错 */
async function fetchJsonMirrored(rawUrl: string, cdnUrl: string): Promise<unknown> {
  try {
    return await fetchJson(rawUrl);
  } catch (e) {
    console.log(`[meme-square] primary fetch failed (${(e as Error).message}), retry via cdn`);
    return fetchJson(cdnUrl);
  }
}

export async function fetchPackManifest(src: SquarePack["source"]): Promise<{
  name?: string; description?: string; categories: PackCategory[];
}> {
  const man = (await fetchJsonMirrored(`${rawBase(src)}/manifest.json`, `${cdnBase(src)}/manifest.json`)) as {
    name?: string; description?: string; categories?: Record<string, { description?: string }>;
  };
  const categories = Object.entries(man.categories ?? {}).map(([key, v]) => ({
    key, label: catLabel(key), description: v?.description,
  }));
  return { name: man.name, description: man.description, categories };
}

/** 列包内图片：优先 Contents API（一次拿全树），限流则回落逐分类列举 */
export async function listPackImages(src: SquarePack["source"], cats: PackCategory[]): Promise<PackImage[]> {
  const out: PackImage[] = [];
  const isImg = (n: string) => /\.(png|jpe?g|webp|gif)$/i.test(n);
  try {
    const tree = (await fetchJson(`${apiBase(src)}?ref=${src.ref}&recursive=true`)) as
      | { type: string; path: string }[]
      | { entries?: { type: string; path: string }[] };
    const items = Array.isArray(tree) ? tree : tree.entries ?? [];
    for (const it of items) {
      if (it.type !== "file" || !isImg(it.path)) continue;
      const mm = it.path.match(/^memes\/([^/]+)\/([^/]+)$/);
      if (mm && cats.some((c) => c.key === mm[1])) out.push({ path: it.path, catKey: mm[1], fileName: mm[2] });
    }
    if (out.length) return out;
  } catch {
    /* 回落逐分类 */
  }
  for (const c of cats) {
    try {
      const files = (await fetchJson(`${apiBase(src)}/memes/${c.key}?ref=${src.ref}`)) as { type: string; name: string }[];
      for (const f of files) if (f.type === "file" && isImg(f.name)) out.push({ path: `memes/${c.key}/${f.name}`, catKey: c.key, fileName: f.name });
    } catch {
      /* 该分类缺失就跳过 */
    }
  }
  return out;
}

/** 下载单图转 data URL；主源失败换 jsDelivr 镜像。顺手压到 180KB 内，防 localStorage 配额爆 */
export async function downloadAsDataUrl(src: SquarePack["source"], path: string): Promise<string> {
  let blob: Blob | null = null;
  for (const url of [`${rawBase(src)}/${path}`, `${cdnBase(src)}/${path}`]) {
    try {
      const res = await fetch(url);
      if (res.ok) { blob = await res.blob(); break; }
    } catch {
      /* 换下一路 */
    }
  }
  if (!blob) throw new Error("download failed");
  const raw = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("read fail"));
    r.readAsDataURL(blob);
  });
  if (raw.length < 180_000 || !/^data:image\/(png|jpeg)/.test(raw)) return raw;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = raw;
    });
    const maxSide = 480;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext("2d");
    if (!ctx) return raw;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.82, 0.65, 0.5]) {
      const out = c.toDataURL("image/jpeg", q);
      if (out.length < 180_000) return out;
    }
    return raw;
  } catch {
    return raw; // gif/透明图等压缩失败保留原样
  }
}

export interface InstallProgress {
  done: number;
  total: number;
  current?: string;
}

export interface InstallResult {
  added: number;
  skipped: number;
  failed: number;
  names: string[];
}

/**
 * 安装一个包到本地表情库：并发 4 下载、逐个转 data URL。
 * 名字规则「分类中文标签·文件名去扩展」，与库中已有重名即跳过（幂等，重复安装不翻倍）。
 * onBatch：每攒够 batchEvery 张回调一次已装 Sticker 数组，由调用方增量落库（防 localStorage 爆 + 进度可视）。
 */
export async function installPack<T extends { name: string }>(
  pack: SquarePack,
  existingNames: Set<string>,
  opts: {
    maxPerCat?: number;
    batchEvery?: number;
    onProgress?: (p: InstallProgress) => void;
    onBatch: (stickers: T[]) => void;
    makeSticker: (name: string, url: string) => T;
  }
): Promise<InstallResult> {
  const { maxPerCat = 8, batchEvery = 12 } = opts;
  const manifest = await fetchPackManifest(pack.source);
  const cats = manifest.categories.length ? manifest.categories : [];
  if (!cats.length) throw new Error("这个包的 manifest.json 里没有分类信息");
  const images = await listPackImages(pack.source, cats);
  if (!images.length) throw new Error("没找到可安装的表情图片（memes/ 目录为空？）");
  const perCat = new Map<string, number>();
  const queue = images.filter((im) => {
    const n = (perCat.get(im.catKey) ?? 0) + 1;
    perCat.set(im.catKey, n);
    return n <= maxPerCat;
  });
  const result: InstallResult = { added: 0, skipped: 0, failed: 0, names: [] };
  let batch: T[] = [];
  let done = 0;
  const worker = async (startIdx: number) => {
    for (let i = startIdx; i < queue.length; i += 4) {
      const im = queue[i];
      const name = `${catLabel(im.catKey)}·${im.fileName.replace(/\.[^.]+$/, "")}`;
      opts.onProgress?.({ done, total: queue.length, current: name });
      if (existingNames.has(name)) {
        result.skipped++;
      } else {
        try {
          const url = await downloadAsDataUrl(pack.source, im.path);
          batch.push(opts.makeSticker(name, url));
          existingNames.add(name);
          result.names.push(name);
        } catch {
          result.failed++;
        }
      }
      done++;
      if (batch.length >= batchEvery) {
        opts.onBatch(batch);
        batch = [];
      }
    }
  };
  await Promise.all([0, 1, 2, 3].map((k) => worker(k)));
  if (batch.length) opts.onBatch(batch);
  opts.onProgress?.({ done: queue.length, total: queue.length });
  console.log(`[meme-square] install ${pack.id} added=${result.added || result.names.length} skip=${result.skipped} fail=${result.failed}`);
  result.added = result.names.length;
  return result;
}
