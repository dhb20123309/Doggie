// 语音通话步骤C：转写文本交给当前角色生成通话回复。
// ⚠️ 通话内容不写入私聊对话框——记忆走独立的 vp-phone:calllog:{charId}（每角色最近40条，重拨仍记得）；
//    该角色从未通过电话时回落读一次私聊日志，让第一通电话 TA 也记得平时聊的事。
import type { AiConfig } from "./types";
import type { WorldBook } from "./worldbook";
import { chatCompletion, chatStream, type ChatMessage } from "./ai-api";
import {
  CHAT_LIVENESS,
  displayName,
  isRepetitiveReply,
  sanitizeReply,
  splitBubbles,
  type Character,
  type ChatEntry,
} from "./chat-types";
import { readLastEntries } from "./chat-store";
import { getActiveWorldBooks, buildWorldSectionV2 } from "./worldbook";
import { CHARACTER_FIDELITY } from "./adult-worldbook";
import { LANGUAGE_PROTOCOL, ANTI_GREASE_BASELINE, LIVING_PERSON_PROTOCOL } from "./liveliness-worldbook";
import { getActiveMask, buildMaskSection, maskAnchorNoteForChar } from "./mask-store";

const CALL_LOG_PREFIX = "vp-phone:calllog:";
const CALL_LOG_MAX = 40;

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
  // 面具（世界线关系包）：通话与私聊共用同一份"当前启用面具"，每次现算同步读存储
  const maskText = buildMaskSection(getActiveMask(ch.id, ch)) + maskAnchorNoteForChar(ch.id);
  return (
    `你现在扮演以下角色，请始终以该身份回复，不要跳出角色。\n名字：${ch.name || "无名角色"}\n\n${ch.persona || "无额外设定"}\n` +
    CHAT_LIVENESS +
    CHARACTER_FIDELITY +
    LANGUAGE_PROTOCOL +
    ANTI_GREASE_BASELINE +
    LIVING_PERSON_PROTOCOL +
    worldText +
    maskText +
    CALL_SCENARIO +
    observationText +
    `\n【最近对话（对方是"${displayName(ch)}"正在和你通话）】\n`
  );
}

/* ---------- 通话独立记忆（不进私聊对话框） ---------- */

export function readCallLog(charId: string): ChatEntry[] {
  try {
    return JSON.parse(localStorage.getItem(`${CALL_LOG_PREFIX}${charId}`) || "[]") as ChatEntry[];
  } catch {
    return [];
  }
}

/** 通话往来落独立日志：assistant 一条回复按换行拆成多条气泡（与聊天页 splitBubbles 口径一致） */
export function commitCallExchange(charId: string, userText: string, reply: string | null): void {
  try {
    const prev = readCallLog(charId);
    const t = Date.now();
    const bubbles = reply == null ? [] : splitBubbles(reply).map((content, i) => ({ id: `c${t}${i}`, role: "assistant" as const, content, at: t + i }));
    const userEntry: ChatEntry = { id: `u${t}`, role: "user", content: userText, at: t };
    if (reply == null) userEntry.failed = true;
    const next: ChatEntry[] = [...prev, userEntry, ...bubbles].slice(-CALL_LOG_MAX);
    localStorage.setItem(`${CALL_LOG_PREFIX}${charId}`, JSON.stringify(next));
    console.log(`[call-reply] committed char=${charId} ok=${reply != null} bubbles=${bubbles.length}`);
  } catch {
    /* 隐私模式忽略 */
  }
}

/** 上下文来源：优先本通话日志最近20条；该角色从未通过电话时回落私聊日志最近12条（仅这一次） */
function callHistoryFor(charId: string): ChatEntry[] {
  const log = readCallLog(charId).filter((e) => !e.failed && !e.transfer && !e.location && !e.order);
  if (log.length) return log.slice(-20);
  return readLastEntries(charId, 12).filter((e) => !e.failed && !e.transfer && !e.location && !e.order);
}

/** 兜底剥除违规方括号标记（协议已禁，模型偶尔仍会带出来——语音念出"[转账:520]"会穿帮） */
const stripMarks = (s: string) => s.replace(/\[(?:转账|定位|外卖|礼物|引用|表情|查设定|远程MCP)[:：][^\]]*\]/g, "").trim();

function buildCallMsgs(ch: Character, books: WorldBook[], text: string, observationText: string, history: ChatEntry[]): ChatMessage[] {
  return [
    { role: "system", content: buildCallSys(ch, books, text, observationText) },
    ...history.map((e) => ({ role: e.role, content: e.content })),
    { role: "user", content: `（电话里 TA 说）${text}` },
  ];
}

/** 请求角色对转写文本的通话回复（非流式，保留给回落场景）：OOC 过滤 + 复读拦截重生成一次 */
export async function requestCallReply(cfg: AiConfig, ch: Character, books: WorldBook[], text: string, observationText = ""): Promise<string> {
  const history = callHistoryFor(ch.id);
  const msgs = buildCallMsgs(ch, books, text, observationText, history);
  console.log(`[call-reply] start char=${ch.id} histLen=${history.length} sysLen=${msgs[0].content.length}`);
  let raw = await chatCompletion(cfg, msgs);
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

/** 流式通话回复：onSentence 每凑满一句完整口语即回调（首句先行送 TTS，实现"及时语音回答"）。
 *  onAllText 在全文确定后回调（供 OOC/复读整段校验）。
 *  网关不支持 SSE 时自动回落非流式（onSentence 一次性收到全文）。 */
export async function streamCallReply(
  cfg: AiConfig,
  ch: Character,
  books: WorldBook[],
  text: string,
  observationText: string,
  onSentence: (sentence: string) => void,
  onAllText: (full: string) => void,
  signal?: AbortSignal,
  onFirstSentence?: () => void,
): Promise<string> {
  const history = callHistoryFor(ch.id);
  const msgs = buildCallMsgs(ch, books, text, observationText, history);
  console.log(`[call-reply] stream start char=${ch.id} histLen=${history.length}`);
  let emitted = 0; // 已吐给 onSentence 的字符位置
  let firstSent = false; // 首句是否已回调（触发 onFirstSentence 一次）
  const BOUNDARIES = ["。", "！", "？", "!", "?", "\n"];
  const nextBoundary = (s: string, from: number) => {
    let best = -1;
    for (const b of BOUNDARIES) {
      const i = s.indexOf(b, from);
      if (i >= 0 && (best < 0 || i < best)) best = i;
    }
    return best;
  };
  const pump = (accumulated: string) => {
    // 从已吐出位置之后逐个找句子边界即切（流式逐句吐，首句先行送 TTS）
    for (;;) {
      const idx = nextBoundary(accumulated, emitted);
      if (idx < 0) break;
      const sentence = stripMarks(accumulated.slice(emitted, idx + 1)).replace(/\s+/g, " ").trim();
      emitted = idx + 1;
      if (sentence) {
        onSentence(sentence);
        if (!firstSent) {
          firstSent = true;
          console.log(`[call-reply] first sentence ready len=${sentence.length}`);
          onFirstSentence?.();
        }
      }
    }
  };
  let full: string;
  try {
    full = await chatStream(cfg, msgs, pump, signal);
  } catch (e) {
    if (!(e instanceof Error) || e.message !== "STREAM_UNSUPPORTED") throw e;
    console.log("[call-reply] 网关不支持流式，回落整段返回");
    full = await chatCompletion(cfg, msgs, signal);
  }
  const clean = sanitizeReply(stripMarks(full));
  const recentAssistants = history.filter((e) => e.role === "assistant").slice(-6);
  if (!clean || isRepetitiveReply(clean, recentAssistants)) {
    console.warn(`[call-reply] stream ${clean ? "repetitive" : "OOC"}，重生成一次（非流式）`);
    const again = await chatCompletion(cfg, [...msgs, { role: "user", content: "（系统提示：刚才那句被拦截了。这次用全新的说法接她的话，回到角色身份，不许提自己是模型或程序）" }], signal);
    const retry = sanitizeReply(stripMarks(again));
    if (!retry) throw new Error("TA 这次没能组织好语言（回复被安全过滤拦下），挂断重拨或换个话题试试");
    onAllText(retry);
    return retry;
  }
  onAllText(clean);
  console.log(`[call-reply] stream ok char=${ch.id} len=${clean.length}`);
  return clean;
}
