// 世界书 + 表情包契约与解析逻辑（参考 SullyOS 手册 Part 5/6，含截断兜底）

export interface WorldBook {
  id: string;
  name: string;
  content: string;
  /** global 对所有角色生效；local 需角色绑定 */
  scope: "global" | "local";
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

/** 世界书拼进 system prompt，明确告知 AI 这是设定不是对话 */
export function buildWorldSection(books: WorldBook[]): string {
  if (!books.length) return "";
  return (
    "\n\n【世界设定，仅供你理解背景，不要复述或提及这是“设定”】\n" +
    books.map((wb) => `· ${wb.name}：${wb.content}`).join("\n")
  );
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
