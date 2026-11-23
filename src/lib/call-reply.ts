// 语音通话步骤C：把转写文本交给当前角色生成通话回复（复用聊天页同款协议与世界书，记忆互通同一份 rolechat-log）
import type { AiConfig } from "./types";
import type { WorldBook } from "./worldbook";
import { chatCompletion, type ChatMessage } from "./ai-api";
import {
  CHAT_LIVENESS,
  displayName,
  isRepetitiveReply,
  sanitizeReply,
  type Character,
  type ChatEntry,
} from "./chat-types";
import { readLastEntries } from "./chat-store";
import { getActiveWorldBooks, buildWorldSectionV2 } from "./worldbook";
import { CHARACTER_FIDELITY } from "./adult-worldbook";
import { LANGUAGE_PROTOCOL, ANTI_GREASE_BASELINE, LIVING_PERSON_PROTOCOL } from "./liveliness-worldbook";

const LOG_PREFIX = "vp-phone:rolechat-log:";

/** 通话场景协议：口头交流≠打字碎句——不注入 HUMAN_TYPING/TEXT_STYLE/条数轮换，
 *  转账/外卖/表情等文字标记在通话里渲染不出来，也一并不注入。 */
export const CALL_SCENARIO =
  "\n【当前场景：语音通话】你们正在打一通实时语音电话，TA 刚说完下面这句话：\n" +
  "1. 这是「说出口的话」：不要分条碎句、不要打字习惯、不用表情包；像打电话一样自然连贯地说。\n" +
  "2. 长度口语化：一两句话为主，最多三句；语气贴合人设与当下情绪。\n" +
  "3. 先接住 TA 说的话再展开，禁止答非所问、禁止自说自话。\n" +
  "4. 绝对禁止输出 [转账:]、[定位:]、[外卖:]、[礼物:]、[引用:]、[表情:]、[查设定:] 等任何方括号标记——电话里不存在这些功能，想用就口头说出来。\n" +
  "5. 你的回复稍后会被合成语音念给 TA 听：不要包含动作描写、旁白、星号或引号包裹的内心戏，只写会念出来的内容。";

/** 现算通话 system：人设 + 精简活人协议 + 世界书 + 通话场景说明（纯函数，可单测）；
 *  observationText：通话观察摘要（call-observe.summarizeObservation 产出），空串=不注入 */
export function buildCallSys(ch: Character, books: WorldBook[], recentText = "", observationText = ""): string {
  const activeBooks = getActiveWorldBooks(ch.id, books, ch.boundWorldBookIds ?? []);
  const worldText = buildWorldSectionV2(activeBooks, recentText, []);
  return (
    `你现在扮演以下角色，请始终以该身份回复，不要跳出角色。\n名字：${ch.name || "无名角色"}\n\n${ch.persona || "无额外设定"}\n` +
    CHAT_LIVENESS +
    CHARACTER_FIDELITY +
    LANGUAGE_PROTOCOL +
    ANTI_GREASE_BASELINE +
    LIVING_PERSON_PROTOCOL +
    worldText +
    CALL_SCENARIO +
    observationText +
    `\n【最近对话（对方是"${displayName(ch)}"正在和你通话）】\n`
  );
}

/** 落库形态：assistant 一条回复按换行拆成多条气泡（与聊天页 splitBubbles 口径一致） */
function toBubbles(reply: string): ChatEntry[] {
  const lines = reply
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const items = lines.length ? lines : [reply.trim() || "…"];
  const t = Date.now();
  return items.map((content, i) => ({ id: `c${t}${i}`, role: "assistant" as const, content, at: t + i }));
}

/** 请求角色对转写文本的通话回复：OOC 过滤 + 复读拦截重生成一次；失败抛错由界面展示人话原因。
 *  observationText：本轮通话观察（可选），拼入 system 供 TA 隐约感知停顿/语气，禁断言协议在文本内自带 */
export async function requestCallReply(cfg: AiConfig, ch: Character, books: WorldBook[], text: string, observationText = ""): Promise<string> {
  const history = readLastEntries(ch.id, 20).filter((e) => !e.failed && !e.transfer && !e.location && !e.order);
  const sys = buildCallSys(ch, books, text, observationText);
  const msgs: ChatMessage[] = [
    { role: "system", content: sys },
    ...history.map((e) => ({ role: e.role, content: e.content })),
    { role: "user", content: `（电话里 TA 说）${text}` },
  ];
  console.log(`[call-reply] start char=${ch.id} histLen=${history.length} sysLen=${sys.length}`);
  let raw = await chatCompletion(cfg, msgs);
  // 兜底剥除违规方括号标记（协议已禁，模型偶尔仍会带出来——语音念出"[转账:520]"会穿帮）
  const stripMarks = (s: string) => s.replace(/\[(?:转账|定位|外卖|礼物|引用|表情|查设定|远程MCP)[:：][^\]]*\]/g, "").trim();
  let clean = sanitizeReply(stripMarks(raw));
  const recentAssistants = history.filter((e) => e.role === "assistant").slice(-6);
  if (!clean || isRepetitiveReply(clean, recentAssistants)) {
    console.warn(`[call-reply] ${clean ? "repetitive" : "OOC"} filtered char=${ch.id}，重生成一次`);
    const again = await chatCompletion(cfg, [...msgs, { role: "user", content: "（系统提示：刚才那句被拦截了。这次用全新的说法接她的话，回到角色身份，不许提自己是模型或程序）" }]);
    clean = sanitizeReply(stripMarks(again));
  }
  if (!clean) throw new Error("TA 这次没能组织好语言（回复被安全过滤拦下），挂断重拨或换个话题试试");
  console.log(`[call-reply] ok char=${ch.id} len=${clean.length}`);
  return clean;
}

/** 通话往来写入该角色的聊天记录（记忆互通）：用户转写文本 + 角色回复都落 vp-phone:rolechat-log:{charId} */
export function commitCallExchange(charId: string, userText: string, reply: string | null): void {
  try {
    const key = `${LOG_PREFIX}${charId}`;
    const prev = JSON.parse(localStorage.getItem(key) || "[]") as ChatEntry[];
    const t = Date.now();
    const next: ChatEntry[] = [
      ...prev,
      { id: `u${t}`, role: "user", content: userText, at: t, ...(reply == null ? { failed: true } : {}) },
      ...(reply != null ? toBubbles(reply) : []),
    ];
    localStorage.setItem(key, JSON.stringify(next));
    console.log(`[call-reply] committed char=${charId} ok=${reply != null} bubbles=${reply != null ? next.length - prev.length - 1 : 0}`);
  } catch {
    /* 隐私模式忽略 */
  }
}
