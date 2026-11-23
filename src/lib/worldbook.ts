// 世界书 + 表情包契约与解析逻辑（参考 SullyOS 手册 Part 5/6，含截断兜底）
import JSZip from "jszip";

export interface WorldBook {
  id: string;
  name: string;
  content: string;
  /** global 对所有角色生效；local 需角色绑定 */
  scope: "global" | "local";
  /**
   * 插入深度：0=常驻（每次全文注入）；1=触发（命中关键词才注入，默认）；2=深层（只进目录，AI 请求后展开）
   * 旧存档缺省视为 1
   */
  depth?: 0 | 1 | 2;
  /** 仅 depth=1 使用；空则按正文现算 */
  keywords?: string[];
}

export interface Sticker {
  id: string;
  name: string;
  /** base64 data URL，持久化不失效；不用 blob URL */
  url: string;
  isGlobal: boolean;
}

export type ReplyPart = { type: "text"; content: string } | { type: "sticker"; sticker: Sticker };

/** 某角色实际生效的世界书：全局人人有，局部看绑定 */
export function getActiveWorldBooks(charId: string, all: WorldBook[], boundIds: string[]): WorldBook[] {
  return all.filter((wb) => wb.scope === "global" || (charId && boundIds.includes(wb.id)));
}

const STOP_WORDS = new Set([
  "的", "了", "是", "在", "和", "与", "或", "也", "都", "就", "而", "但", "对", "为", "以", "上", "下", "中",
  "一个", "一些", "没有", "可以", "以及", "并且", "但是", "因为", "所以", "如果", "他们", "她们", "我们",
]);

/** 自动提取触发词：名称整体 + 名称分词 + 正文高频 2~4 字中文词组，去停用词取前 8 */
export function autoKeywords(wb: WorldBook): string[] {
  const out: string[] = [];
  const push = (w: string) => {
    const t = w.trim();
    if (t.length >= 2 && !STOP_WORDS.has(t) && !out.includes(t)) out.push(t);
  };
  const name = wb.name.replace(/^[^·]*·\s*/, "").trim();
  if (name) push(name);
  // 名称里按标点/空格切出的片段
  name.split(/[、，,/\s|｜·]+/).forEach(push);
  // 正文取 2~4 字滑窗统计高频词（优先长窗口）；只统计纯汉字片段，避免混排文本切出 user/use/er 等英文碎片
  const counts = new Map<string, number>();
  const text = wb.content.slice(0, 1200);
  for (const run of text.matchAll(/[\p{Script=Han}]{2,}/gu)) {
    const segs = run[0];
    for (let len = Math.min(4, segs.length); len >= 2; len--) {
      for (let i = 0; i + len <= segs.length; i++) {
        const seg = segs.slice(i, i + len);
        counts.set(seg, (counts.get(seg) ?? 0) + 1);
      }
    }
  }
  [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 8)
    .forEach(([w]) => push(w));
  // 短条目正文无重复词时兜底：把正文开头的短语也作为触发词（否则永远命中不了）
  if (out.length <= 1) {
    const head = (text.match(/[\p{Script=Han}]{2,}/u) ?? [""])[0];
    for (let len = Math.min(4, head.length); len >= 2; len--) push(head.slice(0, len));
  }
  return out.slice(0, 8);
}

/** 条目实际生效的触发词 */
export function effectiveKeywords(wb: WorldBook): string[] {
  const custom = (wb.keywords ?? []).map((k) => k.trim()).filter(Boolean);
  return custom.length ? custom : autoKeywords(wb);
}

/** 回复里的按需查设定标记：[查设定:名字] */
const INTRO_RE = /\[查设定[:：]\s*([^\]]+)\]/g;

/** 拆出 AI 要求的深层条目名并返回去掉标记后的干净文本 */
export function extractIntroRequests(raw: string, books: WorldBook[]): { clean: string; names: string[] } {
  const names: string[] = [];
  const clean = raw
    .replace(INTRO_RE, (_m, name: string) => {
      const t = name.trim();
      if (books.some((b) => b.name === t || b.name.endsWith(`· ${t}`))) names.push(t);
      return "";
    })
    .trim();
  return { clean, names };
}

/**
 * 世界书 V2 注入：常驻全文段 + 命中触发的全文段 + 深层目录段。
 * recentText：最近几条消息拼的文本，用于触发匹配；requestedNames：已被 AI 请求展开的深层条目名。
 */
export function buildWorldSectionV2(
  books: WorldBook[],
  recentText = "",
  requestedNames: string[] = []
): string {
  if (!books.length) return "";
  const lower = recentText.toLowerCase();
  // 关键词子串命中，或关键词与消息存在 ≥2 字公共片段（如"学校设定"↔"在学校"共享"学校"）
  const shares = (a: string, b: string) => {
    for (let len = Math.min(4, a.length); len >= 2; len--) {
      for (let i = 0; i + len <= a.length; i++) if (b.includes(a.slice(i, i + len))) return true;
    }
    return false;
  };
  const hit = (wb: WorldBook) => effectiveKeywords(wb).some((k) => lower.includes(k.toLowerCase()) || shares(k.toLowerCase(), lower));
  const resident = books.filter((b) => (b.depth ?? 1) === 0);
  const triggered = books.filter((b) => (b.depth ?? 1) === 1 && hit(b));
  const deep = books.filter((b) => (b.depth ?? 1) === 2);
  const unlocked = deep.filter((b) => requestedNames.some((n) => b.name === n || b.name.endsWith(`· ${n}`)));
  const catalog = deep.filter((b) => !unlocked.includes(b)).slice(0, 20);

  const full = [...resident, ...triggered, ...unlocked];
  let out = "";
  if (full.length) {
    out +=
      "\n\n【世界设定，仅供你理解背景，不要复述或提及这是“设定”】\n" +
      full.map((wb) => `· ${wb.name}：${wb.content}`).join("\n");
  }
  if (catalog.length) {
    out +=
      `\n\n【更多背景设定目录（正文未展开）】\n` +
      catalog.map((wb) => `· ${wb.name}`).join("\n") +
      `\n若聊天需要其中某条的细节，在回复末尾单独输出 [查设定:条目名]（一字不差），系统会把全文给你；平时不要提这个机制，也不要复述目录。`;
  }
  if (!out) return "";
  console.log(`[worldbook] section resident=${resident.length} triggered=${triggered.length} unlocked=${unlocked.length} catalog=${catalog.length}`);
  return out;
}

/** 兼容旧调用：不带深度信息时等价全量常驻 */
export function buildWorldSection(books: WorldBook[]): string {
  return buildWorldSectionV2(books.map((b) => ({ ...b, depth: 0 as const })));
}

/** docx（浏览器端 ArrayBuffer）→ 分节条目候选：标题样式/加粗行作为节名，其余并入正文 */
export async function parseDocxBuffer(buf: ArrayBuffer, fallbackName: string): Promise<{ name: string; content: string }[]> {
  const zip = await JSZip.loadAsync(buf);
  const entry = zip.file("word/document.xml");
  if (!entry) throw new Error("不是有效的 Word 文档（缺 document.xml）");
  const xml = await entry.async("string");
  const paras: { heading: boolean; bold: boolean; text: string }[] = [];
  for (const pMatch of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const p = pMatch[0];
    const heading = /<w:pStyle[^>]*w:val="(Heading[1-6]|Title)"/i.test(p);
    const text = [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
      .map((m) => m[1])
      .join("")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
    if (!text) continue;
    // 整段唯一 run 且加粗 → 视作小标题
    const runs = [...p.matchAll(/<w:r>[\s\S]*?<\/w:r>/g)];
    const bold = runs.length > 0 && runs.every((r) => /<w:b\b/.test(r[0]));
    paras.push({ heading, bold, text });
  }
  if (!paras.length) throw new Error("文档里没有可导入的文字（可能是扫描件）");
  const titleRe = /^(第[一二三四五六七八九十百\d]+[章节部分篇]|[一二三四五六七八九十]+[、.．]|[§#]+\s*\S+|\d+[、.．]\s*\S+)/;
  const isHead = (x: { heading: boolean; bold: boolean; text: string }) =>
    x.heading || (x.bold && x.text.length <= 30) || titleRe.test(x.text);
  const docTitle = paras.find(isHead)?.text ?? fallbackName;
  const sections: { name: string; content: string }[] = [];
  let cur: { name: string; lines: string[] } | null = null;
  for (const para of paras) {
    if (isHead(para) && para.text !== docTitle) {
      if (cur) sections.push({ name: `${docTitle} · ${cur.name}`, content: cur.lines.join("\n") });
      cur = { name: para.text.replace(/[（(].*?[)）]/g, "").trim(), lines: [] };
    } else if (cur) {
      cur.lines.push(para.text);
    } else if (para.text !== docTitle) {
      cur = { name: "总览", lines: [para.text] };
    }
  }
  if (cur) sections.push({ name: `${docTitle} · ${cur.name}`, content: cur.lines.join("\n") });
  if (!sections.length) sections.push({ name: docTitle, content: paras.map((p) => p.text).join("\n") });
  return sections.map((s) => ({ ...s, content: s.content.length > 2500 ? `${s.content.slice(0, 2500)}…` : s.content }));
}

/** 表情名单提示：说死只能从清单选，选不出就不发 */
export function buildStickerHint(stickers: Sticker[]): string {
  if (!stickers.length) return "（当前没有可用表情，不要发 [表情:xxx] 这种标记）";
  return (
    "如果想发表情，格式是 [表情:名字]。\n" +
    "表情名必须从下面这份清单里一字不差地选，不能自己编，\n" +
    "如果都不合适就不要发表情，用文字表达就好：\n" +
    stickers.map((s) => s.name).join(" / ")
  );
}

const STICKER_RE = /\[表情[:：]\s*([^\]]+)\]/g;

/**
 * 把 AI 回复拆成文字/表情片段。兜底：
 * - 名字不在库里 → 原样当普通文字，不裂图
 * - 结尾出现没闭合的半截标记（输出被截断）→ 丢掉这一段
 */
export function parseReplyToMessages(rawText: string, stickerLib: Sticker[]): ReplyPart[] {
  const parts: ReplyPart[] = [];
  const regex = new RegExp(STICKER_RE.source, "g");
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(rawText)) !== null) {
    const before = rawText.slice(lastIndex, match.index).trim();
    if (before) parts.push({ type: "text", content: before });
    const name = match[1].trim();
    const sticker = stickerLib.find((s) => s.name === name);
    if (sticker) parts.push({ type: "sticker", sticker });
    else parts.push({ type: "text", content: match[0] });
    lastIndex = regex.lastIndex;
  }
  let rest = rawText.slice(lastIndex).trim();
  // 截断兜底：结尾残留未闭合的 [表情:xxx 直接丢弃
  const open = rest.lastIndexOf("[表情");
  if (open >= 0 && !rest.slice(open).includes("]")) rest = rest.slice(0, open).trim();
  if (rest) parts.push({ type: "text", content: rest });
  return parts;
}
