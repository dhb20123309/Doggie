// 热梗世界书数据层：《网上冲浪·热梗世界书》by年年（300条）结构化 + 触发词扫描注入
// 边界：只提供"命中条目→prompt 片段"的纯函数与预置数据；不改现有 buildSys 结构，由调用方拼接。

export interface MemeEntry {
  title: string;
  /** 触发词（含梗名本身），小写匹配 */
  keys: string[];
  /** 用法说明（原文"触发内容"） */
  usage: string;
  /** 可选示例对：对方→角色 */
  demo?: [string, string];
}

/**
 * 原始文本格式（与 docx 一致）：
 *   标题：X
 *   触发词：a, b, c
 *   触发内容：Y（可多行，直到下一个标记）
 *   对方：Z（可选）
 *   角色：W（可选）
 */
export function parseMemeBook(raw: string): MemeEntry[] {
  const lines = raw.split(/\r?\n/);
  const entries: MemeEntry[] = [];
  let cur: (Partial<MemeEntry> & { demoA?: string; demoB?: string }) | null = null;
  let field: "usage" | "demo-a" | "demo-b" | null = null;
  const flush = () => {
    if (cur?.title && cur.usage) {
      entries.push({
        title: cur.title,
        keys: cur.keys ?? [],
        usage: cur.usage.trim(),
        demo: cur.demoA && cur.demoB ? [cur.demoA.trim(), cur.demoB.trim()] : undefined,
      });
    }
    cur = null;
    field = null;
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^标题[:：]\s*(.+)$/))) {
      flush();
      cur = { title: m[1].trim() };
      field = null;
      continue;
    }
    if (!cur) continue; // 前言（书名/简介行）丢弃
    if ((m = line.match(/^触发词[:：]\s*(.+)$/))) {
      cur.keys = m[1]
        .split(/[,，、]/)
        .map((s) => s.trim())
        .filter(Boolean);
      field = null;
      continue;
    }
    if ((m = line.match(/^触发内容[:：]\s*(.*)$/))) {
      cur.usage = m[1] ?? "";
      field = "usage";
      continue;
    }
    if ((m = line.match(/^对方[:：]\s*(.*)$/))) {
      cur.demoA = m[1] ?? "";
      field = "demo-a";
      continue;
    }
    if ((m = line.match(/^角色[:：]\s*(.*)$/))) {
      cur.demoB = m[1] ?? "";
      field = "demo-b";
      continue;
    }
    // 无标记续行：归入当前字段
    if (field === "usage") cur.usage = `${cur.usage ?? ""}\n${line}`;
    else if (field === "demo-a") cur.demoA = `${cur.demoA ?? ""}\n${line}`;
    else if (field === "demo-b") cur.demoB = `${cur.demoB ?? ""}\n${line}`;
  }
  flush();
  return entries;
}

/** 扫描用户最近消息：命中触发词（梗名或场景词）即返回对应条目 */
export function matchMemes(userText: string, book: MemeEntry[], limit = 4): MemeEntry[] {
  const t = userText.toLowerCase();
  const hits: MemeEntry[] = [];
  for (const e of book) {
    if (e.keys.some((k) => k.length >= 2 && t.includes(k.toLowerCase()))) {
      hits.push(e);
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

/** 热梗开关 + 全量常驻注入（存 vp-phone:memebook:prefs:v1） */
export interface MemePrefs {
  enabled: boolean;
  /** true=300条梗名摘要常驻 system；false=只在触发词命中时注入具体条目（省 token，默认） */
  alwaysInject: boolean;
}
export const DEFAULT_MEME_PREFS: MemePrefs = { enabled: true, alwaysInject: false };

/** 按偏好拼热梗 prompt 片段：关闭返回空串；未命中且非全量模式也返回空串 */
export function buildMemeSection(
  userText: string,
  book: MemeEntry[],
  prefs: MemePrefs,
  digestCache: { src?: MemeEntry[]; text?: string }
): string {
  if (!prefs.enabled || !book.length) return "";
  if (prefs.alwaysInject) {
    if (digestCache.src !== book) {
      digestCache.src = book;
      digestCache.text = buildMemeDigest(book);
    }
    return digestCache.text ?? "";
  }
  return buildMemeHint(matchMemes(userText, book));
}

/** 命中条目拼成 prompt 片段：接得住才接、不许硬塞；未命中返回空串 */
export function buildMemeHint(hits: MemeEntry[]): string {
  if (!hits.length) return "";
  const list = hits
    .map((e) => {
      const demo = e.demo ? `\n示例——对方：${e.demo[0]}｜你：${e.demo[1]}` : "";
      return `· 「${e.title}」：${e.usage}${demo}`;
    })
    .join("\n");
  return (
    "\n\n【网上冲浪热梗参考】对方这句话可能触发了下面的网络梗。气氛合适就自然地接一个（用你自己的说话习惯，可只取梗的一部分），" +
    "气氛不对或对方在说正经事就当没看见，严禁生硬堆梗、严禁解释梗的出处：\n" +
    list
  );
}

/** 整本压缩为常驻知识（用户手动开启"全量注入"时用）：只留梗名+一句话用法 */
export function buildMemeDigest(book: MemeEntry[]): string {
  return (
    "\n\n【你会的网络热梗清单（知道≠要用，只在气氛合适时偶尔接一两个）】\n" +
    book.map((e) => `${e.title}：${e.usage.replace(/\s+/g, " ").slice(0, 40)}`).join("\n")
  );
}
