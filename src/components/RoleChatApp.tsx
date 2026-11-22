// 「短信」应用：微信式会话列表单选角色 + 分角色聊天 + 表情发送 + 语音朗读 + 前情提要 + 主动消息
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  SendHorizontal,
  LoaderCircle,
  RefreshCw,
  Settings2,
  Trash2,
  Upload,
  WandSparkles,
  SlidersHorizontal,
  BookText,
  SmilePlus,
  Check,
  Plus,
  FileInput,
  Volume2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AiConfig } from "@/lib/types";
import { isConfigured } from "@/lib/types";
import { chatCompletion } from "@/lib/ai-api";
import {
  type Character,
  type ChatEntry,
  type ReadMarks,
  type SendPrefs,
  splitBubbles,
  sanitizeReply,
  CHAT_LIVENESS,
  isRepetitiveReply,
  STORY_PROTOCOL,
} from "@/lib/chat-types";
import {
  type WorldBook,
  type Sticker,
  getActiveWorldBooks,
  buildWorldSection,
  buildStickerHint,
  parseReplyToMessages,
} from "@/lib/worldbook";
import {
  useCharacters,
  useActiveCharId,
  useChatLog,
  clearChatLog,
  readLastEntry,
  unreadCount,
  useReadMarks,
  presetPhoto,
  readLastEntries,
  useSendPrefs,
  useWorldBooks,
  useStickers,
  PROACTIVE_LINES,
} from "@/lib/chat-store";
import { loadVoiceConfig, voiceReady, synthesizeSpeech } from "@/lib/tts";
import { generateCharPhoto, photoPrompt, matchPhotoScene } from "@/lib/media";
import { PROACTIVE_PROTOCOL, pickTopicSeeds } from "@/lib/proactive-protocol";
import { HUMAN_TYPING_PROTOCOL, buildCountHint, countReplyLines } from "@/lib/human-typing";
import { parseCharacterCard, cardToCharacter, parseWorldBookMd } from "@/lib/import-parse";

interface Props {
  config: AiConfig;
  /** 聊天背景（用户上传替换，默认内置奶油图） */
  background?: string;
  onBack: () => void;
}

/** 消息时间戳：当天只显示 HH:MM，跨日补上日期 */
const fmtTime = (at: number) => {
  const d = new Date(at);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
};

const EMOJIS = ["🌙", "🦊", "🐱", "🤖", "🌸", "⚡", "🫧", "🍵", "🎧", "🪐", "🔥", "🎻"];
const AUTO_DELAY_MS = 2000;
/** 主动消息检查间隔 / 距上次会话内任何消息超过该时长即可能"不请自来" */
const PROACTIVE_CHECK_MS = 20_000;
const PROACTIVE_IDLE_MS = 60_000;
/** 每轮定时器最多连发几条，让角色更像连着碎碎念 */
const PROACTIVE_MAX_PER_TICK = 2;
/** 自动分享照片：距上次照片至少间隔这么久，且触发主动消息时小概率附带一张 */
const PHOTO_COOLDOWN_MS = 15 * 60_000;
const PHOTO_CHANCE = 0.3;

/** 照片配文模板：按场景写死贴合语境的短句，随机挑一条，避免每次"刚拍的，给你看看" */
const PHOTO_CAPTIONS: Record<string, string[]> = {
  "after school on the basketball court": ["刚打完球，看什么看", "球场夕阳，凑合看", "赢了，就差你在场边"],
  "in the passenger seat of a car on a sunny afternoon road trip": ["出来兜风了，副驾给你留着", "这光线绝了，拍一张"],
  "at a piano in the school music room": ["排练间隙，琴房没人", "刚弹了你爱听的那段"],
  "holding a bubble tea on a tree-lined street at dusk": ["路过看到你爱喝的，顺手买了", "奶茶和晚霞，哪个先送到你那"],
  "on the rooftop railing looking at the evening city lights": ["天台风景不错，可惜你不在", "今晚的灯挺好看，拍给你"],
};
const PHOTO_CAPTIONS_ANY = ["随手拍了一张", "这个角度还行吧", "想到你了，看看这张", "今日份的我"];

function pickCaption(scene: string): string {
  const key = Object.keys(PHOTO_CAPTIONS).find((k) => scene.startsWith(k));
  const pool = key ? PHOTO_CAPTIONS[key] : PHOTO_CAPTIONS_ANY;
  return pool[Math.floor(Math.random() * pool.length)];
}

function lastPhotoAt(charId: string): number {
  const log = readLastEntries(charId, 50);
  let t = 0;
  for (const e of log) if (e.photoUrl && e.at > t) t = e.at;
  return t;
}

type View = "list" | "chat" | "edit" | "prefs" | "worldbooks" | "stickers" | "import";

export function RoleChatApp({ config, background, onBack }: Props) {
  const [characters, setCharacters] = useCharacters();
  const [activeId, setActiveId] = useActiveCharId(characters.map((c) => c.id));
  const active = characters.find((c) => c.id === activeId);
  // 会话日志严格跟随当前选中角色；未选中时用空会话，绝不回落到别的角色（修复串会话 bug）
  const [log, setLog] = useChatLog(active?.id ?? "");
  // 兜底：进入某会话时若该会话存储里已有晚于界面的新回复（后台 requestReply 期间切出又切回），立即对齐
  const logKeyRef = useRef(active?.id ?? "");
  if (logKeyRef.current !== (active?.id ?? "")) {
    logKeyRef.current = active?.id ?? "";
    queueMicrotask(() => {
      try {
        const stored = JSON.parse(localStorage.getItem(`vp-phone:rolechat-log:${logKeyRef.current}`) || "[]") as ChatEntry[];
        // 以存储为准对齐（曾只比长度：发送后本地 state 比存储多一条用户消息时对齐失效，气泡要退出重进才可见）
        setLog((cur) => {
          if (JSON.stringify(cur) === JSON.stringify(stored)) return cur;
          console.log(`[reply] align char=${logKeyRef.current} ui=${cur.length} stored=${stored.length}`);
          return stored;
        });
      } catch {
        /* ignore */
      }
    });
  }
  const [prefs, setPrefs] = useSendPrefs();
  // 老用户迁移：默认值曾为"发送只发文字需手动点生成"，现改为无需确认直接回复；仅对未动过配置的旧数据强制开启一次
  const prefsMigrated = useRef(false);
  useEffect(() => {
    if (prefsMigrated.current) return;
    prefsMigrated.current = true;
    try {
      if (!localStorage.getItem("vp-phone:send-prefs:migrated-v1")) {
        localStorage.setItem("vp-phone:send-prefs:migrated-v1", "1");
        if (!prefs.sendReplacesGenerate) setPrefs((p) => ({ ...p, sendReplacesGenerate: true }));
      }
    } catch {
      /* 隐私模式忽略 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [books, setBooks] = useWorldBooks();
  const [stickers, setStickers] = useStickers();
  const [view, setView] = useState<View>("list");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState<string | null>(null);
  const [proactiveBusy, setProactiveBusy] = useState(false);
  const [marks, setMarks] = useReadMarks();
  const listRef = useRef<HTMLDivElement>(null);
  const ready = isConfigured(config);

  const stateRef = useRef({ log, input, pending, ready, prefs });
  stateRef.current = { log, input, pending, ready, prefs };
  const autoTimer = useRef<number | null>(null);

  /** 每次请求现算：人设 + 生效世界书 + 表情名单 → system prompt；剧情模式换拼 STORY_PROTOCOL */
  const buildSys = useCallback(
    (ch: Character, story: boolean) => {
      const activeBooks = getActiveWorldBooks(ch.id, books, ch.boundWorldBookIds ?? []);
      const usable = stickers.filter((s) => s.isGlobal);
      if (story) {
        // 互动剧情：第三人称小说链路——保留完整历史记忆，不注入私聊气泡式铁律与表情名单
        return (
          `你正在以小说叙事者视角演绎一段互动剧情，男主角为「${ch.name || "无名角色"}」。\n男主设定：${
            ch.persona || "无额外设定"
          }\n` +
          STORY_PROTOCOL(ch.name || "他") +
          buildWorldSection(activeBooks)
        );
      }
      // 真人打字习惯协议（世界书《你是真人在打字不是人机呀》改编）：仅私聊链路注入，剧情模式保持叙事文体。
      // 条数轮换锚点：模型看不见自己的"发送行为"，把最近 5 轮各自几条显式喂回去才能做到相邻两轮不同
      const recentCounts = readLastEntries(ch.id, 30)
        .filter((e) => e.role === "assistant" && !e.failed && !e.story)
        .slice(-5)
        .map((e) => countReplyLines(e.content));
      return (
        `你现在扮演以下角色，请始终以该身份回复，不要跳出角色。\n名字：${
          ch.name || "无名角色"
        }\n\n${ch.persona || "无额外设定"}\n` +
        CHAT_LIVENESS +
        HUMAN_TYPING_PROTOCOL +
        buildCountHint(recentCounts) +
        `【最近对话（对方是"${ch.name || "她"}"，请接住她最后一条消息再回复）】\n` +
        buildWorldSection(activeBooks) +
        "\n\n" +
        buildStickerHint(usable)
      );
    },
    [books, stickers]
  );

  const scrollBottom = () => {
    requestAnimationFrame(() =>
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })
    );
  };

  const toHistory = (ch: Character, entries: ChatEntry[]) => [
    { role: "system", content: buildSys(ch, Boolean(ch.storyMode)) },
    ...entries.filter((e) => !e.failed).slice(-20).map((e) => ({ role: e.role, content: e.content })),
  ];

  const requestReply = async (entries: ChatEntry[], userMsgId: string, storyMode = false) => {
    if (!active) return;
    // 快照请求上下文：回复在后台继续，退出聊天页/切换会话也不会打断（结果直写该角色存储）
    const ch = active;
    const cfgSnapshot = config;
    const sysPrompt = buildSys(ch, storyMode);
    const toHist = (es: ChatEntry[]) => {
      const msgs = es.filter((e) => !e.failed).slice(-20);
      if (!storyMode) return [{ role: "system", content: sysPrompt }, ...msgs.map((e) => ({ role: e.role, content: e.content }))];
      // 剧情链路：玩家消息带人称锚点包装（前文叙述转"你"），assistant 历史原样保留——记忆完整互通
      const out: { role: string; content: string }[] = [{ role: "system", content: sysPrompt }];
      let lastStoryNarration = "";
      for (const e of msgs) {
        if (e.role === "user") {
          const anchor = lastStoryNarration
            ? `${toSecondPerson(lastStoryNarration)}\n（以上为既定剧情，请承接推进，勿重复上文句子）\n\n`
            : "（互动剧情开场。请以第三人称叙述男主、第二人称\"你\"叙述玩家）\n";
          out.push({ role: "user", content: anchor + e.content });
          lastStoryNarration = "";
        } else {
          out.push({ role: e.role, content: e.content });
          if (e.story) lastStoryNarration = e.content;
        }
      }
      return out;
    };
    console.log(
      `[reply] start char=${ch.id} msg=${userMsgId} story=${storyMode ? "on" : "off"} typing=${storyMode ? "narrative" : "human-protocol"} → pending(正在输入中) sysLen=${sysPrompt.length}`
    );
    setPending(true);
    scrollBottom();
    // 拟真节奏：至少显示 1.2s"正在输入中"，避免秒回穿帮；期间请求已在进行
    const minTyping = new Promise((r) => setTimeout(r, 1_200));
    const call = chatCompletion(cfgSnapshot, toHist(entries)).then(
      (reply) => ({ ok: true as const, reply }),
      (err) => ({ ok: false as const, err })
    );
    try {
      const first = await Promise.race([call, minTyping.then(() => null)]);
      let result = first ?? (await call);
      if (!result.ok) {
        // 网关偶发 429/5xx/网络抖动不再静默丢回复：自动退避重试一次，仍失败才标记可手动重试
        const retryable = !(result.err instanceof Error && /401|403|400/.test(result.err.message));
        if (retryable) {
          console.warn(`[reply] fail char=${ch.id}，3 秒后自动重试一次:`, result.err instanceof Error ? result.err.message : result.err);
          await new Promise((r) => setTimeout(r, 3_000));
          result = await chatCompletion(cfgSnapshot, toHist(entries)).then(
            (reply) => ({ ok: true as const, reply }),
            (err) => ({ ok: false as const, err })
          );
        }
      }
      if (result.ok) {
        // 复读兜底链：OOC 过滤 + 近似复读检测（去标点后任一整行与旧句重复即拦），命中即带禁复读指令重生成，最多两次
        // 比对窗口放宽到最近 6 条 assistant：跨多轮的车轱辘话也能拦住
        const recentAssistants = entries.filter((e) => e.role === "assistant" && !e.failed).slice(-6);
        console.log(`[reply] repeat-check char=${ch.id} window=${recentAssistants.length}条`);
        const antiRepeatHint = storyMode
          ? "（系统提示：上一条剧情因与前文重复被拦截。这次必须换全新的叙述角度与措辞推进剧情——不许复用之前的句子和意象，情感按前因后果平缓递进；保持一到两段小说正文）"
          : "（系统提示：你上一条回复因与原话重复被拦截。这次必须换全新的说法和角度接她的话——不许复用之前说过的句子和口头禅，可以提新细节、开新话题或换个反应；保持一两句口语化短消息）";
        const regenWith = async (extraUser: string): Promise<string> => {
          const firstTry = await chatCompletion(cfgSnapshot, [
            ...toHist(entries),
            { role: "user", content: extraUser },
          ]).then(
            (r) => ({ ok: true as const, v: sanitizeReply(r) }),
            () => ({ ok: false as const, v: "" })
          );
          if (!firstTry.ok || !firstTry.v) return "";
          if (isRepetitiveReply(firstTry.v, recentAssistants)) {
            const second = await chatCompletion(cfgSnapshot, [
              ...toHist(entries),
              { role: "user", content: antiRepeatHint },
            ]).then((r) => sanitizeReply(r), () => "");
            return second && !isRepetitiveReply(second, recentAssistants) ? second : "";
          }
          return firstTry.v;
        };
        let clean = result.ok ? sanitizeReply(result.reply) : "";
        let rep = false;
        if (clean && isRepetitiveReply(clean, recentAssistants)) {
          rep = true;
          console.warn(`[reply] repetitive char=${ch.id}，带禁复读指令重生成`);
          clean = "";
        }
        if (!clean) {
          // 整条回复出戏或复读：丢弃不展示，静默重生成（regenWith 内已含二级复读抢救）
          console.warn(`[reply] ${rep ? "repeat" : "OOC"} filtered char=${ch.id}，静默重生成`);
          const again = await regenWith(
            rep
              ? antiRepeatHint
              : storyMode
                ? "（请回到互动剧情叙事：第三人称男主、第二人称玩家，承接前文平缓推进，不要提及你是模型或程序，也不要重复之前的句子）"
                : "（请完全回到角色身份继续对话，不要提及你是模型或程序；也不要重复你之前说过的句子）"
          );
          if (again) {
            console.log(`[reply] regen ok char=${ch.id}`);
            settleReply(ch.id, userMsgId, again, storyMode);
          } else {
            console.error(`[reply] regen fail char=${ch.id}`);
            settleReply(ch.id, userMsgId, null);
          }
        } else {
          if (clean !== result.reply) console.log(`[reply] OOC line stripped char=${ch.id}`);
          console.log(`[reply] ok char=${ch.id} len=${clean.length}`);
          settleReply(ch.id, userMsgId, clean, storyMode);
        }
      } else {
        console.error(`[reply] final fail char=${ch.id}:`, result.err instanceof Error ? result.err.message : result.err);
        settleReply(ch.id, userMsgId, null);
      }
    } finally {
      await minTyping;
      setPending(false);
      scrollBottom();
    }
  };

  /** 回复落定：始终直写该角色的 localStorage（页面已切走也不丢），当前正打开该会话时同步刷新界面；story 标记决定剧情框/气泡渲染 */
  const settleReply = (charId: string, userMsgId: string, reply: string | null, story = false) => {
    try {
      const key = `vp-phone:rolechat-log:${charId}`;
      const prev = JSON.parse(localStorage.getItem(key) || "[]") as ChatEntry[];
      // 只标记本次新产出的回复为剧情内容：历史消息的 story 标记原样保留（记忆互通）
      const kept = prev.map((e) => (e.id === userMsgId ? { ...e, failed: reply == null, ...(story ? { story: true } : {}) } : e));
      const next: ChatEntry[] = reply != null ? [...kept, { id: `a${Date.now()}`, role: "assistant", content: reply, at: Date.now(), ...(story ? { story: true } : {}) }] : kept;
      localStorage.setItem(key, JSON.stringify(next));
      if (charId === activeId && view === "chat") setLog(next);
    } catch {
      /* ignore */
    }
  };

  /** 剧情框内渲染的用户消息：TA 的第三人称叙述转第二人称"你"（他看着你→他看着"你"），兜底直接引语 */
  const toSecondPerson = (t: string) => t.replace(/他(看着|望着|听见|听到|感觉到)/g, "你$1").replace(/「([^」\n]{1,40})」/g, "“$1”");

  const flushDraft = (): boolean => {
    const text = input.trim();
    if (!text || pending || !ready) return false;
    const story = Boolean(active?.storyMode);
    const userMsg: ChatEntry = { id: `u${Date.now()}`, role: "user", content: text, at: Date.now(), ...(story ? { story: true } : {}) };
    // 先同步更新界面（用户气泡必须立刻出现），再直写该角色存储保证后台回复基于完整上下文；
    // 顺序反了会被后续 setLog(stored) 用旧快照覆盖掉刚发的消息（曾导致自己发的消息要退出重进才可见）
    setLog((prev) => [...prev, userMsg]);
    writeLogNow(active?.id ?? "", (prev) => [...prev, userMsg]);
    setInput("");
    scrollBottom();
    // 立即进入"正在输入中"并请求回复；请求发出后即与页面解耦，切走/返回也不会打断
    void requestReply([...stateRef.current.log, userMsg], userMsg.id, story);
    return true;
  };

  /** 立即把某函数结果写入角色会话存储（不依赖组件仍在渲染） */
  const writeLogNow = (charId: string, fn: (prev: ChatEntry[]) => ChatEntry[]) => {
    try {
      const key = `vp-phone:rolechat-log:${charId}`;
      const prev = JSON.parse(localStorage.getItem(key) || "[]") as ChatEntry[];
      localStorage.setItem(key, JSON.stringify(fn(prev)));
    } catch {
      /* ignore */
    }
  };

  /** 从表情库手动发一张表情包（用户侧） */
  const sendSticker = (s: Sticker) => {
    if (pending || !ready) return;
    const userMsg: ChatEntry = {
      id: `u${Date.now()}`,
      role: "user",
      content: `[表情:${s.name}]`,
      stickerUrl: s.url,
      at: Date.now(),
    };
    setLog((prev) => [...prev, userMsg]);
    scrollBottom();
  };

  const generate = () => {
    if (pending || !ready || !active) return;
    const s = stateRef.current;
    let entries = s.log;
    let targetId: string | null = null;
    const draft = s.input.trim();
    if (draft) {
      const userMsg: ChatEntry = { id: `u${Date.now()}`, role: "user", content: draft, at: Date.now(), ...(active.storyMode ? { story: true } : {}) };
      entries = [...entries, userMsg];
      targetId = userMsg.id;
      // 与 flushDraft 同理：先同步更新界面，再直写存储，避免旧快照覆盖刚发的消息
      console.log(`[reply] generate flush msg=${userMsg.id} → ui+storage`);
      setLog(entries);
      writeLogNow(active.id, (prev) => [...prev, userMsg]);
      setInput("");
    } else {
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].role === "user") {
          targetId = entries[i].id;
          entries = entries.slice(0, i + 1);
          break;
        }
      }
    }
    if (!targetId) return;
    void requestReply(entries, targetId, Boolean(active.storyMode));
  };

  const primaryAction = () => {
    if (stateRef.current.prefs.sendReplacesGenerate) generate();
    else flushDraft();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    if (stateRef.current.prefs.enterSendsText) flushDraft();
  };

  const retry = (userMsgId: string) => {
    if (pending || !ready) return;
    const idx = log.findIndex((e) => e.id === userMsgId);
    if (idx < 0) return;
    const kept = log.slice(0, idx + 1).map((en) => (en.id === userMsgId ? { ...en, failed: false } : en));
    setLog(kept);
    void requestReply(kept, userMsgId, Boolean(active?.storyMode));
  };

  // 模式03：发完后倒计时自动生成
  useEffect(() => {
    if (autoTimer.current) {
      clearTimeout(autoTimer.current);
      autoTimer.current = null;
    }
    if (view !== "chat" || !prefs.autoReplyAfterSend || !ready || pending) return;
    if (input.trim()) return;
    const last = log[log.length - 1];
    if (!last || last.role !== "user") return;
    // 兜底：若最后一条用户消息已发出超过 AUTO_DELAY_MS 仍未进入回复流程（如 effect 竞态漏触发），立即补发；
    // 注意不能检查 failed 标记——requestReply 失败时 pending 仍为 true，会挡住本兜底导致彻底无回复
    const wait = Math.max(600, AUTO_DELAY_MS - (Date.now() - last.at));
    console.log(`[reply] fallback timer ${wait}ms for msg=${last.id}`);
    autoTimer.current = window.setTimeout(() => {
      const cur = stateRef.current.log;
      const l = cur[cur.length - 1];
      if (l && l.role === "user" && !cur.some((e) => e.role === "assistant" && e.at > l.at)) generate();
    }, wait);
    return () => {
      if (autoTimer.current) clearTimeout(autoTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, log, pending, ready, prefs.autoReplyAfterSend, view]);

  // 角色主动发消息：闲置足够久后由模型实时生成，一次 tick 可连发多条（间隔数秒），频率更高
  useEffect(() => {
    if (!ready || view === "import") return;
    let cancelled = false;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    const fireOne = async (ch: Character, last: ChatEntry | null) => {
      // 剧情模式下角色不"不请自来"发私聊式碎句——主动 tick 跳过带 storyMode 的角色
      if (ch.storyMode) return;
      const sys =
        buildSys(ch, false) +
        "\n\n【场景】现在没有对方发来的消息，是你（" +
        (ch.name || "TA") +
        "）主动想找对方说话。" +
        PROACTIVE_PROTOCOL.replace("{{char}}", ch.name || "TA") +
        "\n\n" +
        pickTopicSeeds() +
        "\n请像日常手机聊天一样主动找对方说话（真人打字习惯协议照常执行）：每条最多 10 个字，超过就拆行发；条数参考上面【你的发送节奏】换着来，别总是同一个条数；只写说出口的话本身，绝对不要旁白、动作描写或解释；可以结合你们之前的聊天内容自然延续话题。";
      const history: { role: string; content: string }[] = [
        { role: "system", content: sys },
        ...(last ? [] : [{ role: "user" as const, content: "（提示：这是开场第一条，随便说点什么）" }]),
      ];
      let line = "";
      // 复读检测基于该角色最近 6 条 assistant 消息（含历轮主动消息），近似重复即拦，连续 tick 不再车轱辘
      const prevAssistants = readLastEntries(ch.id, 30).filter((e) => e.role === "assistant" && !e.failed).slice(-6);
      console.log(`[proactive] repeat-check char=${ch.id} window=${prevAssistants.length}条`);
      try {
        line = sanitizeReply(await chatCompletion(config, history));
        if (line && isRepetitiveReply(line, prevAssistants)) {
          console.warn(`[proactive] repetitive char=${ch.id}，换说法重生成一次`);
          const again = await chatCompletion(config, [
            ...history,
            { role: "user", content: "（系统提示：这条因和你之前说过的话重复被拦截。换一个全新的话题或说法，不许复用旧句子和口头禅）" },
          ]).then((r) => sanitizeReply(r), () => "");
          line = again && !isRepetitiveReply(again, prevAssistants) ? again : "";
        }
        if (!line) console.warn(`[proactive] OOC/repeat filtered char=${ch.id}，本轮主动消息跳过`);
      } catch {
        const lines = PROACTIVE_LINES[ch.id];
        line = lines?.length ? lines[Math.floor(Math.random() * lines.length)] : "";
      }
      if (cancelled) return;
      line = line
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join("\n");
      if (!line) return;
      setLogForChar(ch.id, {
        id: `p${Date.now()}`,
        role: "assistant",
        content: line,
        at: Date.now(),
        proactive: true,
      });
      // 附带照片必须贴合聊天话题：从最近对话内容匹配场景，匹配不到就宁可不发（不再随机发莫名其妙的图）
      if (ch.photoEnabled && Math.random() < PHOTO_CHANCE && Date.now() - lastPhotoAt(ch.id) > PHOTO_COOLDOWN_MS) {
        const recentText = (last ? readLastEntries(ch.id, 6).map((e) => e.content).join(" ") : ch.name ?? "") + " " + (line || "");
        const scene = matchPhotoScene(recentText);
        if (!scene) {
          console.log(`[photo] skip char=${ch.id}：最近对话无明显可拍话题，不发图`);
          return;
        }
        console.log(`[photo] attach char=${ch.id} scene="${scene.slice(0, 40)}"`);
        let caption = "";
        try {
          caption = await chatCompletion(config, [
            { role: "system", content: buildSys(ch, false) + "\n\n【场景】你刚拍了一张自己的日常照片想发给对方。照片内容：" + scene + "。请用一句话配这张图发出去：只写这句话本身，不超过 20 字，不要旁白和解释，每次说法都要不一样。" },
            { role: "user", content: "（发照片）" },
          ]);
        } catch {
          caption = pickCaption(scene);
        }
        if (cancelled) return;
        caption = (caption || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || pickCaption(scene);
        const url = await generateCharPhoto(config, photoPrompt(ch.name, ch.persona, scene), presetPhoto(ch.id));
        if (cancelled || !url) return;
        setLogForChar(ch.id, {
          id: `ph${Date.now()}`,
          role: "assistant",
          content: caption,
          photoUrl: url,
          at: Date.now(),
          proactive: true,
        });
      }
    };

    const timer = window.setInterval(async () => {
      const candidates = characters.filter((c) => c.proactiveEnabled);
      if (!candidates.length) return;
      const ch = candidates[Math.floor(Math.random() * candidates.length)];
      const last = readLastEntry(ch.id);
      const idle = !last || Date.now() - last.at > PROACTIVE_IDLE_MS;
      if (!idle) return;
      if (Math.random() > 0.75) return; // 大部分检查都会触发，偶尔放过
      setProactiveBusy(true);
      try {
        const count = 1 + Math.floor(Math.random() * PROACTIVE_MAX_PER_TICK);
        for (let i = 0; i < count; i++) {
          if (cancelled) break;
          await fireOne(ch, i === 0 ? last : readLastEntry(ch.id));
          if (i < count - 1 && !cancelled) await sleep(4_000 + Math.random() * 6_000);
        }
      } finally {
        if (!cancelled) setProactiveBusy(false);
      }
    }, PROACTIVE_CHECK_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, view, characters, buildSys, config]);

  /** 往指定角色的会话里追加一条消息（不依赖当前打开的会话） */
  const setLogForChar = (charId: string, entry: ChatEntry) => {
    try {
      const key = `vp-phone:rolechat-log:${charId}`;
      const prev = JSON.parse(localStorage.getItem(key) || "[]") as ChatEntry[];
      localStorage.setItem(key, JSON.stringify([...prev, entry]));
      // 若正打开该会话则同步刷新界面
      if (charId === activeId && view === "chat") setLog((l) => [...l, entry]);
    } catch {
      /* ignore */
    }
  };

  /** 朗读某条回复：外部 TTS + 角色绑定音色 */
  const speak = async (entryId: string, text: string) => {
    const vc = loadVoiceConfig();
    if (!voiceReady(vc, config)) return;
    setVoiceBusy(entryId);
    try {
      const url = await synthesizeSpeech(vc, config, text.replace(/\[表情:[^\]]*\]/g, ""), active?.voiceId);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (e) {
      console.warn("语音合成失败:", e instanceof Error ? e.message : e);
    } finally {
      setVoiceBusy(null);
    }
  };

  // ===== 子视图 =====
  if (view === "import") {
    return (
      <ImportView
        onBack={() => setView("list")}
        onImportCard={(md) => {
          const parsed = parseCharacterCard(md);
          const ch = cardToCharacter(parsed, books.filter((b) => b.scope === "local").map((b) => b.id));
          setCharacters((prev) => [...prev, ch]);
          setActiveId(ch.id);
          setView("chat");
        }}
        onImportWorld={(md, fileName) => {
          const items = parseWorldBookMd(md, fileName.replace(/\.md$/i, "")).map((w) => ({
            ...w,
            id: `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          }));
          setBooks((prev) => [...prev, ...items]);
          setView("list");
        }}
      />
    );
  }

  if (view === "list") {
    return (
      <ConversationList
        characters={characters}
        activeId={activeId}
        marks={marks}
        generating={proactiveBusy}
        onSelect={(id) => {
          setActiveId(id);
          setMarks((m) => ({ ...m, [id]: Date.now() }));
          setView("chat");
        }}
        onNew={() => {
          const ch: Character = {
            id: `c-new-${Date.now().toString(36)}`,
            name: "",
            avatar: "🎭",
            persona: "",
            boundWorldBookIds: [],
            proactiveEnabled: true,
          };
          setCharacters((prev) => [...prev, ch]);
          setActiveId(ch.id);
          setView("edit");
        }}
        onImport={() => setView("import")}
        onDelete={(id) => {
          setCharacters((prev) => prev.filter((c) => c.id !== id));
          clearChatLog(id);
        }}
        onBack={onBack}
      />
    );
  }

  if (!active) {
    return (
      <div className="flex h-full flex-col bg-background">
        <NavBar title="短信" onBack={() => setView("list")} />
        <p className="pt-16 text-center text-xs text-muted-foreground">还没有角色，点右上角导入或新建</p>
      </div>
    );
  }

  if (view === "edit") {
    return (
      <CharacterEditor
        character={active}
        books={books}
        bookCount={books.filter((b) => b.scope === "local").length}
        onSave={(c) => {
          setCharacters((prev) => prev.map((x) => (x.id === c.id ? c : x)));
          setView(log.length || c.name ? "chat" : "list");
        }}
        onCancel={() => setView(log.length ? "chat" : "list")}
        onOpenWorldBooks={() => setView("worldbooks")}
        onToggleProactive={(v) => setCharacters((prev) => prev.map((x) => (x.id === active.id ? { ...x, proactiveEnabled: v } : x)))}
        onTogglePhoto={(v) => setCharacters((prev) => prev.map((x) => (x.id === active.id ? { ...x, photoEnabled: v } : x)))}
        onToggleStory={(v) => {
          console.log(`[story] toggle char=${active.id} → ${v ? "剧情模式" : "普通聊天"}`);
          setCharacters((prev) => prev.map((x) => (x.id === active.id ? { ...x, storyMode: v } : x)));
        }}
        onPickVoice={(vid) => setCharacters((prev) => prev.map((x) => (x.id === active.id ? { ...x, voiceId: vid } : x)))}
      />
    );
  }
  if (view === "prefs") {
    return <PrefsEditor prefs={prefs} onSave={setPrefs} onCancel={() => setView("chat")} />;
  }
  if (view === "worldbooks") {
    return (
      <WorldBookPicker
        books={books}
        boundIds={active.boundWorldBookIds ?? []}
        onDone={(ids) => {
          setCharacters((prev) => prev.map((x) => (x.id === active.id ? { ...x, boundWorldBookIds: ids } : x)));
          setView("edit");
        }}
        onBack={() => setView("edit")}
      />
    );
  }
  if (view === "stickers") {
    return <StickerPanel stickers={stickers} onSend={sendSticker} onBack={() => setView("chat")} />;
  }

  // ===== 主聊天视图 =====
  const hasDraft = Boolean(input.trim());
  const lastEntry = log[log.length - 1];
  const awaitingReply = Boolean(lastEntry && lastEntry.role === "user");
  const showGenerate = !prefs.sendReplacesGenerate;
  const vc = loadVoiceConfig();
  const canSpeak = voiceReady(vc, config);
  // 前情提要：仅在角色主动找过你（最后一条是带 proactive 标记场景的 assistant 消息且你没回过）时显示一句话
  const firstAssistant = log.find((e) => e.role === "assistant");
  const noUserYet = !log.some((e) => e.role === "user");
  const recapLine =
    firstAssistant && noUserYet
      ? `${active.name} 最近主动找你：「${firstAssistant.content.split("\n")[0].slice(0, 30)}…」`
      : null;

  return (
    <div
      className="flex h-full flex-col bg-[linear-gradient(160deg,oklch(0.96_0.03_92),oklch(0.92_0.045_78))] bg-cover bg-center"
      style={background ? { backgroundImage: `url(${background})` } : undefined}
    >
      <div className="glass-nav flex items-center justify-between px-2 py-2">
        <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={() => setView("list")} aria-label="会话列表">
          <ChevronLeft className="size-5" />
        </Button>
        <div className="flex items-center gap-2">
          <Avatar character={active} size={28} status={pending ? "typing" : ready ? "online" : "offline"} />
          <div className="text-center leading-tight">
            <span className="block text-sm font-semibold">{active.name || "未命名角色"}</span>
            <span className={`block text-[10px] ${pending ? "text-primary" : ready ? "text-success" : "text-warning"}`}>
              {pending ? "正在回复…" : ready ? "在线" : "未配置接口"}
            </span>
          </div>
        </div>
        <div className="flex">
          <button
            type="button"
            onClick={() => {
              const v = !active.storyMode;
              console.log(`[story] toggle char=${active.id} → ${v ? "剧情模式" : "普通聊天"}`);
              setCharacters((prev) => prev.map((x) => (x.id === active.id ? { ...x, storyMode: v } : x)));
            }}
            aria-label="切换互动剧情模式"
            className={`jelly-btn mr-1 flex h-7 items-center gap-1 rounded-full px-2.5 text-[10px] font-semibold transition-colors ${
              active.storyMode ? "bg-primary text-primary-foreground" : "glass text-secondary-foreground"
            }`}
          >
            <BookText className="size-3" />
            剧情
          </button>
          <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={() => setView("stickers")} aria-label="表情库">
            <SmilePlus className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={() => setView("prefs")} aria-label="输入与发送设置">
            <SlidersHorizontal className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={() => setView("edit")} aria-label="编辑角色">
            <Settings2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="jelly-icon size-8"
            onClick={() => {
              clearChatLog(active.id);
              setLog([]);
            }}
            aria-label="清空聊天记录"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {/* 前情提要：一句话小灰框，不展开完整设定 */}
      {recapLine && (
        <div className="fade-up mx-3 mt-2 rounded-xl bg-black/[0.06] px-3 py-1.5 text-[10.5px] leading-relaxed text-muted-foreground backdrop-blur-sm">
          {recapLine}
        </div>
      )}

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {log.length === 0 && !pending && (
          <p className="pt-10 text-center text-xs text-muted-foreground">
            和 {active.name || "TA"} 说点什么吧
            {!ready && <><br />（先在「设置」里接好 API）</>}
          </p>
        )}
        {log.map((entry, i) => {
          // 剧情内容统一渲染为聊天区中间的浅灰剧情框（不用消息气泡）；用户消息转第二人称"你："叙述
          const prevStory = i > 0 && log[i - 1].story;
          if (entry.story || prevStory) {
            return (
              <div key={entry.id} className="fade-up mx-auto w-full max-w-[92%] whitespace-pre-wrap break-words rounded-xl bg-black/[0.05] px-3.5 py-2.5 text-[12px] leading-relaxed text-muted-foreground backdrop-blur-sm">
                {entry.role === "user" ? `你：${entry.content}` : entry.content}
              </div>
            );
          }
          return entry.role === "user" ? (
            <div key={entry.id} className="flex flex-col items-end gap-1">
              {entry.stickerUrl ? (
                <img src={entry.stickerUrl} alt="表情" className="w-24 rounded-2xl shadow-md shadow-[var(--bubble-shadow)]" />
              ) : (
                <Bubble side="right">{entry.content}</Bubble>
              )}
              <span className="msg-time pr-1">{fmtTime(entry.at)}</span>
              {entry.failed && !pending && (
                <Button
                  size="sm"
                  variant="outline"
                  className="jelly-btn h-6 gap-1 rounded-full border-destructive/40 px-2 text-[10px] text-destructive hover:bg-destructive/5 hover:text-destructive"
                  onClick={() => retry(entry.id)}
                >
                  <RefreshCw className="size-3" />
                  回复失败，点此重试
                </Button>
              )}
            </div>
          ) : (
            <AssistantRow
              key={entry.id}
              entry={entry}
              character={active}
              stickerLib={stickers}
              online={ready}
              canSpeak={canSpeak}
              speaking={voiceBusy === entry.id}
              onSpeak={() => void speak(entry.id, entry.content)}
            />
          );
        })}
        {pending && (
          <div className="flex items-end gap-2">
            <Avatar character={active} size={26} status="typing" />
            <div className="bubble-cream flex items-center gap-1.5 rounded-3xl px-3.5 py-2.5">
              {[0, 1, 2].map((i) => (
                <span key={i} className="typing-dot size-1.5 rounded-full bg-primary/60" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
              <span className="ml-1 text-[10px] text-muted-foreground">正在输入中…</span>
            </div>
          </div>
        )}
      </div>

      <div className="glass-nav border-t border-white/50 px-3 py-2.5">
        {showGenerate && (hasDraft || awaitingReply) && !pending && ready && (
          <Button
            size="sm"
            variant="outline"
            className="jelly-blob mb-2 h-7 w-full gap-1.5 rounded-xl border-primary/40 bg-white/50 text-[11px] font-semibold text-primary hover:bg-primary/5"
            onClick={generate}
          >
            <WandSparkles className="size-3.5" />
            生成回复
            {hasDraft ? "（连同草稿一起发出）" : ""}
          </Button>
        )}
        <div className="flex items-center gap-2">
          <Input
            placeholder={
              !ready
                ? "请先在设置中接入接口"
                : prefs.sendReplacesGenerate
                  ? `发给 ${active.name || "TA"}，点击即生成回复…`
                  : `输入内容，${prefs.enterSendsText ? "回车" : "右侧按钮"}只发文字…`
            }
            value={input}
            disabled={!ready || pending}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-9 rounded-full glass-input text-[13px] disabled:opacity-60"
          />
          <Button
            size="icon"
            className="jelly-icon size-9 shrink-0 rounded-full"
            onClick={primaryAction}
            disabled={!ready || pending || (!prefs.sendReplacesGenerate && !hasDraft)}
            aria-label={prefs.sendReplacesGenerate ? "发送并生成" : "发送"}
          >
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ================= 会话列表（微信式） ================= */

function ConversationList({
  characters,
  activeId,
  marks,
  generating,
  onSelect,
  onNew,
  onImport,
  onDelete,
  onBack,
}: {
  characters: Character[];
  activeId: string;
  marks: ReadMarks;
  generating: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onImport: () => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((v) => v + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const rows = characters
    .map((c) => {
      const last = readLastEntry(c.id);
      return { c, last };
    })
    .sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0));

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="glass-nav flex items-center justify-between px-2 py-2">
        <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onBack} aria-label="返回">
          <ChevronLeft className="size-5" />
        </Button>
        <span className="text-sm font-semibold">短信</span>
        <div className="flex items-center gap-1.5">
          {generating && (
            <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
              <LoaderCircle className="size-3 animate-spin" />
              TA 们正在酝酿消息…
            </span>
          )}
          <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onImport} aria-label="导入角色卡">
            <FileInput className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onNew} aria-label="新建角色">
            <Plus className="size-4" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {rows.length === 0 && (
          <p className="pt-16 text-center text-xs text-muted-foreground">还没有会话，点右上角 + 新建或导入角色卡</p>
        )}
        {rows.map(({ c, last }, i) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c.id)}
            data-reveal-delay={String(i * 40)}
            className={`reveal reveal-up jelly-btn group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-primary/5 ${
              c.id === activeId ? "bg-primary/8" : ""
            }`}
          >
            <Avatar character={c} size={44} status={c.proactiveEnabled ? "online" : "offline"} badge={unreadCount(c.id, marks)} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13.5px] font-semibold">{c.name || "未命名角色"}</span>
                {last && <span className="shrink-0 text-[10px] text-muted-foreground">{fmtTime(last.at)}</span>}
              </span>
              <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                {last ? last.content.replace(/\[表情:[^\]]*\]/g, "[表情]").split("\n")[0] : "开始和 TA 聊天吧"}
              </span>
            </span>
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(c.id);
              }}
              className="hidden size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:flex"
              aria-label={`删除 ${c.name}`}
            >
              <X className="size-3.5" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ================= 一键导入 ================= */

function ImportView({
  onBack,
  onImportCard,
  onImportWorld,
}: {
  onBack: () => void;
  onImportCard: (md: string) => void;
  onImportWorld: (md: string, fileName: string) => void;
}) {
  const [mode, setMode] = useState<"card" | "world">("card");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFile = (file?: File) => {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result));
    reader.readAsText(file);
  };

  const submit = () => {
    if (!text.trim()) return;
    if (mode === "card") onImportCard(text);
    else onImportWorld(text, fileName || "导入世界书");
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <NavBar title="一键导入" onBack={onBack} />
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <div className="flex gap-2">
          {(
            [
              { k: "card", label: "角色卡 → 新角色" },
              { k: "world", label: "世界书 → 设定条目" },
            ] as const
          ).map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={() => setMode(t.k)}
              className={`jelly-btn flex-1 rounded-xl py-2 text-xs font-semibold transition-colors ${
                mode === t.k ? "bg-primary text-primary-foreground" : "glass text-secondary-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="jelly-btn flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/40 bg-white/40 py-4 text-xs font-medium text-primary"
        >
          <FileInput className="size-4" />
          {fileName || (mode === "card" ? "选择 .md 角色卡文件" : "选择 .md 世界书文件")}
        </button>
        <input ref={fileRef} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
        <Textarea
          rows={10}
          placeholder="也可以直接把 Markdown 全文粘贴到这里…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="resize-none rounded-xl bg-muted/40 text-[12px] leading-relaxed"
        />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {mode === "card"
            ? "解析标题作为角色名、正文作为人设，自动创建角色并绑定现有局部世界书；随后可在角色设定里微调。"
            : "按二级标题拆成多条局部世界书条目，创建后到各角色的「绑定世界书」里勾选生效。"}
        </p>
        <Button className="jelly-blob w-full rounded-2xl py-4 text-sm font-semibold" onClick={submit} disabled={!text.trim()}>
          {mode === "card" ? "导入为角色" : "导入为世界书"}
        </Button>
      </div>
    </div>
  );
}

/* ================= 通用导航条 ================= */

function NavBar({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="glass-nav flex items-center justify-between px-2 py-2">
      <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onBack} aria-label="返回">
        <ChevronLeft className="size-5" />
      </Button>
      <span className="text-sm font-semibold">{title}</span>
      <span className="size-8" />
    </div>
  );
}

/* ================= 助手消息行 ================= */

function AssistantRow({
  entry,
  character,
  stickerLib,
  online,
  canSpeak,
  speaking,
  onSpeak,
}: {
  entry: ChatEntry;
  character: Character;
  stickerLib: Sticker[];
  online: boolean;
  canSpeak: boolean;
  speaking: boolean;
  onSpeak: () => void;
}) {
  const lines = splitBubbles(entry.content);
  const parts = lines.flatMap((line) => parseReplyToMessages(line, stickerLib));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-2">
        <Avatar character={character} size={26} status={online ? "online" : "offline"} />
        <div className="flex max-w-[82%] flex-col items-start gap-1.5">
          {entry.photoUrl && (
            <img
              src={entry.photoUrl}
              alt={`${character.name}的日常`}
              className="w-40 rounded-2xl object-cover shadow-md shadow-[var(--bubble-shadow)]"
            />
          )}
          {parts.map((p, i) => (
            <div key={i} data-reveal-delay={String(i * 60)} className="reveal reveal-up">
              {p.type === "sticker" ? (
                <img src={p.sticker.url} alt={p.sticker.name} className="w-24 rounded-2xl shadow-md shadow-[var(--bubble-shadow)]" />
              ) : (
                <Bubble side="left">{p.content}</Bubble>
              )}
            </div>
          ))}
        </div>
        {canSpeak && (
          <button
            type="button"
            onClick={onSpeak}
            aria-label="朗读这条消息"
            className={`jelly-icon mt-1 flex size-6 shrink-0 items-center justify-center rounded-full transition-colors ${
              speaking ? "bg-primary/15 text-primary pulse-dot" : "text-muted-foreground hover:text-primary"
            }`}
          >
            <Volume2 className="size-3.5" />
          </button>
        )}
      </div>
      <span className="msg-time pl-10">{fmtTime(entry.at)}</span>
    </div>
  );
}

/** 奶油浅透毛玻璃大圆角气泡：柔和淡阴影、无粗边框；我方比 TA 深一档暖黄区分方向 */
function Bubble({ side, children }: { side: "left" | "right"; children: React.ReactNode }) {
  return (
    <div
      className={`bubble-cream whitespace-pre-wrap break-words rounded-3xl px-3.5 py-2 text-[12.5px] leading-relaxed ${
        side === "right" ? "bubble-cream-me rounded-br-lg" : "rounded-bl-lg"
      }`}
    >
      {children}
    </div>
  );
}

type DotStatus = "online" | "typing" | "offline";

function Avatar({ character, size, status, badge }: { character: Character; size: number; status?: DotStatus; badge?: number }) {
  const isImg = character.avatar.startsWith("data:") || character.avatar.startsWith("http");
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        className="flex size-full items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-wallpaper-from to-wallpaper-to ring-1 ring-white/40"
        style={{ fontSize: size * 0.55 }}
      >
        {isImg ? <img src={character.avatar} alt="角色头像" className="size-full object-cover" /> : character.avatar || "👤"}
      </span>
      {status && !badge && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-white/80 ${
            status === "online" ? "bg-success" : status === "typing" ? "bg-warning pulse-dot" : "bg-muted-foreground/50"
          }`}
          style={{ width: Math.max(7, size * 0.28), height: Math.max(7, size * 0.28) }}
          aria-label={status === "online" ? "在线" : status === "typing" ? "正在输入" : "离线"}
        />
      )}
      {!!badge && (
        <span
          className="absolute -right-1.5 -top-1.5 flex min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-4 text-white shadow-sm"
          aria-label={`${badge} 条未读`}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </span>
  );
}

/* ================= 表情库速览（可点发） ================= */

function StickerPanel({ stickers, onSend, onBack }: { stickers: Sticker[]; onSend: (s: Sticker) => void; onBack: () => void }) {
  const usable = stickers.filter((s) => s.isGlobal);
  return (
    <div className="flex h-full flex-col bg-background">
      <NavBar title="当前可用表情" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {usable.length === 0 ? (
          <p className="pt-10 text-center text-xs leading-relaxed text-muted-foreground">
            还没有全局表情。
            <br />
            去桌面「表情包」应用上传，AI 聊天时就会按名字调用它们。
          </p>
        ) : (
          <>
            <p className="mb-2 px-1 text-[11px] text-muted-foreground">点一下直接作为你的消息发出</p>
            <div className="grid grid-cols-3 gap-2.5">
              {usable.map((s) => (
                <button key={s.id} type="button" onClick={() => onSend(s)} className="jelly-icon rounded-xl border border-border bg-card p-1.5 text-left">
                  <img src={s.url} alt={s.name} className="aspect-square w-full rounded-lg object-cover" />
                  <p className="mt-1 truncate text-center text-[11px]">{s.name}</p>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ================= 输入与发送习惯 ================= */

function PrefsEditor({ prefs, onSave, onCancel }: { prefs: SendPrefs; onSave: (p: SendPrefs) => void; onCancel: () => void }) {
  const [form, setForm] = useState<SendPrefs>(prefs);
  const rows: { key: keyof SendPrefs; label: string; desc: string }[] = [
    { key: "sendReplacesGenerate", label: "发送按钮代替生成按钮", desc: "开启后点发送直接请求回复（一问一答）；关闭则发送只发文字，另出现“生成回复”按钮。" },
    { key: "enterSendsText", label: "回车发送文字", desc: "开启后回车立即发出这条文字；关闭时回车不发，可连发多条后再点触发。" },
    { key: "autoReplyAfterSend", label: "发完后自动生成回复", desc: "输入框没有草稿且停止输入 2 秒后自动开始回复；期间继续输入或发新消息会重新等待。" },
  ];

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="glass-nav flex items-center justify-between px-2 py-2">
        <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onCancel} aria-label="取消">
          <ChevronLeft className="size-5" />
        </Button>
        <div className="text-center leading-tight">
          <span className="block text-sm font-semibold">输入与发送</span>
          <span className="block text-[10px] text-muted-foreground">以下习惯对当前设备的聊天生效</span>
        </div>
        <Button size="sm" className="jelly-btn h-8 rounded-full px-3 text-xs" onClick={() => { onSave(form); onCancel(); }}>
          保存
        </Button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {rows.map((r) => (
          <div key={r.key} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-3">
              <Label className="cursor-pointer text-[13px] font-semibold" htmlFor={r.key}>{r.label}</Label>
              <Switch id={r.key} checked={form[r.key]} onCheckedChange={(v) => setForm((f) => ({ ...f, [r.key]: v }))} />
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{r.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= 角色设定（含音色/主动/照片开关） ================= */

function CharacterEditor({
  character,
  books,
  bookCount,
  onSave,
  onCancel,
  onOpenWorldBooks,
  onToggleProactive,
  onTogglePhoto,
  onToggleStory,
  onPickVoice,
}: {
  character: Character;
  books: WorldBook[];
  bookCount: number;
  onSave: (c: Character) => void;
  onCancel: () => void;
  onOpenWorldBooks: () => void;
  onToggleProactive: (v: boolean) => void;
  onTogglePhoto: (v: boolean) => void;
  onToggleStory: (v: boolean) => void;
  onPickVoice: (id: string) => void;
}) {
  const [form, setForm] = useState<Character>(character);
  const fileRef = useRef<HTMLInputElement>(null);
  const voices = loadVoiceConfig().voices;

  const pickFile = (file?: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, avatar: String(reader.result) }));
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="glass-nav flex items-center justify-between px-2 py-2">
        <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onCancel} aria-label="取消">
          <ChevronLeft className="size-5" />
        </Button>
        <span className="text-sm font-semibold">角色设定</span>
        <Button
          size="sm"
          className="jelly-btn h-8 rounded-full px-3 text-xs"
          onClick={() =>
            onSave({
              ...form,
              name: form.name.trim(),
              avatar: form.avatar,
              persona: form.persona.trim(),
              boundWorldBookIds: form.boundWorldBookIds,
            })
          }
        >
          保存
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div className="flex flex-col items-center gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} className="jelly-icon group relative" aria-label="上传头像">
            <Avatar character={form} size={64} />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
              <Upload className="size-4 text-white" />
            </span>
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
          <div className="flex flex-wrap justify-center gap-1.5">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setForm((f) => ({ ...f, avatar: e }))}
                className={`jelly-icon flex size-8 items-center justify-center rounded-full text-lg transition-all ${
                  form.avatar === e ? "bg-primary/15 ring-2 ring-primary" : "bg-secondary hover:scale-110"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">点头像上传图片（≤2MB），或选一个表情</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="charName">角色名字</Label>
          <Input id="charName" placeholder="例如：小灵" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="h-10 rounded-lg bg-muted/40 text-[13px]" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="charPersona">人设（作为系统提示发给模型）</Label>
          <Textarea id="charPersona" rows={8} placeholder="描述 TA 的身份、性格、说话方式……" value={form.persona} onChange={(e) => setForm((f) => ({ ...f, persona: e.target.value }))} className="resize-none rounded-lg bg-muted/40 text-[12px] leading-relaxed" />
        </div>

        <button type="button" onClick={onOpenWorldBooks} className="jelly-btn flex w-full items-center gap-2 rounded-xl border border-border bg-card p-3 text-left">
          <BookText className="size-4 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold">绑定局部世界书</span>
            <span className="block text-[11px] text-muted-foreground">已绑 {form.boundWorldBookIds?.length ?? 0} 条 / 可选 {bookCount} 条；全局条目自动生效</span>
          </span>
          <ChevronLeft className="size-4 -rotate-90 text-muted-foreground" />
        </button>

        {/* 互动开关 */}
        <div className="space-y-2 rounded-xl border border-border bg-card p-3">
          <div className="flex items-center justify-between gap-3">
            <Label className="cursor-pointer text-[13px] font-semibold" htmlFor="storySw">互动剧情模式</Label>
            <Switch
              id="storySw"
              checked={form.storyMode ?? false}
              onCheckedChange={(v) => {
                setForm((f) => ({ ...f, storyMode: v }));
                onToggleStory(v);
              }}
            />
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">开启后聊天变为小说式互动剧情：你是"你"，TA 用第三人称叙述；与私聊记忆互通。也可在聊天页顶部随时切换。</p>
          <div className="flex items-center justify-between gap-3">
            <Label className="cursor-pointer text-[13px] font-semibold" htmlFor="proactiveSw">允许主动找我聊天</Label>
            <Switch
              id="proactiveSw"
              checked={form.proactiveEnabled ?? true}
              onCheckedChange={(v) => {
                setForm((f) => ({ ...f, proactiveEnabled: v }));
                onToggleProactive(v);
              }}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <Label className="cursor-pointer text-[13px] font-semibold" htmlFor="photoSw">会分享写实日常照片</Label>
            <Switch
              id="photoSw"
              checked={form.photoEnabled ?? false}
              onCheckedChange={(v) => {
                setForm((f) => ({ ...f, photoEnabled: v }));
                onTogglePhoto(v);
              }}
            />
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">主动消息只在长时间没聊时偶尔发生，正文贴合人设不带旁白；照片优先走外部生图接口，不可用时用预置素材。</p>
        </div>

        {/* 音色绑定 */}
        <div className="space-y-2 rounded-xl border border-border bg-card p-3">
          <p className="text-[13px] font-semibold">专属音色（外部语音）</p>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => {
                setForm((f) => ({ ...f, voiceId: undefined }));
                onPickVoice("");
              }}
              className={`jelly-btn rounded-full px-2.5 py-1 text-[11px] ${!form.voiceId ? "bg-primary text-primary-foreground" : "glass text-secondary-foreground"}`}
            >
              不绑定
            </button>
            {voices.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => {
                  setForm((f) => ({ ...f, voiceId: v.id }));
                  onPickVoice(v.id);
                }}
                className={`jelly-btn rounded-full px-2.5 py-1 text-[11px] ${form.voiceId === v.id ? "bg-primary text-primary-foreground" : "glass text-secondary-foreground"}`}
              >
                {v.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">
            音色清单在「设置 → 外部语音」维护；绑定后点消息旁的喇叭就用这个音色朗读。
            {books.length > 0 && ""}
          </p>
        </div>
      </div>
    </div>
  );
}

/** 角色页进入的局部世界书勾选器 */
function WorldBookPicker({
  books,
  boundIds,
  onDone,
  onBack,
}: {
  books: WorldBook[];
  boundIds: string[];
  onDone: (ids: string[]) => void;
  onBack: () => void;
}) {
  const [sel, setSel] = useState<string[]>(boundIds);
  const locals = books.filter((b) => b.scope === "local");

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="glass-nav flex items-center justify-between px-2 py-2">
        <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onBack} aria-label="返回">
          <ChevronLeft className="size-5" />
        </Button>
        <span className="text-sm font-semibold">绑定世界书</span>
        <Button size="sm" className="jelly-btn h-8 rounded-full px-3 text-xs" onClick={() => onDone(sel)}>
          确定
        </Button>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        <p className="px-1 text-[11px] text-muted-foreground">全局条目对所有角色自动生效；这里勾选本角色专属的局部设定。</p>
        {locals.length === 0 && <p className="pt-8 text-center text-xs text-muted-foreground">还没有局部条目，去桌面「世界书」应用新建或用「一键导入」</p>}
        {locals.map((wb) => {
          const on = sel.includes(wb.id);
          return (
            <button
              key={wb.id}
              type="button"
              onClick={() => setSel((s) => (on ? s.filter((x) => x !== wb.id) : [...s, wb.id]))}
              className={`jelly-btn flex w-full items-center gap-2 rounded-xl border p-3 text-left ${on ? "border-primary bg-primary/10" : "border-border bg-card"}`}
            >
              <span className={`flex size-5 shrink-0 items-center justify-center rounded-md border ${on ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                {on && <Check className="size-3.5" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold">{wb.name || "未命名设定"}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{wb.content}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
