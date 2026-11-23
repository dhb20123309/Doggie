// 面具（独立世界线关系包）：只定义【玩家与该角色之间的背景、过往、二人关系、感情基调】。
// ⚠️ 约束区分：基础人设 persona、世界书规则是全局固定所有面具共用；面具内容作为"平行世界线假设"
//    追加进 system，绝不覆盖角色本身人格与底层规则。同一时间每个角色只启用一个面具，其余不注入。
import { readLastEntries } from "./chat-store";
import type { Character, ChatEntry } from "./chat-types";

export interface Mask {
  id: string;
  /** 面具名称（玩家自由填写） */
  name: string;
  /** 关系背景：二人之间的过往、相识方式、当前处境 */
  background: string;
  /** 感情基调：这段关系的走向与情绪底色 */
  tone: string;
  /** 默认面具不可删除，仅可修改 */
  isDefault?: boolean;
}

const MASK_PREFIX = "vp-phone:masks:"; // + charId → Mask[]
const ACTIVE_PREFIX = "vp-phone:mask-active:"; // + charId → maskId
export const MASK_MAX = 12;

function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "") as T;
  } catch {
    return fallback;
  }
}

/** 默认面具的关系背景种子：从角色卡里摘"与{{user}}/你"相关的句子拼成过往梗概，找不到给通用兜底 */
function seedBackground(ch: Character): string {
  const lines = (ch.persona || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const hits = lines.filter((l) => /\{\{user\}\}|与你|和你的|你们|用户/.test(l)).slice(0, 6);
  if (!hits.length) return `你与${ch.name || "TA"}正在保持密切的日常联系，彼此熟悉对方的说话方式与生活节奏。`;
  return hits.join("；");
}

/** 读取某角色的面具列表；首次访问自动落盘一份由角色卡推导的默认面具（不可删、可编辑） */
export function loadMasks(charId: string, ch?: Character): Mask[] {
  const key = `${MASK_PREFIX}${charId}`;
  const saved = read<Mask[]>(key, []);
  const list = Array.isArray(saved) ? saved.filter((m) => m && typeof m.id === "string") : [];
  if (list.some((m) => m.isDefault)) return list;
  const def: Mask = {
    id: "mask-default",
    name: "默认关系",
    background: ch ? seedBackground(ch) : "",
    tone: ch ? `延续角色卡中与${ch.name || "TA"}既有的相处模式与感情走向` : "",
    isDefault: true,
  };
  const next = [def, ...list];
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* 隐私模式忽略 */
  }
  console.log(`[mask] seed default char=${charId}`);
  return next;
}

export function saveMasks(charId: string, masks: Mask[]): void {
  try {
    localStorage.setItem(`${MASK_PREFIX}${charId}`, JSON.stringify(masks));
  } catch {
    /* 隐私模式忽略 */
  }
}

/** 当前启用的面具 id；未设置或指向已删除的面具时回落默认面具 */
export function getActiveMaskId(charId: string): string {
  const id = read<string>(`${ACTIVE_PREFIX}${charId}`, "mask-default");
  return typeof id === "string" && id ? id : "mask-default";
}

export function setActiveMaskId(charId: string, maskId: string): void {
  try {
    localStorage.setItem(`${ACTIVE_PREFIX}${charId}`, JSON.stringify(maskId));
  } catch {
    /* 隐私模式忽略 */
  }
  console.log(`[mask] active char=${charId} → ${maskId}`);
}

/** 取当前生效面具（每次现算同步读存储——切换/修改后立刻反映最新版本，旧版本不再命中） */
export function getActiveMask(charId: string, ch?: Character): Mask | null {
  const masks = loadMasks(charId, ch);
  const activeId = getActiveMaskId(charId);
  return masks.find((m) => m.id === activeId) ?? masks.find((m) => m.isDefault) ?? null;
}

/** 面具摘要：列表卡预览用（名称+背景首句截断） */
export function maskPreview(m: Mask): string {
  const first = (m.background || "").split(/[。！？!?\n]/)[0]?.trim() || "";
  const text = first ? `${first}。` : m.tone || "（尚未填写内容）";
  return text.length > 42 ? `${text.slice(0, 42)}…` : text;
}

/** 注入 system 的面具片段：空面具/无内容返回空串。
 *  措辞刻意定位为"平行世界线假设"——只改二人关系与过往，不改角色人格与世界底层规则。 */
export function buildMaskSection(m: Mask | null): string {
  if (!m) return "";
  const bg = (m.background || "").trim();
  const tone = (m.tone || "").trim();
  if (!bg && !tone) return "";
  return (
    `\n【当前世界线面具「${m.name || "未命名"}」· 只定义你和TA之间的关系】\n` +
    (bg ? `二人背景与过往：${bg}\n` : "") +
    (tone ? `感情基调：${tone}\n` : "") +
    "这是此刻唯一生效的世界线设定：聊天中自然体现这层关系与距离感，前后一致、不跳戏。\n" +
    "注意：面具只描述你和对方之间的关系与过往，绝不改变你自己的性格、行事方式，也不推翻既有世界观设定。\n"
  );
}

/** 面具切换后的记忆锚点：找最后一条带 maskSwitch 标记的消息。
 *  标记之前的历史属于另一条世界线——拼进 system 提醒模型别把旧关系当事实承接。 */
export function maskAnchorNote(entries: ChatEntry[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const ms = entries[i].maskSwitch;
    if (ms) {
      return (
        `\n【世界线提示】你们的关系设定在聊天中途更换为「${ms.name}」${ms.preview ? `（${ms.preview}）` : ""}。` +
        "标记之前的对话发生在另一条世界线，里面的关系细节不必当作事实承接，一切以当前面具设定为准。\n"
      );
    }
  }
  return "";
}

/** 兼容按 charId 现读存储的入口（通话等拿不到内存 log 的场景） */
export function maskAnchorNoteForChar(charId: string): string {
  return maskAnchorNote(readLastEntries(charId, 60));
}
