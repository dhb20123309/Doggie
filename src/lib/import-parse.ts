// 角色卡 / 世界书 Markdown 一键导入解析：提取标题、正文分节，产出 Character / WorldBook
import type { Character } from "./chat-types";
import type { WorldBook } from "./worldbook";

export interface ParsedCard {
  name: string;
  persona: string;
}

/** 从 md 首个一级标题提取角色名：「# 角色卡｜周晨砚（哥哥）」→ 周晨砚 */
function extractName(md: string): string {
  const h1 = md.match(/^#\s+(.+)$/m)?.[1] ?? "";
  const after = h1.split(/[|｜]/).pop() ?? h1;
  // 去掉括号说明与"角色卡"前缀残留
  const cleaned = after.replace(/[（(].*?[)）]/g, "").replace(/角色卡|弟弟|哥哥/g, "").trim();
  return cleaned || "未命名角色";
}

/** 人设正文：保留 [System Note] 起的全部设定；若超长截断到 6000 字以内防 prompt 爆炸 */
export function parseCharacterCard(md: string): ParsedCard {
  const start = md.indexOf("[System Note]");
  const body = start >= 0 ? md.slice(start) : md.replace(/^#.*$/m, "").trim();
  const persona = body.length > 6000 ? `${body.slice(0, 6000)}\n（设定过长已截断）` : body;
  return { name: extractName(md), persona };
}

/** 世界书 md → 若干条目：按二级标题分节，每节一条 local 设定；整体也提供单条模式 */
export function parseWorldBookMd(md: string, fallbackName: string): Omit<WorldBook, "id">[] {
  const titleMatch = md.match(/^#\s+(.+)$/m);
  const baseName = (titleMatch?.[1] ?? fallbackName).split(/[|｜]/).pop()?.trim() || fallbackName;
  const sections = md.split(/^##\s+/m).slice(1);
  if (!sections.length) {
    const content = md.replace(/^#.*$/m, "").trim();
    return [{ name: baseName, content, scope: "local" }];
  }
  return sections.map((sec) => {
    const nl = sec.indexOf("\n");
    const head = (nl > 0 ? sec.slice(0, nl) : sec).replace(/[（(].*?[)）]/g, "").trim();
    const body = (nl > 0 ? sec.slice(nl + 1) : "").trim();
    return {
      name: `${baseName} · ${head}`,
      content: body.length > 2500 ? `${body.slice(0, 2500)}…` : body,
      scope: "local" as const,
    };
  });
}

/** 生成不重复的角色 id */
export function makeCharId(name: string): string {
  const slug = name.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase();
  return `c-${slug || "char"}-${Date.now().toString(36)}`;
}

/** 导入卡片为完整 Character（默认开主动消息与照片，音色留空待绑定） */
export function cardToCharacter(parsed: ParsedCard, boundWorldBookIds: string[]): Character {
  return {
    id: makeCharId(parsed.name),
    name: parsed.name,
    avatar: "🎭",
    persona: parsed.persona,
    boundWorldBookIds,
    photoEnabled: true,
    proactiveEnabled: true,
  };
}
