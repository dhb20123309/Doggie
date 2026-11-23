// 「短信」应用：微信式会话列表单选角色 + 分角色聊天 + 表情发送 + 语音朗读 + 前情提要 + 主动消息
import { useCallback, useEffect, useRef, useState, type UIEvent } from "react";
import {
  ChevronLeft,
  SendHorizontal,
  LoaderCircle,
  RefreshCw,
  Settings2,
  Trash2,
  Upload,
  WandSparkles,
  Sparkles,
  SlidersHorizontal,
  BookText,
  SmilePlus,
  Check,
  Plus,
  Users,
  FileInput,
  Volume2,
  X,
  MoreVertical,
  Ban,
  Quote,
  Banknote,
  ImagePlus,
  Coins,
  MapPin,
  UtensilsCrossed,
  Gift,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AiConfig } from "@/lib/types";
import { isConfigured } from "@/lib/types";
import { chatCompletion, chatStream, type ChatPart } from "@/lib/ai-api";
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
  displayName,
  QUOTE_PROTOCOL,
  extractQuote,
  TRANSFER_PROTOCOL,
  extractTransfer,
  looksLikeReceive,
  LOCATION_PROTOCOL,
  extractLocation,
  ORDER_PROTOCOL,
  extractOrder,
  QUEUE_AUTO_FLUSH_MS,
  QUEUE_MAX,
} from "@/lib/chat-types";
import { PLACE_PRESETS } from "@/lib/delivery-store";
import {
  useWallet,
  readWallet,
  walletUserSend,
  walletCharSend,
  walletUserReceive,
  walletCharRestore,
} from "@/lib/wallet-store";
import {
  type WorldBook,
  type Sticker,
  getActiveWorldBooks,
  buildWorldSectionV2,
  extractIntroRequests,
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
  usePersisted,
} from "@/lib/chat-store";
import { loadVoiceConfig, voiceReady, synthesizeSpeech, MINIMAX_VOICES } from "@/lib/tts";
import { generateCharPhoto, photoPrompt, matchPhotoScene } from "@/lib/media";
import { PROACTIVE_PROTOCOL, pickTopicSeeds } from "@/lib/proactive-protocol";
import { HUMAN_TYPING_PROTOCOL, buildCountHint, countReplyLines } from "@/lib/human-typing";
import { CHARACTER_FIDELITY, ONLINE_CHAT_ECONOMY, PROACTIVE_REPORT_POOL } from "@/lib/adult-worldbook";
import {
  LANGUAGE_PROTOCOL,
  ANTI_GREASE_BASELINE,
  LIVING_PERSON_PROTOCOL,
  TEXT_STYLE_PROTOCOL,
  PROGRESSIVE_BOND_PROTOCOL,
  EMOTION_RESTRAINT_PROTOCOL,
  NARRATIVE_NO_AI_FLAVOR,
} from "@/lib/liveliness-worldbook";
import { PRESET_MEME_BOOK } from "@/lib/meme-book-data";
import { type MemeEntry, type MemePrefs, DEFAULT_MEME_PREFS, buildMemeSection } from "@/lib/meme-worldbook";
import { useProfiles, presetProfileFor, parseProfileMd, type CharacterProfile } from "@/lib/character-profile";
import { ToolboxButton, ToolboxMenu, ProfileDrawer, ProfileStandalonePage, OpenerStrip, OpenerCard, InlineProfileCard, ProfileImportPanel } from "./ProfileSheet";
import { parseCharacterCard, cardToCharacter, parseWorldBookMd } from "@/lib/import-parse";
import { emitNotify } from "@/lib/notification-store";
import { REALITY_MCP_PROTOCOL, extractMcpMarks, execMcpActions, buildMcpContext, loadMcpPrefs, extractRemoteMarks, execRemoteMarks, answerRemoteConfirm, type McpAction } from "@/lib/reality-mcp";
import { loadServers as loadRemoteServers, loadToolCache, callTool, buildRemoteMcpContext, hasMediumConsent, grantMediumConsent, type RemoteMcpServer } from "@/lib/remote-mcp";
import { GroupChatView } from "@/components/GroupChatView";
import { Avatar } from "@/components/Avatar";
import { type GroupChat, useGroups, readGroupLast, readGroupLog, newGroupId, clearGroupLog, groupDigestFor } from "@/lib/group-chat-store";

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

type View = "list" | "chat" | "edit" | "prefs" | "worldbooks" | "stickers" | "import" | "detail" | "group";

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
  /** 热梗世界书偏好（开关 + 全量常驻注入），与设置页共享 vp-phone:memebook:prefs:v1 */
  const [memePrefs] = usePersisted<MemePrefs>("vp-phone:memebook:prefs:v1", DEFAULT_MEME_PREFS);
  const [view, setView] = useState<View>(() => {
    // 截图验收直达指定会话：?vpApp=rolechat&vpChar=<charId>（activeId 在 effect 里校正，见下）
    try {
      const cid = new URLSearchParams(window.location.search).get("vpChar");
      if (cid) return "chat";
    } catch {
      /* ignore */
    }
    return "list";
  });
  const [input, setInput] = useState("");
  // ===== 群聊（第62轮）：groups 列表 + 当前打开的群 id + 建群弹层开关 =====
  const [groups, setGroups] = useGroups();
  const [activeGroupId, setActiveGroupId] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const activeGroup = groups.find((g) => g.id === activeGroupId);
  const [pending, setPending] = useState(false);
  /** 并发闸门：charId → 是否有回复请求在飞（含流式输出中）。pending 在流式首 chunk 即释放，不能作为唯一闸门 */
  const inflightRef = useRef<Set<string>>(new Set());
  const [voiceBusy, setVoiceBusy] = useState<string | null>(null);
  const [proactiveBusy, setProactiveBusy] = useState(false);
  const [marks, setMarks] = useReadMarks();
  const listRef = useRef<HTMLDivElement>(null);
  const ready = isConfigured(config);

  // ===== 工具箱-人物档案（模块独立：只负责展示与剧情加载，不碰 system/黑白名单） =====
  const [profiles, setProfiles] = useProfiles();
  const [toolboxOpen, setToolboxOpen] = useState(false);
  /** 拉黑彩蛋问询弹窗（在聊天页展示，只有"不拉黑了ovo"一个出口） */
  const [blockedAsk, setBlockedAsk] = useState(false);
  /** drawer=侧边抽屉（首次进会话点白条弹出）；page=独立静态页（清空记录后从工具箱进入） */
  const [profileMode, setProfileMode] = useState<"none" | "drawer" | "page">("none");
  const [openerExpanded, setOpenerExpanded] = useState(false);
  /** 开场白卡：进会话默认已展开，下滑滚动或点"收起开场白"后收回为白条 */
  const [openerCollapsed, setOpenerCollapsed] = useState(false);
  const [profileImportOpen, setProfileImportOpen] = useState(false);
  /** 清空过记录的 charId：开场白条消失且不再自动弹出（localStorage 记忆，重新发消息后恢复） */
  const [chatCleared, setChatCleared] = usePersisted<Record<string, boolean>>("vp-phone:chat-cleared:v1", {});
  /** 当前角色档案：用户导入优先，缺失时回落内置预置（两份 charId 数据隔离） */
  const profile: CharacterProfile | null = active ? profiles[active.id] ?? presetProfileFor(active.id) : null;
  // 首次使用把两份预置档案落盘一次（导入哪份生效哪份，之后不再覆盖）
  const presetSeeded = useRef(false);
  useEffect(() => {
    if (presetSeeded.current) return;
    presetSeeded.current = true;
    setProfiles((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of ["zhou-chenyan", "zhou-fengyan"]) {
        const fresh = presetProfileFor(id);
        // 缺失或旧版预置（无 hero 分节/标签）时用新解析结果覆盖一次；用户自行导入的档案不动
        if (fresh && (!next[id] || !next[id].sections.some((s) => s.key === "hero"))) {
          next[id] = fresh;
          changed = true;
        }
      }
      if (changed) console.log("[profile] seed preset 周晨砚/周风砚 档案落盘（酒馆排版新版）");
      return changed ? next : prev;
    });
  }, [setProfiles]);
  // 切会话时收起所有档案形态与展开态
  const profileCharRef = useRef(active?.id ?? "");
  if (profileCharRef.current !== (active?.id ?? "")) {
    profileCharRef.current = active?.id ?? "";
    setToolboxOpen(false);
    setProfileMode("none");
    setOpenerExpanded(false);
    // 进会话默认展开完整档案卡（用户主动收起只作用于本次停留）
    setOpenerCollapsed(false);
    setProfileImportOpen(false);
    console.log(`[profile] enter chat char=${active?.id} opener default expanded`);
  }

  // 兜底：预置角色存储档案缺 opener（旧版数据）时现取预置解析结果，保证进会话默认展开档案卡
  const effectiveProfile: CharacterProfile | null =
    profile && !profile.opener && active?.id.startsWith("zhou-") ? presetProfileFor(active.id) ?? profile : profile;

  /** 开场白完整档案卡是否展示：有档案且未清空记录、非工具箱内联展开态 */
  const openerShown = !!(active && effectiveProfile?.opener && !chatCleared[active.id] && !openerExpanded);

  // 诊断日志：确认渲染分支与收起状态（排查"进会话看不到默认开场白 / 无法下滑只能收起"）
  console.log(`[profile] render char=${active?.id} openerShown=${openerShown} collapsed=${openerCollapsed} cleared=${!!(active && chatCleared[active.id])} expanded=${openerExpanded}`);

  // 自愈：把缺 opener / 无 hero 分节的旧版预置存储档案刷成最新解析结果（用户自导档案不动）
  useEffect(() => {
    if (!profiles["zhou-chenyan"] && !profiles["zhou-fengyan"]) return;
    setProfiles((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of ["zhou-chenyan", "zhou-fengyan"]) {
        const old = next[id];
        if (!old || (old.opener && old.sections.some((s) => s.key === "hero"))) continue;
        const fresh = presetProfileFor(id);
        if (fresh) {
          next[id] = fresh;
          changed = true;
        }
      }
      if (changed) console.log("[profile] heal stale preset profiles → 补齐 opener/hero 分节");
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 消息流滚动：开场白卡随消息流整体下滑浏览；展开期间一旦触底（已看完）自动收起为白条 */
  const handleListScroll = (e: UIEvent<HTMLDivElement>) => {
    if (!openerShown || openerCollapsed) return;
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
      setOpenerCollapsed(true);
      console.log(`[profile] opener auto-collapsed char=${active?.id} on scroll-to-bottom`);
    }
  };

  // bugfix：内容不足一屏时不会触发滚动事件，旧逻辑会在 1.5s 后强制收起档案卡——这正是"无法下滑只能收起"的根源。
  // 新策略：不足一屏保持展开（本来就无需下滑）；超高内容由 handleListScroll 触底自动收起。
  useEffect(() => {
    if (!openerShown || openerCollapsed) return;
    const t = setTimeout(() => {
      const el = listRef.current;
      console.log(`[profile] fit-check char=${active?.id} scrollH=${el?.scrollHeight} clientH=${el?.clientHeight} → ${el && el.scrollHeight > el.clientHeight + 8 ? "可下滑浏览" : "不足一屏，保持展开"}`);
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openerShown, active?.id]);

  // bugfix：chatCleared 残留会永久隐藏开场白（旧版误把"清空记录"标记持久化）。
  // 只要该角色有可用开场白，进会话即清除残留标记，恢复默认展开；用户真正清空后重发消息同样走此路径恢复。
  useEffect(() => {
    if (!active) return;
    if (!chatCleared[active.id]) return;
    if (effectiveProfile?.opener) {
      setChatCleared((prev) => ({ ...prev, [active.id]: false }));
      console.log(`[profile] heal stale chatCleared char=${active.id} log=${log.length} → 恢复开场白默认展开`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, !!effectiveProfile?.opener]);

  // 截图验收直达会话校正：vpChar 优先；否则若进 chat 但无活动角色，落到第一个角色（修复空 activeId 导致开场白不展示）
  const vpCharChecked = useRef(false);
  useEffect(() => {
    if (view !== "chat" || characters.length === 0) return;
    let cid: string | null = null;
    try {
      cid = new URLSearchParams(window.location.search).get("vpChar");
    } catch {
      /* ignore */
    }
    if (cid && activeId !== cid) {
      setActiveId(cid);
      console.log(`[profile] vpChar corrected activeId=${cid}`);
    } else if (!cid && !characters.some((c) => c.id === activeId)) {
      setActiveId(characters[0].id);
      console.log(`[profile] fallback activeId=${characters[0].id} (was empty/invalid)`);
    }
    vpCharChecked.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, characters.length, activeId]);

  // 诊断：进入会话视图即打印关键状态（排查"哥哥会话看不到默认开场白"）
  useEffect(() => {
    if (view !== "chat") return;
    console.log(`[profile] view=chat char=${active?.id} profileOpenerLen=${profile?.opener.length ?? -1} effOpenerLen=${effectiveProfile?.opener.length ?? -1} cleared=${!!(active && chatCleared[active.id])} shown=${openerShown} collapsed=${openerCollapsed}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, active?.id, openerShown, openerCollapsed]);

  // 进入会话默认停在最新消息处：瞬时滚到底（smooth 会被开场白卡/图片渲染撑高截断），300ms 后内容稳定再校正一次
  useEffect(() => {
    if (view !== "chat") return;
    const snap = () => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "auto" });
    requestAnimationFrame(snap);
    const t = window.setTimeout(() => {
      snap();
      console.log(`[chat] enter scroll bottom char=${active?.id} len=${stateRef.current.log.length}`);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, active?.id]);

  /** 开局引子一键加载到互动剧情模式：作为首条剧情内容写入会话（记忆互通、完整保留），并开启该角色 storyMode */
  const loadIntroToStory = () => {
    if (!active || !profile?.intro) return;
    const entry: ChatEntry = { id: `story-intro-${Date.now()}`, role: "assistant", content: profile.intro, at: Date.now(), story: true };
    writeLogNow(active.id, (prev) => [...prev, entry]);
    setLog((prev) => [...prev, entry]);
    setCharacters((prev) => prev.map((x) => (x.id === active.id ? { ...x, storyMode: true } : x)));
    setProfileMode("none");
    setToolboxOpen(false);
    scrollBottom();
    console.log(`[profile] intro→story char=${active.id} len=${profile.intro.length}`);
  };
  const saveCover = (dataUrl: string) => {
    if (!active || !profile) return;
    setProfiles((prev) => ({ ...prev, [active.id]: { ...profile, coverUrl: dataUrl, updatedAt: Date.now() } }));
    console.log(`[profile] cover saved char=${active.id}`);
  };
  const importProfile = (name: string, text: string) => {
    if (!active) return;
    const p = parseProfileMd(text, active.id, name);
    p.name = name || p.name;
    if (profile?.coverUrl) p.coverUrl = profile.coverUrl;
    setProfiles((prev) => ({ ...prev, [active.id]: p }));
    setProfileImportOpen(false);
    setProfileMode("page");
    console.log(`[profile] import char=${active.id} sections=${p.sections.length} intro=${p.intro.length ? "有" : "无"}`);
  };

  const stateRef = useRef({ log, input, pending, ready, prefs });
  stateRef.current = { log, input, pending, ready, prefs };
  const autoTimer = useRef<number | null>(null);

  // ===== 引用功能（微信式 reply；剧情灰框消息不可引用） =====
  /** 输入框上方待发送的引用条 */
  const [quoteDraft, setQuoteDraft] = useState<{ name: string; content: string } | null>(null);
  /** 长按/右键某条消息后浮出的操作条目标 id */
  const [actionFor, setActionFor] = useState<string | null>(null);
  // 切会话时清掉待发引用与操作条
  if (profileCharRef.current !== (active?.id ?? "")) {
    setQuoteDraft(null);
    setActionFor(null);
  }
  useEffect(() => {
    if (!actionFor) return;
    const close = () => setActionFor(null);
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [actionFor]);

  /** 可引用候选列表：最近 20 条非失败、非剧情灰框、非拒收提示的消息（编号表与 AI 引用解析共用同一口径） */
  const quoteCandidates = (es: ChatEntry[]): ChatEntry[] =>
    es.filter((e) => !e.failed && !e.story && !e.blockedTip).slice(-20);

  /** 给 system 拼"可引用消息编号表"：[1] TA说：… / [2] 你说：… */
  const buildQuoteTable = (ch: Character, entries: ChatEntry[]): string => {
    const list = quoteCandidates(entries);
    if (!list.length) return "";
    const lines = list.map((e, i) => `[${i + 1}] ${e.role === "user" ? "你说" : ch.name || "TA"}说：${e.content.replace(/\s+/g, " ").slice(0, 40)}`);
    return `\n【可引用的历史消息编号表】\n${lines.join("\n")}\n（想引用哪条，就在那条回复最前面写 [引用:序号]）`;
  };

  /** 消化 assistant 回复里的 [引用:N]：行首或"引用："开头命中编号表即拆出 quote 小块；越界仅删标记 */
  const digestQuote = (reply: string, entries: ChatEntry[]): { text: string; quote?: { name: string; content: string } } => {
    const rawLines = reply.split(/\r?\n/);
    const firstLine = rawLines[0] ?? "";
    let idx: number | null = null;
    let clean = firstLine;
    const m = extractQuote(firstLine);
    if (m.idx != null) {
      idx = m.idx;
      clean = m.clean;
    } else {
      // 兜底：模型爱用"引用：xxx"纯文本格式——按内容在候选里找最接近的一条
      const t = firstLine.match(/^引用[:：]\s*(.+)$/);
      if (t) {
        const want = t[1].replace(/[\s"'“”‘’、。，,.!?！？~～…：:;；()（）\-—_·]/g, "");
        const list0 = quoteCandidates(entries);
        let best = -1;
        let bestScore = 0;
        list0.forEach((e, i) => {
          const c = e.content.replace(/[\s"'“”‘’、。，,.!?！？~～…：:;；()（）\-—_·]/g, "");
          const score = want && c && (c.includes(want) || want.includes(c)) ? Math.min(c.length, want.length) : 0;
          if (score > bestScore) {
            bestScore = score;
            best = i;
          }
        });
        if (best >= 0 && bestScore >= 2) {
          idx = best + 1;
          clean = "";
        } else {
          // 找不到对应原文：保留这行当普通文字，只去掉"引用："前缀易误伤，原样放行
          return { text: reply };
        }
      } else return { text: reply };
    }
    const list = quoteCandidates(entries);
    const target = list[idx - 1];
    if (!target) {
      console.log(`[quote] ai index=${idx} 越界丢弃 len=${list.length}`);
      const rest = rawLines.slice(1).filter(Boolean);
      return { text: rest.length ? `${clean}\n${rest.join("\n")}`.trim() : clean };
    }
    const quote = {
      name: target.role === "user" ? "我" : displayName(active ?? ({ name: "TA" } as Character)),
      content: target.content.replace(/\[表情:[^\]]*\]/g, "").trim().slice(0, 80) || "[图片]",
    };
    console.log(`[quote] ai cited #${idx} role=${target.role} → 渲染引用小块`);
    const rest = rawLines.slice(1).filter(Boolean);
    const body = clean.trim();
    const text = [body, ...rest].filter(Boolean).join("\n");
    return { text, quote };
  };

  /** 长按/右键消息 → 把该条塞进引用条（剧情灰框已在渲染层不挂此交互） */
  const citeEntry = (entry: ChatEntry) => {
    if (!active) return;
    const content = entry.stickerUrl
      ? "[表情包]"
      : entry.content.replace(/\[表情:[^\]]*\]/g, "").trim().slice(0, 80) || "[空消息]";
    setQuoteDraft({ name: entry.role === "user" ? "我" : displayName(active), content });
    setActionFor(null);
    console.log(`[quote] cite msg=${entry.id} role=${entry.role} → 引用条上屏`);
  };

  /** 在气泡外层包一层长按/右键操作（紧耦合子组件 MessageActions 内联本文件底部）；assistant 消息附带重新回复 */
  const wrapCitable = (entry: ChatEntry, node: React.ReactNode) => (
    <MessageActions
      key={entry.id}
      open={actionFor === entry.id}
      onOpenChange={(v) => setActionFor(v ? entry.id : null)}
      onCite={() => citeEntry(entry)}
      {...(entry.role === "assistant" && !entry.failed && !entry.proactive && !entry.transfer && !entry.location && !entry.order ? { onRegen: () => regenReply(entry.id) } : {})}
    >
      {node}
    </MessageActions>
  );

  /** 重新回复：对 TA 这条回复不满意——删掉该条及其后的 assistant 消息，回到触发它的那句用户消息重新生成。
   *  重发时带换说法指令，避免模型原样再回一遍；转账/剧情灰框/主动消息不参与（各有独立交互） */
  const regenReply = (entryId: string) => {
    if (!active || pending || !ready) return;
    const idx = log.findIndex((e) => e.id === entryId);
    if (idx < 0) return;
    let anchor = -1;
    for (let i = idx - 1; i >= 0; i--) {
      if (log[i].role === "user") {
        anchor = i;
        break;
      }
    }
    if (anchor < 0) {
      console.warn(`[regen] no user anchor before ${entryId}，跳过`);
      return;
    }
    const kept = log.slice(0, anchor + 1).map((en) => (en.id === log[anchor].id ? { ...en, failed: false } : en));
    console.log(`[regen] char=${active.id} msg=${entryId} → 截断到 ${log[anchor].id} 重发（界面丢弃 ${log.length - kept.length} 条后续消息）`);
    setLog(kept);
    // 存储按"删掉这条 assistant 及其后所有 assistant"处理：保留用户在此期间真实发出的新消息，只撤回复
    writeLogNow(active.id, (prev) => {
      const cut = prev.findIndex((e) => e.id === entryId);
      if (cut < 0) return prev;
      return prev.filter((e, i) => i < cut || e.role === "user");
    });
    setActionFor(null);
    regenHintRef.current = true;
    void requestReply(kept, log[anchor].id, Boolean(active.storyMode));
  };

  // ===== 转账（微信式橙色卡片；余额 vp-phone:wallet:v1） =====
  const [wallet, setWallet] = useWallet();
  /** 转账编辑面板（输入框上方弹层） */
  const [transferOpen, setTransferOpen] = useState(false);
  /** 定位选择面板（输入框上方弹层） */
  const [locationOpen, setLocationOpen] = useState(false);
  /** 发图输入：相册/拍照共用隐藏 file input */
  const photoInputRef = useRef<HTMLInputElement>(null);
  /** 点开详情的转账单 id */
  const [transferSheet, setTransferSheet] = useState<string | null>(null);
  /** 点开详情/收下的订单卡 id */
  const [orderSheet, setOrderSheet] = useState<string | null>(null);

  /** 用户发起转账：即时扣款入账 + 发一张 outgoing 卡片，随后请求角色回复（TA 会按协议对收钱作出反应） */
  const sendTransfer = (amount: number, note: string) => {
    if (!active || pending) return;
    // 余额校验与扣款统一走 walletUserSend（内部直写 localStorage），避免 setWallet 快照覆盖双份扣款
    if (!walletUserSend(active.id, amount, note, displayName(active))) {
      console.warn(`[transfer] 余额不足 need=${amount} have=${readWallet().userBalance}`);
      return;
    }
    setWallet(readWallet());
    const story = Boolean(active.storyMode);
    const userMsg: ChatEntry = {
      id: `t${Date.now()}`,
      role: "user",
      content: `¥${amount.toFixed(2)}`,
      at: Date.now(),
      transfer: { amount, note, from: "user", type: "outgoing" },
      ...(story ? { story: true } : {}),
    };
    setLog((prev) => [...prev, userMsg]);
    writeLogNow(active.id, (prev) => [...prev, userMsg]);
    setTransferOpen(false);
    scrollBottom();
    console.log(`[transfer] user → ${active.id} ¥${amount} "${note}"`);
    void requestReply([...stateRef.current.log, userMsg], userMsg.id, story);
  };

  /** AI 回复里的转账标记 → incoming 卡片（挂账扣 TA 余额，等用户点收） */
  const digestTransfer = (reply: string): { text: string; transfer?: ChatEntry["transfer"] } => {
    const t = extractTransfer(reply);
    if (!t) return { text: reply };
    if (active) walletCharSend(active.id, t.amount, t.note);
    console.log(`[transfer] char offered ¥${t.amount} "${t.note}" → 待用户点收`);
    return { text: t.clean, transfer: { amount: t.amount, note: t.note, from: "char", type: "incoming" } };
  };

  /** 自然语言收款兜底：模型没写标记但话说"收下啦"——把最近一笔用户 outgoing 未结算卡视为已收 */
  const settleIncomingByWords = (reply: string, entries: ChatEntry[]): boolean => {
    if (!looksLikeReceive(reply)) return false;
    const last = [...entries].reverse().find((e) => e.transfer?.type === "outgoing" && !e.transfer.settled);
    if (!last) return false;
    console.log(`[transfer] 自然语言收款命中 msg=${last.id}`);
    writeLogNow(active?.id ?? "", (prev) => prev.map((e) => (e.id === last.id ? { ...e, transfer: { ...e.transfer!, settled: "received" } } : e)));
    setLog((prev) => prev.map((e) => (e.id === last.id ? { ...e, transfer: { ...e.transfer!, settled: "received" } } : e)));
    return true;
  };

  /** 用户点收下 incoming 卡片：入账 + 卡片置灰"已收到"（钱包直写 localStorage 后同步 React 快照） */
  const receiveTransfer = (entry: ChatEntry) => {
    if (!entry.transfer || entry.transfer.settled || !active) return;
    walletUserReceive(active.id, entry.transfer.amount, entry.transfer.note, displayName(active));
    setWallet(readWallet());
    writeLogNow(active.id, (prev) => prev.map((e) => (e.id === entry.id ? { ...e, transfer: { ...e.transfer!, settled: "received" } } : e)));
    setLog((prev) => prev.map((e) => (e.id === entry.id ? { ...e, transfer: { ...e.transfer!, settled: "received" } } : e)));
    console.log(`[transfer] user received ¥${entry.transfer.amount} from ${active.id}`);
  };

  /** 用户退回 incoming 卡片：TA 挂账金额回滚 + 卡片"已退还" */
  const refundTransfer = (entry: ChatEntry) => {
    if (!entry.transfer || entry.transfer.settled || !active) return;
    walletCharRestore(active.id, entry.transfer.amount);
    setWallet(readWallet());
    writeLogNow(active.id, (prev) => prev.map((e) => (e.id === entry.id ? { ...e, transfer: { ...e.transfer!, settled: "refunded" } } : e)));
    setLog((prev) => prev.map((e) => (e.id === entry.id ? { ...e, transfer: { ...e.transfer!, settled: "refunded" } } : e)));
    console.log(`[transfer] user refunded ¥${entry.transfer.amount} back to ${active.id}`);
  };

  /** 用户发图片（相册选择/相机拍照压缩后的 data URL）：即时上屏并请求 TA 看图回复 */
  const sendPhoto = (dataUrl: string) => {
    if (!active || pending) return;
    const story = Boolean(active.storyMode);
    const userMsg: ChatEntry = {
      id: `i${Date.now()}`,
      role: "user",
      content: "",
      imageUrl: dataUrl,
      at: Date.now(),
      ...(story ? { story: true } : {}),
    };
    setLog((prev) => [...prev, userMsg]);
    writeLogNow(active.id, (prev) => [...prev, userMsg]);
    scrollBottom();
    console.log(`[photo] user → ${active.id} image attached (${Math.round(dataUrl.length / 1024)}KB base64)`);
    void requestReply([...stateRef.current.log, userMsg], userMsg.id, story);
  };

  const handlePhotoFile = async (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    try {
      // 与表情库同款压缩路径：最长边 ≤1280、质量压到 ~200KB 内，防 localStorage 超限
      const img = new Image();
      const objUrl = URL.createObjectURL(file);
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("decode"));
        img.src = objUrl;
      });
      URL.revokeObjectURL(objUrl);
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      let q = 0.85;
      let out = canvas.toDataURL("image/jpeg", q);
      while (out.length > 280_000 && q > 0.4) {
        q -= 0.15;
        out = canvas.toDataURL("image/jpeg", q);
      }
      sendPhoto(out);
    } catch {
      console.warn("[photo] compress fail, drop");
    }
  };

  /** AI 回复里的定位/外卖/礼物标记 → 结构化卡片（TA 送出的外卖挂账扣 TA 余额，等用户点收） */
  const digestRichCards = (reply: string): { text: string; location?: ChatEntry["location"]; order?: ChatEntry["order"] } => {
    const loc = extractLocation(reply);
    if (loc) {
      console.log(`[location] char offered 「${loc.place}」`);
      return { text: loc.clean, location: { place: loc.place, addr: `${loc.place}附近 · 实时位置`, from: "char" } };
    }
    const ord = extractOrder(reply);
    if (ord) {
      if (ord.order.kind === "delivery" && active) walletCharSend(active.id, ord.order.amount, `外卖·${ord.order.shop}`);
      console.log(`[order] char offered ${ord.order.kind} 「${ord.order.shop}」¥${ord.order.amount}`);
      return { text: ord.clean, order: ord.order };
    }
    return { text: reply };
  };

  /** 用户发定位卡片：即时上屏并请求 TA 回复 */
  const sendLocation = (place: string, addr: string) => {
    if (!active || pending) return;
    const story = Boolean(active.storyMode);
    const userMsg: ChatEntry = {
      id: `l${Date.now()}`,
      role: "user",
      content: `📍${place}`,
      at: Date.now(),
      location: { place, addr, from: "user" },
      ...(story ? { story: true } : {}),
    };
    setLog((prev) => [...prev, userMsg]);
    writeLogNow(active.id, (prev) => [...prev, userMsg]);
    setLocationOpen(false);
    scrollBottom();
    console.log(`[location] user → ${active.id} 「${place}」`);
    void requestReply([...stateRef.current.log, userMsg], userMsg.id, story);
  };

  /** 收下 TA 送来的外卖/礼物：置 received；外卖同时用户入账（TA 侧已在 digestRichCards 挂账扣过） */
  const receiveOrder = (entry: ChatEntry) => {
    if (!entry.order || entry.order.status === "received" || !active) return;
    const o = entry.order;
    if (o.kind === "delivery" && o.amount > 0) walletUserReceive(active.id, o.amount, `外卖·${o.shop}`, displayName(active));
    setWallet(readWallet());
    const mark = (prev: ChatEntry[]) => prev.map((e) => (e.id === entry.id ? { ...e, order: { ...e.order!, status: "received" as const } } : e));
    writeLogNow(active.id, mark);
    setLog(mark);
    console.log(`[order] user received ${o.kind} 「${o.shop}」from ${active.id}`);
  };

  /** 消化外卖 App 投递表：进入会话时把 outbox 订单变成聊天里的 outgoing 卡片并触发 TA 回复 */
  const drainDeliveryOutbox = () => {
    if (!active) return;
    const key = "vp-phone:delivery-outbox:v1";
    try {
      const all = JSON.parse(localStorage.getItem(key) || "[]") as { id: string; charId: string; at: number; order: NonNullable<ChatEntry["order"]> }[];
      const mine = all.filter((x) => x.charId === active.id);
      if (!mine.length) return;
      localStorage.setItem(key, JSON.stringify(all.filter((x) => x.charId !== active.id)));
      const msgs: ChatEntry[] = mine.map((x, i) => ({
        id: `d${x.id}${i}`,
        role: "user" as const,
        content: `${x.order.kind === "gift" ? "🎁" : "🛵"}${x.order.shop}`,
        at: x.at + i,
        order: { ...x.order, from: "user" as const, status: "pending" as const },
      }));
      console.log(`[delivery] outbox drained → char=${active.id} n=${msgs.length}`);
      setLog((prev) => [...prev, ...msgs]);
      writeLogNow(active.id, (prev) => [...prev, ...msgs]);
      setWallet(readWallet());
      scrollBottom();
      if (ready && !pending) void requestReply([...stateRef.current.log, ...msgs], msgs[msgs.length - 1].id, Boolean(active.storyMode));
    } catch {
      /* ignore */
    }
  };

  // ===== 连发模式：暂存多条、全部发出后角色才回复一次 =====
  const queuedEntries = log.filter((e) => e.queued);
  // 外卖 App 投递表：进入聊天视图/切换会话时消化，把订单变成会话里的卡片并触发 TA 回复
  useEffect(() => {
    if (view === "chat" && active?.id) drainDeliveryOutbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, active?.id]);
  const queueTimer = useRef<number | null>(null);
  /** 真正发出暂存连发条：去 queued 标记落库，以最后一条为锚点请求回复 */
  const flushQueue = () => {
    if (!active || pending) return;
    const q = stateRef.current.log.filter((e) => e.queued);
    if (!q.length) return;
    if (queueTimer.current) {
      clearTimeout(queueTimer.current);
      queueTimer.current = null;
    }
    const ids = new Set(q.map((e) => e.id));
    const lastId = q[q.length - 1].id;
    const story = Boolean(active.storyMode);
    writeLogNow(active.id, (prev) => prev.map((e) => (ids.has(e.id) ? { ...e, queued: false } : e)));
    const sent = stateRef.current.log.map((e) => (ids.has(e.id) ? { ...e, queued: false } : e));
    setLog(sent);
    console.log(`[queue] flush count=${q.length} anchor=${lastId} → 请求单次回复`);
    void requestReply(sent, lastId, story);
  };
  // 静默兜底：最后一条暂存消息 QUEUE_AUTO_FLUSH_MS 无新增即视为发完，自动发出
  useEffect(() => {
    if (queueTimer.current) {
      clearTimeout(queueTimer.current);
      queueTimer.current = null;
    }
    if (view !== "chat" || !prefs.batchQueueMode) return;
    const lastQ = [...log].reverse().find((e) => e.queued);
    if (!lastQ || pending) return;
    queueTimer.current = window.setTimeout(flushQueue, QUEUE_AUTO_FLUSH_MS);
    return () => {
      if (queueTimer.current) clearTimeout(queueTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [log, pending, view, prefs.batchQueueMode]);
  /** 深层世界书解锁表：charId → AI 已用 [查设定:名字] 申请过、下一轮起全文注入的条目名（内存态，不落库） */
  const unlockedIntroRef = useRef<Record<string, string[]>>({});
  /** 重新回复标记：requestReply 组历史时若为 true，追加"换全新说法"指令并在起播后复位 */
  const regenHintRef = useRef(false);

  /** 消化回复里的 [查设定:名字] 标记：登记解锁 + 返回去掉标记的干净文本 */
  const digestIntroRequests = (charId: string, text: string): string => {
    const { clean, names } = extractIntroRequests(text, books);
    if (names.length) {
      const cur = unlockedIntroRef.current[charId] ?? [];
      unlockedIntroRef.current[charId] = [...new Set([...cur, ...names])];
      console.log(`[worldbook] deep request char=${charId} ${names.join("、")} → 已解锁`);
    }
    return clean;
  };

  /** 每次请求现算：人设 + 生效世界书（按插入深度分层） + 表情名单 → system prompt；剧情模式换拼 STORY_PROTOCOL。
   * memeText：热梗世界书命中片段（由调用方按"本轮用户消息"现算，剧情/私聊两条链路共用注入位） */
  const buildSys = useCallback(
    (ch: Character, story: boolean, memeText = "", recentText = "", quoteTable = "") => {
      const activeBooks = getActiveWorldBooks(ch.id, books, ch.boundWorldBookIds ?? []);
      const usable = stickers.filter((s) => s.isGlobal);
      const worldText = buildWorldSectionV2(activeBooks, recentText, unlockedIntroRef.current[ch.id] ?? []);
      if (story) {
        // 互动剧情：第三人称小说叙事者视角——保留完整历史记忆，不注入私聊气泡式铁律与表情名单；
        // 人设保真协议（哈基米4.0+反机械关怀世界书）剧情同样适用，聊天经济性不注入（保持叙事文体）
        return (
          `你正在以小说叙事者视角演绎一段互动剧情，男主角为「${ch.name || "无名角色"}」。\n男主设定：${
            ch.persona || "无额外设定"
          }\n` +
          STORY_PROTOCOL(ch.name || "他") +
          CHARACTER_FIDELITY +
          // 语言跟随（外国角色卡自带翻译）：人设无论什么语言，回复一律中文；外语长句在 sanitizeReply 层兜底拦截
          LANGUAGE_PROTOCOL +
          ANTI_GREASE_BASELINE +
          LIVING_PERSON_PROTOCOL +
          PROGRESSIVE_BOND_PROTOCOL +
          EMOTION_RESTRAINT_PROTOCOL +
          NARRATIVE_NO_AI_FLAVOR +
          ORDER_PROTOCOL +
          REALITY_MCP_PROTOCOL +
          worldText +
          groupDigestFor(ch.id, characters) +
          memeText
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
        CHARACTER_FIDELITY +
        ONLINE_CHAT_ECONOMY +
        // 语言跟随（外国角色卡自带翻译）：人设外语也一律中文回复，她切外语才跟过去
        LANGUAGE_PROTOCOL +
        ANTI_GREASE_BASELINE +
        LIVING_PERSON_PROTOCOL +
        PROGRESSIVE_BOND_PROTOCOL +
        EMOTION_RESTRAINT_PROTOCOL +
        TEXT_STYLE_PROTOCOL +
        buildCountHint(recentCounts) +
        `【最近对话（对方是"${ch.name || "她"}"，请接住她最后一条消息再回复）】\n` +
        worldText +
        memeText +
        TRANSFER_PROTOCOL +
        LOCATION_PROTOCOL +
        ORDER_PROTOCOL +
        REALITY_MCP_PROTOCOL +
        QUOTE_PROTOCOL +
        quoteTable +
        // 历史记忆互通：群消息不写入私聊记录，但模型通过这段摘要"记得"群里发生过什么
        groupDigestFor(ch.id, characters) +
        "\n\n" +
        buildStickerHint(usable)
      );
    },
    [books, stickers, characters]
  );

  const scrollBottom = () => {
    requestAnimationFrame(() =>
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })
    );
  };

  const toHistory = (ch: Character, entries: ChatEntry[]) => [
    { role: "system", content: buildSys(ch, Boolean(ch.storyMode), memeFor(entries), entries.filter((e) => !e.failed).slice(-3).map((e) => e.content).join(" "), ch.storyMode ? "" : buildQuoteTable(ch, entries)) },
    ...entries.filter((e) => !e.failed).slice(-20).map((e) => ({ role: e.role, content: e.content })),
  ];

  /** 热梗世界书：按本轮最后一条用户消息现算命中片段（开关/全量模式见偏好；主动消息无用户输入即空串） */
  const memeDigestRef = useRef<{ src?: MemeEntry[]; text?: string }>({});
  const memeFor = (entries: ChatEntry[]): string => {
    if (!memePrefs.enabled) return "";
    const lastUser = [...entries].reverse().find((e) => e.role === "user" && !e.failed);
    if (!memePrefs.alwaysInject && !lastUser) return "";
    const text = buildMemeSection(lastUser?.content ?? "", PRESET_MEME_BOOK, memePrefs, memeDigestRef.current);
    if (text) console.log(`[meme] inject char hits=${memePrefs.alwaysInject ? "全量常驻" : (lastUser?.content.slice(0, 24) ?? "")} len=${text.length}`);
    return text;
  };

  const requestReply = async (entries: ChatEntry[], userMsgId: string, storyMode = false) => {
    if (!active) return;
    // 快照请求上下文：回复在后台继续，退出聊天页/切换会话也不会打断（结果直写该角色存储）
    const ch = active;
    const cfgSnapshot = config;
    const sysPrompt = buildSys(ch, storyMode, memeFor(entries), entries.filter((e) => !e.failed).slice(-3).map((e) => e.content).join(" "), storyMode ? "" : buildQuoteTable(ch, entries));
    // 转账单描述注入：让模型看得见"待收/已收"卡片状态，才能自然地说收下或推辞
    const transferCtx = (() => {
      const list = entries.filter((e) => e.transfer && !e.failed);
      if (!list.length) return "";
      const lines = list.slice(-4).map((e) => {
        const t = e.transfer!;
        const state = t.settled === "received" ? "已收到" : t.settled === "refunded" ? "已退回" : t.type === "incoming" ? "待你（角色）点卡片收下" : "已由系统即时到账（你口头表示收下即可，别复述金额流程）";
        return `- ${t.type === "incoming" ? `${ch.name || "TA"}转给你 ¥${t.amount.toFixed(2)}（备注：${t.note}）` : `你转给对方 ¥${t.amount.toFixed(2)}（备注：${t.note}）`}：${state}`;
      });
      return "\n【转账往来】\n" + lines.join("\n") + "\n（只有带标记的卡片才是真实转账；你说收钱必须用 [转账:金额:备注] 标记转出，收钱则对最近一笔待收做出反应）";
    })();
    // 定位/外卖上下文：让模型看得见最近的位置卡与订单卡状态
    const richCtx = (() => {
      const lines: string[] = [];
      const locs = entries.filter((e) => e.location && !e.failed).slice(-2);
      if (locs.length) {
        lines.push("【位置共享】");
        for (const e of locs) {
          const l = e.location!;
          lines.push(`- ${l.from === "user" ? `对方发来定位：${l.place}（${l.addr}）` : `${ch.name || "TA"}分享的位置：${l.place}`} —— 请对地点本身作出符合人设的反应`);
        }
      }
      const ords = entries.filter((e) => e.order && !e.failed).slice(-3);
      if (ords.length) {
        lines.push("【外卖与礼物】");
        for (const e of ords) {
          const o = e.order!;
          const its = o.items.map((i) => `${i.name}x${i.qty}`).join("+");
          const state = o.status === "received" ? "已收下/已完成" : o.from === "user" ? "待 TA（角色）点卡片收下" : "你送出后 TA 口头表示收到即算完成";
          lines.push(`- ${o.kind === "gift" ? "礼物" : "外卖"}「${o.shop}${its ? `：${its}` : ""}」¥${o.amount.toFixed(2)}${o.note ? `（留言：${o.note}）` : ""} —— ${state}`);
        }
        lines.push("（回赠请用 [外卖:店名:品名x数量:金额] 或 [礼物:礼品名:留言] 标记，系统才渲染成真卡片；口头说送但不写标记不算送达）");
      }
      return lines.length ? "\n" + lines.join("\n") : "";
    })();
    // 手机能力状态清单：TA 看得见哪些能力开着、有哪些待触发提醒，才敢用 [震动:]/[播报:]/[提醒:] 标记
    const mcpCtx = buildMcpContext(loadMcpPrefs()) + buildRemoteMcpContext(loadRemoteServers(), loadToolCache());
    const toHist = (es: ChatEntry[]) => {
      const msgs = es.filter((e) => !e.failed).slice(-20);
      // 本轮触发消息（最后一条用户消息）带图时走 vision 多模态；历史图片只留文本占位省 token
      const lastUserIdx = msgs.map((e) => e.role).lastIndexOf("user");
      const fmt = (e: ChatEntry) =>
        e.transfer
          ? `[转账卡片 ¥${e.transfer.amount.toFixed(2)} 备注:${e.transfer.note}${e.transfer.settled ? ` ${e.transfer.settled === "received" ? "已收" : "已退"}` : e.transfer.type === "incoming" ? " 待收" : ""}]`
          : e.location
            ? `[定位卡片 ${e.location.place}（${e.location.addr}）]`
            : e.order
              ? `[${e.order.kind === "gift" ? "礼物" : "外卖"}卡片 ${e.order.shop}${e.order.items.map((i) => `${i.name}x${i.qty}`).join("+") ? "：" + e.order.items.map((i) => `${i.name}x${i.qty}`).join("+") : ""} ¥${e.order.amount.toFixed(2)}${e.order.note ? ` 留言:${e.order.note}` : ""}${e.order.status === "received" ? " 已收" : e.order.from === "user" ? " 待收" : ""}]`
              : e.content;
      /** 该条消息的多模态 content：仅本轮用户图片/表情包转 image_url part，其余纯文本 */
      const fmtCite = (e: ChatEntry, idx: number): string | ChatPart[] => {
        const img = e.imageUrl ?? (e.stickerUrl && e.role === "user" ? e.stickerUrl : undefined);
        if (!img || idx !== lastUserIdx || e.transfer || e.location || e.order) return fmt(e);
        const parts: ChatPart[] = [];
        const txt = e.content.replace(/\[表情:[^\]]*\]/g, "").trim();
        parts.push({ type: "text", text: txt || (e.imageUrl ? "（对方发来一张图片）" : "（对方发来一个表情包）") });
        parts.push({ type: "image_url", image_url: { url: img } });
        console.log(`[vision] attach msg=${e.id} kind=${e.imageUrl ? "photo" : "sticker"}`);
        return parts;
      };
      // 重新回复：上一条不满意已被截掉，但模型需要知道要换个说法——追加一条系统指令再请求
      const regenDirective = regenHintRef.current
        ? { role: "user" as const, content: storyMode ? "（系统提示：刚才那段剧情被删掉了。这次换全新的叙述角度、意象和措辞重写这一段——不许复用被删版本的句子，情节走向可以不同但必须承接更早的前文）" : "（系统提示：你上一句回复被撤回了。这次用完全不同的说法和角度接她的话——不许复用刚才的句子和口头禅，可以换个反应、换个话题切入点；保持口语化短消息）" }
        : null;
      if (!storyMode) return [{ role: "system", content: sysPrompt + transferCtx + richCtx + mcpCtx }, ...msgs.map((e, i) => ({ role: e.role, content: fmtCite(e, i) })), ...(regenDirective ? [regenDirective] : [])];
      // 剧情链路：玩家消息带人称锚点包装（前文叙述转"你"），assistant 历史原样保留——记忆完整互通
      const out: { role: string; content: string | ChatPart[] }[] = [{ role: "system", content: sysPrompt + mcpCtx }];
      let lastStoryNarration = "";
      for (let i = 0; i < msgs.length; i++) {
        const e = msgs[i];
        if (e.role === "user") {
          const anchor = lastStoryNarration
            ? `${toSecondPerson(lastStoryNarration)}\n（以上为既定剧情，请承接推进，勿重复上文句子）\n\n`
            : "（互动剧情开场。请以第三人称叙述男主、第二人称\"你\"叙述玩家）\n";
          const cited = fmtCite(e, i);
          if (Array.isArray(cited)) {
            // 剧情模式发图：把锚点拼进第一个 text part，图片照常喂 vision
            out.push({ role: "user", content: [{ type: "text", text: anchor + ((cited[0] as { text: string }).text || "") }, cited[1]] });
          } else {
            out.push({ role: "user", content: anchor + cited });
          }
          lastStoryNarration = "";
        } else {
          out.push({ role: e.role, content: e.content });
          if (e.story) lastStoryNarration = e.content;
        }
      }
      if (regenDirective) out.push(regenDirective);
      return out;
    };
    console.log(
      `[reply] start char=${ch.id} msg=${userMsgId} story=${storyMode ? "on" : "off"} typing=${storyMode ? "narrative" : "human-protocol"}${regenHintRef.current ? " regen=1" : ""} → pending(正在输入中) sysLen=${sysPrompt.length}`
    );
    regenHintRef.current = false;
    // 并发闸门：同一会话同时只允许一条回复请求在飞（含流式输出中）。此前流式首 chunk 即 setPending(false)，
    // 倒计时兜底 effect / generate 重试会在流未结束时再次发起 requestReply，导致同一条消息落库两遍（重复气泡）
    const inflightKey = ch.id;
    if (inflightRef.current.has(inflightKey)) {
      console.warn(`[reply] skip duplicate request char=${inflightKey} msg=${userMsgId}（上一条仍在飞行中）`);
      return;
    }
    inflightRef.current.add(inflightKey);
    setPending(true);
    scrollBottom();
    // 拟真节奏：至少显示 1.2s"正在输入中"，避免秒回穿帮；期间请求已在进行
    const minTyping = new Promise((r) => setTimeout(r, 1_200));
    // 流式输出开关（发送习惯）：开启走 SSE 逐段上屏；STREAM_UNSUPPORTED/网关异常自动回落一次性 chatCompletion
    const streamOn = Boolean(stateRef.current.prefs.streamingEnabled);
    const hist = toHist(entries);
    /** 流式临时气泡：onChunk 实时刷新，落库时移除 */
    const streamId = `s${Date.now()}`;
    let streamStarted = false;
    const clearStreamBubble = () => {
      if (!streamStarted) return;
      setLog((prev) => prev.filter((e) => e.id !== streamId));
    };
    const onChunk = (acc: string) => {
      if (!streamStarted) {
        streamStarted = true;
        setPending(false); // "正在输入中"让位给真实文字
      }
      setLog((prev) => {
        const tmp: ChatEntry = { id: streamId, role: "assistant", content: acc, at: Date.now(), ...(storyMode ? { story: true } : {}) };
        const i = prev.findIndex((e) => e.id === streamId);
        if (i >= 0) {
          const next = [...prev];
          next[i] = tmp;
          return next;
        }
        return [...prev, tmp];
      });
      scrollBottom();
    };
    const call: Promise<{ ok: true; reply: string } | { ok: false; err: unknown }> = (async () => {
      try {
        if (streamOn) {
          const reply = await chatStream(cfgSnapshot, hist, onChunk);
          return { ok: true as const, reply };
        }
        return { ok: true as const, reply: await chatCompletion(cfgSnapshot, hist) };
      } catch (err) {
        if (streamOn && err instanceof Error && err.message === "STREAM_UNSUPPORTED") {
          console.warn(`[stream] unsupported char=${ch.id}，回落一次性返回`);
          clearStreamBubble();
          streamStarted = false;
          try {
            return { ok: true as const, reply: await chatCompletion(cfgSnapshot, hist) };
          } catch (err2) {
            return { ok: false as const, err: err2 };
          }
        }
        clearStreamBubble();
        return { ok: false as const, err };
      }
    })();
    try {
      const first = await Promise.race([call, minTyping.then(() => null)]);
      let result = first ?? (await call);
      if (!result.ok) {
        // 网关偶发 429/5xx/网络抖动不再静默丢回复：自动退避重试一次，仍失败才标记可手动重试
        const retryable = !(result.err instanceof Error && /401|403|400/.test(result.err.message));
        if (retryable) {
          console.warn(`[reply] fail char=${ch.id}，3 秒后自动重试一次:`, result.err instanceof Error ? result.err.message : result.err);
          await new Promise((r) => setTimeout(r, 3_000));
          result = await chatCompletion(cfgSnapshot, hist).then(
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
        let clean = result.ok ? digestIntroRequests(ch.id, sanitizeReply(result.reply)) : "";
        let quoted = clean ? digestQuote(clean, entries) : { text: "" };
        clean = quoted.text;
        // 转账标记拆卡：[转账:金额:备注] → incoming 卡片（挂账待用户点收），正文只留 TA 说的话
        const trans = clean && !storyMode ? digestTransfer(clean) : { text: clean };
        clean = trans.text;
        // 定位/外卖标记拆卡：[定位:地点] / [外卖:…] / [礼物:…] → 结构化卡片
        const rich = clean && !storyMode ? digestRichCards(clean) : { text: clean };
        clean = rich.text;
        // 手机能力标记拆行动作：[震动:] / [播报:] / [提醒:] → 真实执行 + 执行记录（异步，剧情模式不注入碎句协议但标记仍消化）
        const mcp = clean ? extractMcpMarks(clean) : { clean, actions: [] as McpAction[] };
        clean = mcp.clean;
        // 远程 MCP 标记消化：[远程MCP:服务:工具:参数] → 授权校验 + 高危确认 + 真实调用
        const remote = clean ? extractRemoteMarks(clean) : { clean, marks: [] };
        clean = remote.clean;
        // 自然语言收款兜底：TA 没写标记但话说"收下啦"——最近一笔用户转账卡片自动置为已收
        if (!trans.transfer && !rich.order && clean) settleIncomingByWords(clean, entries);
        let rep = false;
        if (clean && isRepetitiveReply(clean, recentAssistants)) {
          rep = true;
          console.warn(`[reply] repetitive char=${ch.id}，带禁复读指令重生成`);
          clean = "";
        }
        if (!clean) {
          // 整条回复出戏或复读：丢弃不展示，静默重生成（regenWith 内已含二级复读抢救）
          console.warn(`[reply] ${rep ? "repeat" : "OOC"} filtered char=${ch.id}，静默重生成`);
          clearStreamBubble();
          streamStarted = false;
          const again = await regenWith(
            rep
              ? antiRepeatHint
              : storyMode
                ? "（请回到互动剧情叙事：第三人称男主、第二人称玩家，承接前文平缓推进，不要提及你是模型或程序，也不要重复之前的句子）"
                : "（请完全回到角色身份继续对话，不要提及你是模型或程序；也不要重复你之前说过的句子）"
          );
          if (again) {
            console.log(`[reply] regen ok char=${ch.id}`);
            const againDigest = digestQuote(digestIntroRequests(ch.id, again), entries);
            const againTrans = !storyMode ? digestTransfer(againDigest.text) : { text: againDigest.text, transfer: undefined };
            const againRich = !storyMode ? digestRichCards(againTrans.text) : { text: againTrans.text };
            const againMcp = extractMcpMarks(againRich.text);
            const againRemote = extractRemoteMarks(againMcp.clean);
            const againNote = [
              againMcp.actions.length ? await execMcpActions(againMcp.actions, loadMcpPrefs(), cfgSnapshot) : "",
              againRemote.marks.length ? await execRemoteMarks(againRemote.marks, remoteBridge()) : "",
            ].filter(Boolean).join(" ｜ ") || undefined;
            settleReply(ch.id, userMsgId, againRemote.clean, storyMode, againDigest.quote, againTrans.transfer, againRich.location, againRich.order, againNote);
          } else {
            console.error(`[reply] regen fail char=${ch.id}`);
            settleReply(ch.id, userMsgId, null);
          }
        } else {
          if (clean !== result.reply) console.log(`[reply] OOC line stripped char=${ch.id}`);
          console.log(`[reply] ok char=${ch.id} len=${clean.length}${quoted.quote ? " quote=1" : ""}${trans.transfer ? " transfer=1" : ""}${rich.location ? " loc=1" : ""}${rich.order ? " order=1" : ""}${mcp.actions.length ? ` mcp=${mcp.actions.length}` : ""}${remote.marks.length ? ` remote=${remote.marks.length}` : ""}`);
          // 手机能力动作真实执行（按开关），结果串作为执行记录随消息落库；远程 MCP 同理
          const notes = [
            mcp.actions.length ? await execMcpActions(mcp.actions, loadMcpPrefs(), cfgSnapshot) : "",
            remote.marks.length ? await execRemoteMarks(remote.marks, remoteBridge()) : "",
          ].filter(Boolean).join(" ｜ ");
          const mcpNote = notes || undefined;
          clearStreamBubble();
          settleReply(ch.id, userMsgId, clean, storyMode, quoted.quote, trans.transfer, rich.location, rich.order, mcpNote);
        }
      } else {
        console.error(`[reply] final fail char=${ch.id}:`, result.err instanceof Error ? result.err.message : result.err);
        clearStreamBubble();
        settleReply(ch.id, userMsgId, null);
      }
    } finally {
      inflightRef.current.delete(inflightKey);
      await minTyping;
      setPending(false);
      scrollBottom();
    }
  };

  /** 远程 MCP 桥：execRemoteMarks 通过它拿服务清单/工具缓存/真实调用 + 中风险首次授权表 */
  const remoteBridge = () => ({
    servers: () => loadRemoteServers(),
    toolCache: () => loadToolCache(),
    call: (server: RemoteMcpServer, tool: Parameters<typeof callTool>[1], args: Record<string, unknown>, confirmed: boolean) => callTool(server, tool, args, confirmed),
    mediumConsented: (server: RemoteMcpServer, toolName: string) => hasMediumConsent(server, toolName),
    grantMedium: (serverId: string, toolName: string) => grantMediumConsent(serverId, toolName),
  });

  // 远程调用确认卡（高危每次 / 中危首次）：execRemoteMarks 经 CustomEvent 抛出请求，用户点允许/拒绝后 resolve
  const [remoteConfirm, setRemoteConfirm] = useState<{ id: string; serverName: string; tool: string; argsPreview: string; level?: "medium" | "high" } | null>(null);
  useEffect(() => {
    const onAsk = (e: Event) => {
      const detail = (e as CustomEvent).detail as { id: string; serverName: string; tool: string; argsPreview: string; level?: "medium" | "high" } | null;
      setRemoteConfirm(detail);
    };
    window.addEventListener("vp-mcp:confirm", onAsk);
    return () => window.removeEventListener("vp-mcp:confirm", onAsk);
  }, []);

  /** 回复落定：始终直写该角色的 localStorage（页面已切走也不丢），当前正打开该会话时同步刷新界面；story 标记决定剧情框/气泡渲染 */
  const settleReply = (charId: string, userMsgId: string, reply: string | null, story = false, quote?: { name: string; content: string }, transfer?: ChatEntry["transfer"], location?: ChatEntry["location"], order?: ChatEntry["order"], mcpNote?: string) => {
    try {
      const key = `vp-phone:rolechat-log:${charId}`;
      const prev = JSON.parse(localStorage.getItem(key) || "[]") as ChatEntry[];
      // 自愈去重：同一条用户消息后若出现内容一模一样的多条 assistant（历史 bug 遗留数据），只保留最早一条
      const seenReply = new Set<string>();
      const deduped: ChatEntry[] = [];
      let removed = 0;
      for (const e of prev) {
        if (e.role === "assistant" && !e.failed && !e.proactive && !e.transfer && !e.location && !e.order) {
          const sig = `${e.content}|${e.story ? "s" : ""}`;
          if (seenReply.has(sig)) {
            removed++;
            continue;
          }
          seenReply.add(sig);
        } else {
          seenReply.clear();
        }
        deduped.push(e);
      }
      if (removed) console.warn(`[reply] settle heal dedupe char=${charId} removed=${removed}（清理历史重复回复）`);
      const base = removed ? deduped : prev;
      // 只标记本次新产出的回复为剧情内容：历史消息的 story 标记原样保留（记忆互通）
      const kept = base.map((e) => (e.id === userMsgId ? { ...e, failed: reply == null, ...(story ? { story: true } : {}) } : e));
      // 幂等防重复：该触发消息之后已存在 assistant 回复则不再追加（流式期间兜底重发曾导致同一条落库两遍）
      if (reply != null) {
        const uid = base.findIndex((e) => e.id === userMsgId);
        if (uid >= 0 && base.slice(uid + 1).some((e) => e.role === "assistant")) {
          console.warn(`[reply] settle dedupe char=${charId} msg=${userMsgId}（该消息已有回复，丢弃重复落库）`);
          if (removed) localStorage.setItem(key, JSON.stringify(deduped));
          return;
        }
      }
      const next: ChatEntry[] = reply != null ? [...kept, { id: `a${Date.now()}`, role: "assistant", content: reply, at: Date.now(), ...(story ? { story: true } : {}), ...(quote ? { quote } : {}), ...(transfer ? { transfer } : {}), ...(location ? { location } : {}), ...(order ? { order } : {}), ...(mcpNote ? { mcpNote } : {}) }] : kept;
      localStorage.setItem(key, JSON.stringify(next));
      if (charId === activeId && view === "chat") setLog(next);
      // 通知横幅：角色新回复且当前没有盯着这个会话（正在看该会话时消息已直接上屏，不打扰）
      if (reply != null && !(charId === activeId && view === "chat")) {
        const ch = characters.find((c) => c.id === charId);
        if (ch && !ch.blocked) {
          emitNotify({ charId, name: displayName(ch), avatar: ch.avatar, text: reply.split(/\r?\n/)[0] });
          console.log(`[notify] banner reply char=${charId}`);
        }
      }
    } catch {
      /* ignore */
    }
  };

  /** 剧情框内渲染的用户消息：TA 的第三人称叙述转第二人称"你"（他看着你→他看着"你"），兜底直接引语 */
  const toSecondPerson = (t: string) => t.replace(/他(看着|望着|听见|听到|感觉到)/g, "你$1").replace(/「([^」\n]{1,40})」/g, "“$1”");

  const flushDraft = (): boolean => {
    if (!input.trim() || pending) return false;
    // 拉黑状态：点发送直接走拒收提示
    if (active?.blocked) {
      setInput("");
      generate();
      return true;
    }
    const text = input.trim();
    if (!text || pending || !ready) return false;
    const story = Boolean(active?.storyMode);
    const quote = quoteDraft ?? undefined;
    // 连发模式：先暂存上屏（queued），不请求回复；「发送全部」或静默 20s 后统一发出
    if (prefs.batchQueueMode && stateRef.current.log.filter((e) => e.queued).length < QUEUE_MAX) {
      const userMsg: ChatEntry = { id: `u${Date.now()}`, role: "user", content: text, at: Date.now(), queued: true, ...(quote ? { quote } : {}) };
      setLog((prev) => [...prev, userMsg]);
      writeLogNow(active?.id ?? "", (prev) => [...prev, userMsg]);
      setInput("");
      setQuoteDraft(null);
      scrollBottom();
      console.log(`[queue] staged msg=${userMsg.id} count=${stateRef.current.log.filter((e) => e.queued).length + 1} → 等待发完再回复`);
      return true;
    }
    const userMsg: ChatEntry = { id: `u${Date.now()}`, role: "user", content: text, at: Date.now(), ...(story ? { story: true } : {}), ...(quote ? { quote } : {}) };
    // 先同步更新界面（用户气泡必须立刻出现），再直写该角色存储保证后台回复基于完整上下文；
    // 顺序反了会被后续 setLog(stored) 用旧快照覆盖掉刚发的消息（曾导致自己发的消息要退出重进才可见）
    setLog((prev) => [...prev, userMsg]);
    writeLogNow(active?.id ?? "", (prev) => [...prev, userMsg]);
    // 重新产生记录即恢复开场白条（清空记录的隐藏标记只作用于空会话期间）
    if (chatCleared[active?.id ?? ""]) setChatCleared((prev) => ({ ...prev, [active?.id ?? ""]: false }));
    setInput("");
    setQuoteDraft(null);
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
    if (pending || !active) return;
    // 连发模式：有暂存条时"生成回复"按钮即发出全部暂存（连同草稿），发完才请求单次回复
    if (prefs.batchQueueMode && log.some((e) => e.queued)) {
      if (!ready) return;
      if (input.trim()) flushDraft();
      flushQueue();
      return;
    }
    // 拉黑彩蛋：消息发不出去，只回显微信式拒收提示（无需 API 配置也能演）
    if (active.blocked) {
      console.log(`[block] send rejected char=${active.id}`);
      const tip: ChatEntry = { id: `blk${Date.now()}`, role: "assistant", content: "「消息已发出，但被对方拒收了。」", at: Date.now(), blockedTip: true };
      setLog((prev) => [...prev, tip]);
      writeLogNow(active.id, (prev) => [...prev, tip]);
      setInput("");
      scrollBottom();
      return;
    }
    if (!ready) return;
    const s = stateRef.current;
    let entries = s.log;
    let targetId: string | null = null;
    const draft = s.input.trim();
    if (draft) {
      const quote = quoteDraft ?? undefined;
      const userMsg: ChatEntry = { id: `u${Date.now()}`, role: "user", content: draft, at: Date.now(), ...(active.storyMode ? { story: true } : {}), ...(quote ? { quote } : {}) };
      entries = [...entries, userMsg];
      targetId = userMsg.id;
      // 与 flushDraft 同理：先同步更新界面，再直写存储，避免旧快照覆盖刚发的消息
      console.log(`[reply] generate flush msg=${userMsg.id} → ui+storage`);
      setLog(entries);
      writeLogNow(active.id, (prev) => [...prev, userMsg]);
      setInput("");
      setQuoteDraft(null);
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
    // 连发模式：暂存条不算"已发出"，倒计时不触发回复（由 flushQueue 统一请求）
    if (prefs.batchQueueMode && log.some((e) => e.queued)) return;
    const last = log[log.length - 1];
    if (!last || last.role !== "user") return;
    // 兜底：若最后一条用户消息已发出超过 AUTO_DELAY_MS 仍未进入回复流程（如 effect 竞态漏触发），立即补发；
    // 注意不能检查 failed 标记——requestReply 失败时 pending 仍为 true，会挡住本兜底导致彻底无回复
    const wait = Math.max(600, AUTO_DELAY_MS - (Date.now() - last.at));
    console.log(`[reply] fallback timer ${wait}ms for msg=${last.id}`);
    autoTimer.current = window.setTimeout(() => {
      const cur = stateRef.current.log;
      const l = cur[cur.length - 1];
      // 兜底补发前必须确认上一条请求真的结束了：流式期间 pending=false 但请求仍在飞，直接 generate 会重复落库
      if (l && l.role === "user" && !cur.some((e) => e.role === "assistant" && e.at > l.at)) {
        if (active?.id && inflightRef.current.has(active.id)) {
          console.warn(`[reply] fallback skipped char=${active.id} msg=${l.id}（上一条仍在飞行中，防重复）`);
          return;
        }
        console.log(`[reply] fallback fire char=${active?.id} msg=${l.id}`);
        generate();
      }
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
        buildSys(ch, false, memeFor(last ? [last] : []), last?.content ?? "") +
        "\n\n【场景】现在没有对方发来的消息，是你（" +
        (ch.name || "TA") +
        "）主动想找对方说话。" +
        PROACTIVE_PROTOCOL.replace("{{char}}", ch.name || "TA") +
        // 《Ai恋人主动报备指令》by你闻起来像小猫：内容随机池八类+情绪过滤（她近期低落时屏蔽吐槽/炫耀/求助类）
        PROACTIVE_REPORT_POOL +
        REALITY_MCP_PROTOCOL +
        "\n注意：主动消息同样遵守反油腻底线与活人主体性——报备内容要像你真实生活里发生的事，条数与语气延续你当前状态。" +
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
      line = digestIntroRequests(ch.id, line);
      line = line
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join("\n");
      if (!line) return;
      // 主动消息也可能带手机能力标记（如"提醒我喝水"类）：拆出执行，结果记入 mcpNote
      const pmcp = extractMcpMarks(line);
      const premote = extractRemoteMarks(pmcp.clean);
      const pnote = [
        pmcp.actions.length ? await execMcpActions(pmcp.actions, loadMcpPrefs(), config) : "",
        premote.marks.length ? await execRemoteMarks(premote.marks, remoteBridge()) : "",
      ].filter(Boolean).join(" ｜ ") || undefined;
      line = premote.clean;
      if (!line && !pnote) return;
      setLogForChar(ch.id, {
        id: `p${Date.now()}`,
        role: "assistant",
        content: line,
        at: Date.now(),
        proactive: true,
        ...(pnote ? { mcpNote: pnote } : {}),
      });
      // 主动消息：不在该会话界面时弹横幅通知（正在看这个会话则消息已直接上屏）
      if (!(ch.id === activeId && view === "chat") && !ch.blocked) {
        emitNotify({ charId: ch.id, name: displayName(ch), avatar: ch.avatar, text: line.split(/\r?\n/)[0], tag: "主动消息" });
        console.log(`[notify] banner proactive char=${ch.id}`);
      }
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
          // 与世界书 App 导入同规则：重名加序号；depth 缺省即触发档，聊天时按关键词命中注入
          const parsed = parseWorldBookMd(md, fileName.replace(/\.md$/i, ""));
          const used = new Set(books.map((b) => b.name));
          const items = parsed.map((w) => {
            let name = w.name;
            let n = 2;
            while (used.has(name)) name = `${w.name} ${n++}`;
            used.add(name);
            return { ...w, name, id: `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}` };
          });
          setBooks((prev) => [...prev, ...items]);
          console.log(`[worldbook] import(count-view) count=${items.length}`);
          setView("list");
        }}
      />
    );
  }

  if (view === "group") {
    if (!activeGroup) {
      setView("list");
      return null;
    }
    return (
      <GroupChatView
        config={config}
        group={activeGroup}
        characters={characters}
        books={books}
        background={background}
        isOpen
        onBack={() => setView("list")}
        onUpdate={(g) => setGroups((prev) => prev.map((x) => (x.id === g.id ? g : x)))}
        onDissolve={(gid) => {
          clearGroupLog(gid);
          setGroups((prev) => prev.filter((x) => x.id !== gid));
          setActiveGroupId("");
          console.log(`[group] dissolved ${gid}（群记录清空，私聊镜像保留）`);
          setView("list");
        }}
      />
    );
  }

  if (view === "list") {
    return (
      <>
        <ConversationList
          characters={characters}
          groups={groups}
          activeId={activeId}
          marks={marks}
          generating={proactiveBusy}
          onSelect={(id) => {
            setActiveId(id);
            setMarks((m) => ({ ...m, [id]: Date.now() }));
            setView("chat");
          }}
          onSelectGroup={(gid) => {
            setActiveGroupId(gid);
            const g = groups.find((x) => x.id === gid);
            if (g) setMarks((m) => ({ ...m, [`g:${gid}`]: Date.now() }));
            setView("group");
          }}
          onNewGroup={() => setCreateOpen(true)}
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
            // 该角色退出所有群；只剩一人/零人的群自动解散
            setGroups((prev) =>
              prev
                .map((g) => ({ ...g, memberIds: g.memberIds.filter((m) => m !== id) }))
                .filter((g) => g.memberIds.length > 0)
            );
          }}
          onBack={onBack}
        />
        {createOpen && (
          <CreateGroupSheet
            characters={characters}
            onClose={() => setCreateOpen(false)}
            onCreate={(name, ids) => {
              const g: GroupChat = { id: newGroupId(), name: name.trim() || "我们的群", memberIds: ids, createdAt: Date.now() };
              setGroups((prev) => [g, ...prev]);
              setActiveGroupId(g.id);
              setCreateOpen(false);
              console.log(`[group] created ${g.id}「${g.name}」members=${ids.join(",")}`);
              setView("group");
            }}
          />
        )}
      </>
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
        onPickMiniMaxVoice={(vid) => setCharacters((prev) => prev.map((x) => (x.id === active.id ? { ...x, minimaxVoiceId: vid } : x)))}
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
  if (view === "detail") {
    return (
      <CharDetailPage
        character={active}
        onAlias={(v) => {
          console.log(`[detail] alias char=${active.id} →「${v}」`);
          setCharacters((prev) => prev.map((x) => (x.id === active.id ? { ...x, alias: v } : x)));
        }}
        onBlock={() => {
          console.log(`[detail] block char=${active.id}`);
          setCharacters((prev) => prev.map((x) => (x.id === active.id ? { ...x, blocked: true } : x)));
          setView("chat");
          // 拉黑后立刻弹出 TA 的挽留问询（只有"不拉黑了ovo"一个选项）
          setBlockedAsk(true);
        }}
        onEdit={() => setView("edit")}
        onClearLog={() => {
          clearChatLog(active.id);
          setLog([]);
          setOpenerExpanded(false);
          setChatCleared((prev) => ({ ...prev, [active.id]: true }));
          console.log(`[profile] chat cleared char=${active.id}（来自资料页）`);
          setView("chat");
        }}
        onDelete={() => {
          setCharacters((prev) => prev.filter((c) => c.id !== active.id));
          clearChatLog(active.id);
          console.log(`[detail] delete char=${active.id}`);
          setView(characters.length > 1 ? "list" : "chat");
        }}
        onBack={() => setView("chat")}
      />
    );
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
            <span className="block text-sm font-semibold">{displayName(active)}</span>
            <span className={`block text-[10px] ${active.blocked ? "text-destructive" : pending ? "text-primary" : ready ? "text-success" : "text-warning"}`}>
              {active.blocked ? "已拉黑" : pending ? "正在回复…" : ready ? "在线" : "未配置接口"}
            </span>
          </div>
        </div>
        <div className="flex">
          <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={() => setView("detail")} aria-label="对方资料设置">
            <MoreVertical className="size-4" />
          </Button>
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
              // 清空记录后开场白条消失、不再自动弹出；查看档案只能走左下角工具箱
              setOpenerExpanded(false);
              setChatCleared((prev) => ({ ...prev, [active.id]: true }));
              console.log(`[profile] chat cleared char=${active.id} → 白条隐藏，档案仅工具箱可达`);
            }}
            aria-label="清空聊天记录"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {/* 前情提要：一句话小灰框，不展开完整设定 */}
      {recapLine && !openerShown && (
        <div className="fade-up mx-3 mt-2 rounded-xl bg-black/[0.06] px-3 py-1.5 text-[10.5px] leading-relaxed text-muted-foreground backdrop-blur-sm">
          {recapLine}
        </div>
      )}

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3" onScroll={handleListScroll}>
        {/* 开场白：进入会话默认已展开（完整档案卡，随消息流整体下滑浏览、触底自动收起）；清空记录后消失不再自动弹出 */}
        {openerShown && !openerCollapsed && (
          <OpenerCard profile={effectiveProfile!} onCollapse={() => setOpenerCollapsed(true)} />
        )}
        {/* 工具箱→角色开场白：在聊天流内一次性完整展开档案（禁止局部折叠/分步加载），底部固定一键收起 */}
        {openerExpanded && profile && (
          <InlineProfileCard
            profile={profile}
            onCollapse={() => {
              console.log(`[profile] inline collapse char=${active.id}`);
              setOpenerExpanded(false);
            }}
            onLoadIntro={loadIntroToStory}
          />
        )}
        {/* 折叠后的开场白条：位于消息流顶部，点击打开侧边抽屉 */}
        {effectiveProfile?.opener && !chatCleared[active.id] && !openerExpanded && openerCollapsed && (
          <OpenerStrip
            opener={effectiveProfile.opener}
            expanded={false}
            onToggle={() => {
              console.log(`[profile] opener tapped char=${active.id} → 抽屉展开`);
              setProfileMode("drawer");
            }}
          />
        )}
        {log.length === 0 && !pending && !openerShown && (
          <p className="pt-10 text-center text-xs text-muted-foreground">
            和 {active.name || "TA"} 说点什么吧
            {!ready && <><br />（先在「设置」里接好 API）</>}
          </p>
        )}
        {log.map((entry, i) => {
          // 拉黑拒收提示：微信式居中灰字，不走气泡
          if (entry.blockedTip) {
            return (
              <p key={entry.id} className="fade-up text-center text-[10.5px] text-muted-foreground">
                {entry.content}
              </p>
            );
          }
          // 剧情内容统一渲染为聊天区中间的浅灰剧情框（不用消息气泡）；用户消息转第二人称"你："叙述
          // 退出剧情模式后：新发的普通消息走正常气泡；带 story 标记的历史剧情内容仍居中展示，
          // 绝不能退回左右气泡——否则玩家的叙述会被显示成"角色发的消息"
          const inStory = Boolean(active.storyMode);
          const prevStory = inStory && i > 0 && log[i - 1].story;
          if (entry.story || prevStory) {
            console.log(`[story] render char=${active.id} mode=${inStory ? "on" : "off"} entry=${entry.id} role=${entry.role} → 居中剧情展示（非气泡、不归属角色）`);
            return (
              <div key={entry.id} className="fade-up mx-auto w-full max-w-[92%]">
                {entry.role === "user" && entry.imageUrl && <img src={entry.imageUrl} alt="图片" className="mb-1 ml-auto block w-40 rounded-2xl opacity-90" />}
                <div className={`whitespace-pre-wrap break-words rounded-xl px-3.5 py-2.5 text-[12px] leading-relaxed backdrop-blur-sm ${inStory ? "bg-black/[0.05] text-muted-foreground" : "bg-transparent text-muted-foreground/70"}`}>
                  {entry.role === "user" ? `${entry.content ? `你：${entry.content}` : "你发来了一张图片"}` : entry.content}
                </div>
              </div>
            );
          }
          // 普通气泡挂长按/右键引用操作（剧情灰框在上面分支已 return，天然不可引用）；转账走橙色卡片不进气泡
          return entry.role === "user" ? (
            wrapCitable(
              entry,
              <div className="flex flex-col items-end gap-1">
                {entry.quote && <QuoteBlock quote={entry.quote} side="right" />}
                {entry.transfer ? (
                  <TransferCard entry={entry} charName={displayName(active)} onOpen={() => setTransferSheet(entry.id)} />
                ) : entry.location ? (
                  <LocationCard entry={entry} />
                ) : entry.order ? (
                  <OrderCard entry={entry} charName={displayName(active)} onOpen={() => setOrderSheet(entry.id)} />
                ) : entry.imageUrl ? (
                  <img src={entry.imageUrl} alt="图片" className="w-44 rounded-2xl shadow-md shadow-[var(--bubble-shadow)]" />
                ) : entry.stickerUrl ? (
                  <img src={entry.stickerUrl} alt="表情" className="w-24 rounded-2xl shadow-md shadow-[var(--bubble-shadow)]" />
                ) : (
                  <Bubble side="right">{entry.content}</Bubble>
                )}
                {entry.queued && (
                  <span className="rounded-full bg-black/[0.06] px-2 py-0.5 text-[9.5px] text-muted-foreground">待发送 · 连发中</span>
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
            )
          ) : (
            wrapCitable(
              entry,
              <div className="flex flex-col items-start gap-1">
                <AssistantRow
                  entry={entry}
                  character={active}
                  stickerLib={stickers}
                  online={ready}
                  canSpeak={canSpeak}
                  speaking={voiceBusy === entry.id}
                  onSpeak={() => void speak(entry.id, entry.content)}
                />
                {entry.transfer && <TransferCard entry={entry} charName={displayName(active)} onOpen={() => setTransferSheet(entry.id)} />}
                {entry.location && <LocationCard entry={entry} />}
                {entry.order && <OrderCard entry={entry} charName={displayName(active)} onOpen={() => setOrderSheet(entry.id)} />}
                {entry.mcpNote && (
                  <p className="flex items-center gap-1 pl-1 text-[9.5px] leading-relaxed text-muted-foreground/80">
                    <Sparkles className="size-2.5 shrink-0" />
                    {entry.mcpNote}
                  </p>
                )}
              </div>
            )
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
        {/* 远程 MCP 调用确认卡：高危每次确认 / 中危首次授权 */}
        {remoteConfirm && (
          <div className="absolute inset-x-0 bottom-0 z-[74] bg-black/40 p-3" onClick={() => answerRemoteConfirm(remoteConfirm.id, false)}>
            <div className="drawer-panel glass-strong rounded-2xl p-4" onClick={(e) => e.stopPropagation()}>
              <p className="flex items-center gap-1.5 text-[12px] font-bold text-neutral-800">
                <ShieldCheck className="size-4 shrink-0 text-amber-600" /> TA 想调用外部服务，需要你确认
              </p>
              <p className="mt-2 break-all text-[11.5px] leading-relaxed text-neutral-700">
                服务：<span className="font-semibold">{remoteConfirm.serverName}</span> · 工具：<span className="font-semibold">{remoteConfirm.tool}</span>
              </p>
              {remoteConfirm.argsPreview && remoteConfirm.argsPreview !== "{}" && (
                <p className="mt-1 max-h-20 overflow-y-auto break-all rounded-lg bg-white/60 px-2 py-1.5 text-[10.5px] leading-relaxed text-muted-foreground">参数：{remoteConfirm.argsPreview}</p>
              )}
              <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                {remoteConfirm.level === "medium"
                  ? "该工具会读取你的私人内容（涉私）。同意后系统会记住这次授权、之后自动执行；你随时可在远程 MCP 面板撤销。拒绝则本次不执行。"
                  : "该操作被标记为高危，每次都会这样请你确认。拒绝后 TA 只会知道你不同意，不会执行任何请求。"}
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" className="jelly-btn h-8 flex-1 bg-primary text-[12px] text-primary-foreground" onClick={() => answerRemoteConfirm(remoteConfirm.id, true)}>
                  允许执行
                </Button>
                <Button size="sm" variant="outline" className="jelly-btn h-8 flex-1 text-[12px]" onClick={() => answerRemoteConfirm(remoteConfirm.id, false)}>
                  拒绝
                </Button>
              </div>
            </div>
          </div>
        )}
        {/* 连发暂存条：待发数量 + 一键发送全部 */}
        {queuedEntries.length > 0 && (
          <div className="fade-up mb-2 flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3 py-1.5">
            <Coins className="size-3.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-primary">
              已暂存 {queuedEntries.length} 条，TA 发完后才回复
            </span>
            <button
              type="button"
              onClick={flushQueue}
              disabled={!ready || pending}
              className="jelly-btn h-6 shrink-0 rounded-full bg-primary px-3 text-[10.5px] font-semibold text-primary-foreground disabled:opacity-50"
            >
              发送全部
            </button>
          </div>
        )}
        {/* 转账编辑面板 */}
        {transferOpen && active && (
          <TransferPanel
            charName={displayName(active)}
            balance={wallet.userBalance}
            onSend={(a, n) => sendTransfer(a, n)}
            onClose={() => setTransferOpen(false)}
          />
        )}
        {/* 定位选择面板：常用地点 + 自定义 */}
        {locationOpen && (
          <LocationPanel disabled={!ready || pending} onPick={(p, a) => sendLocation(p, a)} onClose={() => setLocationOpen(false)} />
        )}
        {/* 引用条：待发引用显示在输入框上方，微信式浅灰小块 + 关闭按钮 */}
        {quoteDraft && (
          <div className="fade-up mb-2 flex items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 py-1.5">
            <Quote className="size-3.5 shrink-0 text-primary/70" />
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              {quoteDraft.name}：{quoteDraft.content}
            </span>
            <button
              type="button"
              onClick={() => setQuoteDraft(null)}
              aria-label="取消引用"
              className="jelly-icon flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )}
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
          <ToolboxButton open={toolboxOpen} onClick={() => setToolboxOpen((v) => !v)} />
          {/* 发图：相册选择或相机拍照，压缩后走 vision 让 TA 看图说话 */}
          <button
            type="button"
            onClick={() => {
              if (!ready || pending) return;
              console.log(`[photo] picker open char=${active.id}`);
              photoInputRef.current?.click();
            }}
            aria-label="发送图片"
            className="jelly-icon flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-primary"
          >
            <ImagePlus className="size-[18px]" />
          </button>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void handlePhotoFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => {
              console.log(`[transfer] open panel char=${active.id}`);
              setTransferOpen((v) => !v);
            }}
            aria-label="转账"
            className={`jelly-icon flex size-9 shrink-0 items-center justify-center rounded-full ${transferOpen ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-primary"}`}
          >
            <Banknote className="size-4.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              console.log(`[location] open panel char=${active.id}`);
              setLocationOpen((v) => !v);
            }}
            aria-label="发送定位"
            className={`jelly-icon flex size-9 shrink-0 items-center justify-center rounded-full ${locationOpen ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-primary"}`}
          >
            <MapPin className="size-[18px]" />
          </button>
          <Input
            placeholder={
              !ready
                ? "请先在设置中接入接口"
                : prefs.batchQueueMode
                  ? `连发模式：${queuedEntries.length ? "继续写或点发送全部…" : "发的每条先暂存，说完一起发"}`
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

      {/* 转账详情弹层：点卡片打开，微信式金额详情页，待收时提供收下/退还 */}
      {transferSheet && (() => {
        const e = log.find((x) => x.id === transferSheet);
        if (!e?.transfer) return null;
        const t = e.transfer;
        return (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40 p-8" onClick={() => setTransferSheet(null)}>
            <div className="drawer-panel w-full max-w-[280px] rounded-2xl bg-white p-5 shadow-2xl" onClick={(ev) => ev.stopPropagation()}>
              <p className="text-center text-[11px] text-muted-foreground">{t.type === "incoming" ? `${displayName(active)} 转给你` : "你转出给 TA"}</p>
              <p className="mt-2 text-center text-[26px] font-bold text-neutral-800">¥{t.amount.toFixed(2)}</p>
              <p className="mt-1 text-center text-[11.5px] text-muted-foreground">备注：{t.note}</p>
              <p className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-center text-[11px] text-orange-600">
                {t.settled === "received" ? "已收到，金额已到账" : t.settled === "refunded" ? "已退还给对方" : t.type === "incoming" ? "待收款 · 24小时内未收将自动退回" : "已支付 · 对方收取中"}
              </p>
              {t.type === "incoming" && !t.settled ? (
                <div className="mt-4 flex gap-2">
                  <button type="button" onClick={() => { receiveTransfer(e); setTransferSheet(null); }} className="jelly-btn h-9 flex-1 rounded-xl bg-primary text-[12.5px] font-semibold text-primary-foreground">
                    收下
                  </button>
                  <button type="button" onClick={() => { refundTransfer(e); setTransferSheet(null); }} className="jelly-btn h-9 flex-1 rounded-xl border border-border bg-secondary text-[12.5px] font-semibold text-secondary-foreground">
                    退还
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setTransferSheet(null)} className="jelly-btn mt-4 h-9 w-full rounded-xl bg-neutral-100 text-[12.5px] font-semibold text-neutral-600">
                  关闭
                </button>
              )}
            </div>
          </div>
        );
      })()}
      {/* 订单详情弹层：TA 送来的外卖/礼物待收时提供「收下」 */}
      {orderSheet && (() => {
        const e = log.find((x) => x.id === orderSheet);
        if (!e?.order) return null;
        const o = e.order;
        return (
          <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40 p-8" onClick={() => setOrderSheet(null)}>
            <div className="drawer-panel w-full max-w-[290px] rounded-2xl bg-white p-5 shadow-2xl" onClick={(ev) => ev.stopPropagation()}>
              <p className="text-center text-[11px] text-muted-foreground">{o.from === "char" ? `${displayName(active)} 送给你的${o.kind === "gift" ? "礼物" : "外卖"}` : `你下单的${o.kind === "gift" ? "礼物" : "外卖"}`}</p>
              <p className="mt-2 text-center text-[34px]">{o.kind === "gift" ? "🎁" : "🛵"}</p>
              <p className="mt-1 text-center text-[15px] font-bold text-neutral-800">{o.shop}</p>
              <p className="mt-1 text-center text-[11.5px] text-muted-foreground">{o.items.map((i) => `${i.name} x${i.qty}`).join(" + ")}</p>
              {o.amount > 0 && <p className="mt-1 text-center text-[13px] font-bold text-orange-500">¥{o.amount.toFixed(2)}</p>}
              {o.note && <p className="mt-2 rounded-lg bg-pink-50 px-3 py-2 text-center text-[11px] text-pink-500">留言：{o.note}</p>}
              <p className="mt-3 rounded-lg bg-orange-50 px-3 py-2 text-center text-[11px] text-orange-600">
                {o.status === "received" ? "已完成 · 已送达 TA 手中" : o.from === "char" ? "待签收 · 骑手正在路上" : "已支付 · 等待对方收取"}
              </p>
              {o.from === "char" && o.status !== "received" ? (
                <button type="button" onClick={() => { receiveOrder(e); setOrderSheet(null); }} className="jelly-btn mt-4 h-9 w-full rounded-xl bg-gradient-to-br from-[#f7b267] to-[#e56b6f] text-[12.5px] font-semibold text-white">
                  收下
                </button>
              ) : (
                <button type="button" onClick={() => setOrderSheet(null)} className="jelly-btn mt-4 h-9 w-full rounded-xl bg-neutral-100 text-[12.5px] font-semibold text-neutral-600">关闭</button>
              )}
            </div>
          </div>
        );
      })()}
      {/* 拉黑彩蛋弹窗：TA 的挽留——只有"不拉黑了ovo"一个选项，点击即恢复正常 */}
      {blockedAsk && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40 p-8">
          <div className="drawer-panel w-full max-w-[280px] rounded-2xl bg-white p-5 text-center shadow-2xl">
            <p className="text-[15px] font-semibold text-neutral-800">你确定要拉黑我吗？</p>
            <p className="mt-2 text-[12px] leading-relaxed text-neutral-500">想清楚了再点哦……我可是会一直盯着这个对话框等你的。</p>
            <button
              type="button"
              onClick={() => {
                console.log(`[block] unblock char=${active.id} → 恢复正常`);
                setCharacters((prev) => prev.map((x) => (x.id === active.id ? { ...x, blocked: false } : x)));
                setBlockedAsk(false);
              }}
              className="jelly-btn mt-4 h-10 w-full rounded-xl bg-primary text-[13px] font-semibold text-primary-foreground"
            >
              不拉黑了 ovo
            </button>
          </div>
        </div>
      )}
      {/* 工具箱菜单：角色开场白（聊天流内展开）/ 人物档案（独立静态页） */}
      {toolboxOpen && (
        <ToolboxMenu
          hasProfile={Boolean(profile)}
          onShowOpener={() => {
            console.log(`[profile] toolbox→opener char=${active.id} 聊天流内展开`);
            setToolboxOpen(false);
            setOpenerExpanded(true);
          }}
          onOpenProfile={() => {
            console.log(`[profile] toolbox→档案独立页 char=${active.id}`);
            setToolboxOpen(false);
            setProfileMode("page");
          }}
          onImport={() => {
            console.log(`[profile] toolbox→导入面板 char=${active.id}`);
            setToolboxOpen(false);
            setProfileImportOpen(true);
          }}
          onClose={() => setToolboxOpen(false)}
        />
      )}
      {profileImportOpen && (
        <ProfileImportPanel defaultName={active.name || "TA"} onImport={importProfile} onClose={() => setProfileImportOpen(false)} />
      )}
      {/* 侧边抽屉：底层聊天页叠加半透明蒙层，弹窗尺寸固定、内部纵向滚动 */}
      {profileMode === "drawer" && profile && (
        <ProfileDrawer profile={profile} onClose={() => setProfileMode("none")} onLoadIntro={loadIntroToStory} onUploadCover={saveCover} />
      )}
      {/* 独立静态页：只有关闭按钮，没有一键收起 */}
      {profileMode === "page" && profile && (
        <ProfileStandalonePage profile={profile} onClose={() => setProfileMode("none")} onLoadIntro={loadIntroToStory} />
      )}
    </div>
  );
}

/* ================= 会话资料页（微信式：右上角 ⋯ 进入，改备注 + 拉黑彩蛋） ================= */

function CharDetailPage({
  character,
  onAlias,
  onBlock,
  onEdit,
  onClearLog,
  onDelete,
  onBack,
}: {
  character: Character;
  onAlias: (v: string) => void;
  onBlock: () => void;
  onEdit: () => void;
  onClearLog: () => void;
  onDelete: () => void;
  onBack: () => void;
}) {
  const [alias, setAlias] = useState(character.alias ?? "");
  const [askBlock, setAskBlock] = useState(false);
  const saved = alias.trim() !== (character.alias ?? "").trim();
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="glass-nav flex items-center justify-between px-2 py-2">
        <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onBack} aria-label="返回聊天">
          <ChevronLeft className="size-5" />
        </Button>
        <span className="text-sm font-semibold">资料设置</span>
        <span className="size-8" />
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-3 pb-6 pt-3">
        {/* 名片头 */}
        <div className="glass flex items-center gap-3 rounded-2xl p-4">
          <Avatar character={character} size={52} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold">{displayName(character)}</p>
            {character.alias?.trim() && <p className="truncate text-[11px] text-muted-foreground">角色本名：{character.name || "未命名"}</p>}
            <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{(character.persona || "暂无简介").slice(0, 36)}</p>
          </div>
        </div>
        {/* 设置备注 */}
        <div className="glass rounded-2xl p-3.5">
          <Label htmlFor="charAlias" className="text-[12.5px] font-semibold">
            设置备注和标签
          </Label>
          <div className="mt-2 flex gap-2">
            <Input
              id="charAlias"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder={`留空则显示「${character.name || "TA"}」`}
              maxLength={12}
              className="h-9 flex-1 rounded-lg glass-input text-[12.5px]"
            />
            <Button size="sm" className="jelly-btn h-9 shrink-0 rounded-xl px-3 text-xs" disabled={!saved} onClick={() => onAlias(alias.trim())}>
              {saved ? "保存" : "已保存"}
            </Button>
          </div>
          <p className="mt-1.5 text-[10.5px] text-muted-foreground">备注会替换会话列表、聊天顶栏和查手机里显示的名字。</p>
        </div>
        {/* 危险操作区 */}
        <div className="glass overflow-hidden rounded-2xl">
          <button type="button" onClick={onEdit} className="jelly-btn flex w-full items-center justify-between border-b border-border/50 px-4 py-3 text-left text-[13px]">
            <span className="flex items-center gap-2">
              <Settings2 className="size-4 text-primary" />
              编辑角色设定
            </span>
            <ChevronLeft className="size-4 -rotate-90 text-muted-foreground" />
          </button>
          <button type="button" onClick={onClearLog} className="jelly-btn flex w-full items-center justify-between border-b border-border/50 px-4 py-3 text-left text-[13px]">
            <span className="flex items-center gap-2">
              <Trash2 className="size-4 text-muted-foreground" />
              清空聊天记录
            </span>
            <ChevronLeft className="size-4 -rotate-90 text-muted-foreground" />
          </button>
          <button
            type="button"
            onClick={() => {
              if (character.blocked) {
                console.log(`[detail] already blocked char=${character.id}`);
                return;
              }
              setAskBlock(true);
            }}
            className="jelly-btn flex w-full items-center justify-between px-4 py-3 text-left text-[13px]"
          >
            <span className="flex items-center gap-2 text-destructive">
              <Ban className="size-4" />
              {character.blocked ? "已拉黑（去聊天页点「不拉黑了」恢复）" : "拉黑"}
            </span>
            <ChevronLeft className="size-4 -rotate-90 text-muted-foreground" />
          </button>
        </div>
        <button type="button" onClick={onDelete} className="jelly-btn glass w-full rounded-2xl py-3 text-center text-[13px] font-medium text-destructive">
          删除角色
        </button>
      </div>
      {/* 拉黑问询弹窗：TA 的挽留——只有"不拉黑了ovo"一个选项按钮，点击即取消拉黑操作 */}
      {askBlock && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center bg-black/40 p-8">
          <div className="drawer-panel w-full max-w-[280px] rounded-2xl bg-white p-5 text-center shadow-2xl">
            <p className="text-[15px] font-semibold text-neutral-800">你确定要拉黑我吗？</p>
            <p className="mt-2 text-[12px] leading-relaxed text-neutral-500">想清楚了再点哦……我可是会一直盯着这个对话框等你的。</p>
            <button
              type="button"
              onClick={() => {
                console.log(`[detail] block confirmed char=${character.id} → 进入拉黑状态`);
                setAskBlock(false);
                onBlock();
              }}
              className="jelly-btn mt-4 h-10 w-full rounded-xl bg-primary text-[13px] font-semibold text-primary-foreground"
            >
              不拉黑了 ovo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ================= 建群弹层（紧耦合子组件内联本文件） ================= */

function CreateGroupSheet({ characters, onClose, onCreate }: { characters: Character[]; onClose: () => void; onCreate: (name: string, ids: string[]) => void }) {
  const [sel, setSel] = useState<Set<string>>(() => new Set());
  const [name, setName] = useState("");
  const toggle = (id: string) =>
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <div className="absolute inset-0 z-[70] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="glass-strong drawer-panel relative max-h-[80%] overflow-y-auto rounded-t-3xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold">发起群聊</span>
          <button type="button" onClick={onClose} aria-label="关闭" className="jelly-icon flex size-7 items-center justify-center rounded-full text-muted-foreground">
            <X className="size-4" />
          </button>
        </div>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="群名称（如：周氏双子争宠现场）" className="mb-3 h-9 rounded-xl border-0 bg-white/60 text-[12.5px]" />
        <p className="mb-2 text-[10.5px] leading-relaxed text-muted-foreground">勾选 2 位以上角色拉进群；群里她们各自保持人设，还会记得和你私聊发生过的事。</p>
        <div className="space-y-1.5">
          {characters.map((c) => {
            const on = sel.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                disabled={c.blocked}
                className={`jelly-btn flex w-full items-center gap-2.5 rounded-2xl px-2.5 py-2 text-left transition-colors ${on ? "bg-primary/10" : "hover:bg-primary/5"} ${c.blocked ? "opacity-40" : ""}`}
              >
                <Avatar character={c} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{displayName(c)}</span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">{c.blocked ? "已拉黑，不能进群" : (c.persona || "").slice(0, 24) || "未填人设"}</span>
                </span>
                <span className={`flex size-5 items-center justify-center rounded-full border ${on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
                  {on && <Check className="size-3" />}
                </span>
              </button>
            );
          })}
        </div>
        <Button className="jelly-btn mt-4 h-10 w-full rounded-full" onClick={() => onCreate(name, [...sel])} disabled={sel.size < 2}>
          {sel.size >= 2 ? `创建群聊（${sel.size} 人）` : "至少选择 2 位角色"}
        </Button>
      </div>
    </div>
  );
}

/* ================= 会话列表（微信式） ================= */

function ConversationList({
  characters,
  groups,
  activeId,
  marks,
  generating,
  onSelect,
  onSelectGroup,
  onNewGroup,
  onNew,
  onImport,
  onDelete,
  onBack,
}: {
  characters: Character[];
  groups: GroupChat[];
  activeId: string;
  marks: ReadMarks;
  generating: boolean;
  onSelect: (id: string) => void;
  onSelectGroup: (groupId: string) => void;
  onNewGroup: () => void;
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

  // 群条目混排：与私聊统一按最后一条消息时间排序；预览带"[群名] 发言人："前缀
  type Row =
    | { kind: "char"; at: number; c: Character; last: ChatEntry | null }
    | { kind: "group"; at: number; g: GroupChat; last: ChatEntry | null };
  const mixed: Row[] = [
    ...rows.map(({ c, last }): Row => ({ kind: "char", at: last?.at ?? 0, c, last })),
    ...groups.map((g): Row => {
      const last = readGroupLast(g.id);
      return { kind: "group", at: last?.at ?? 0, g, last };
    }),
  ].sort((a, b) => b.at - a.at);

  const groupUnread = (g: GroupChat) => {
    const seen = marks[`g:${g.id}`] ?? 0;
    return readGroupLog(g.id).filter((e) => e.role === "assistant" && !e.groupTip && e.at > seen).length;
  };

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
          <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onNewGroup} aria-label="发起群聊">
            <Users className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onImport} aria-label="导入角色卡">
            <FileInput className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onNew} aria-label="新建角色">
            <Plus className="size-4" />
          </Button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {mixed.length === 0 && (
          <p className="pt-16 text-center text-xs text-muted-foreground">还没有会话，点右上角 + 新建或导入角色卡</p>
        )}
        {mixed.map((row, i) =>
          row.kind === "char" ? (
            <button
              key={`c-${row.c.id}`}
              type="button"
              onClick={() => onSelect(row.c.id)}
              data-reveal-delay={String(i * 40)}
              className={`reveal reveal-up jelly-btn group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-primary/5 ${
                row.c.id === activeId ? "bg-primary/8" : ""
              }`}
            >
              <Avatar character={row.c} size={44} status={row.c.proactiveEnabled ? "online" : "offline"} badge={unreadCount(row.c.id, marks)} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13.5px] font-semibold">{displayName(row.c)}</span>
                  {row.last && <span className="shrink-0 text-[10px] text-muted-foreground">{fmtTime(row.last.at)}</span>}
                </span>
                <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                  {row.last ? row.last.content.replace(/\[表情:[^\]]*\]/g, "[表情]").split("\n")[0] : "开始和 TA 聊天吧"}
                </span>
              </span>
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(row.c.id);
                }}
                className="hidden size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:flex"
                aria-label={`删除 ${row.c.name}`}
              >
                <X className="size-3.5" />
              </span>
            </button>
          ) : (
            <button
              key={`g-${row.g.id}`}
              type="button"
              onClick={() => onSelectGroup(row.g.id)}
              data-reveal-delay={String(i * 40)}
              className="reveal reveal-up jelly-btn group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-colors hover:bg-primary/5"
            >
              {/* 群头像：前 3 位成员错位堆叠 */}
              <span className="relative flex size-11 shrink-0 items-center justify-center">
                {row.g.memberIds.slice(0, 3).map((mid, mi) => {
                  const c = characters.find((x) => x.id === mid);
                  if (!c) return null;
                  const pos = [
                    { left: 0, top: 1 },
                    { left: 16, top: 1 },
                    { left: 8, top: 17 },
                  ][mi];
                  return (
                    <span key={mid} className="absolute" style={{ left: pos.left, top: pos.top }}>
                      <Avatar character={c} size={22} />
                    </span>
                  );
                })}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1">
                    <Users className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate text-[13.5px] font-semibold">{row.g.name}</span>
                  </span>
                  {row.last && <span className="shrink-0 text-[10px] text-muted-foreground">{fmtTime(row.last.at)}</span>}
                </span>
                <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                  {row.last
                    ? `${row.last.role === "assistant" && row.last.senderId ? `${displayName(characters.find((x) => x.id === row.last!.senderId) ?? ({ name: "TA" } as Character))}：` : ""}${row.last.content.replace(/\[表情:[^\]]*\]/g, "[表情]").split("\n")[0]}`
                    : "拉上几个人一起聊吧"}
                </span>
              </span>
              {groupUnread(row.g) > 0 && (
                <span className="flex min-w-[16px] shrink-0 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-4 text-white">
                  {groupUnread(row.g) > 99 ? "99+" : groupUnread(row.g)}
                </span>
              )}
            </button>
          )
        )}
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
  // entry.quote（AI 引用历史消息）只挂在第一个文字气泡上方，微信式 reply 小块
  let quoteUsed = false;
  type RenderPart = { type: "text"; content: string; quote?: { name: string; content: string } } | { type: "sticker"; sticker: Sticker };
  const parts: RenderPart[] = lines.flatMap((line) =>
    parseReplyToMessages(line, stickerLib).map((p): RenderPart => {
      if (p.type === "text" && p.content && !quoteUsed && entry.quote) {
        quoteUsed = true;
        return { type: "text", content: p.content, quote: entry.quote };
      }
      return p;
    })
  );
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
              ) : p.quote ? (
                // 引用小块 + 回应文本：微信式嵌在同一气泡上方
                <div className="flex flex-col gap-1">
                  <QuoteBlock quote={p.quote} side="left" />
                  <Bubble side="left">{p.content}</Bubble>
                </div>
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

/** 气泡内嵌的引用小块（微信式 reply）：左侧竖线 + 名字：内容，随所属气泡同侧收窄对齐 */
function QuoteBlock({ quote, side }: { quote: { name: string; content: string }; side: "left" | "right" }) {
  return (
    <div
      className={`max-w-full rounded-lg border-l-2 border-primary/50 bg-black/[0.05] px-2.5 py-1 text-[10.5px] leading-snug text-muted-foreground ${
        side === "right" ? "self-end" : "self-start"
      }`}
    >
      <span className="line-clamp-2 break-words">
        {quote.name}：{quote.content}
      </span>
    </div>
  );
}

/** 消息长按/右键操作条（紧耦合父子组件内联本文件）：pointer 序列判定长按（移动>10px 或 >600ms 即放弃），桌面右键直开；assistant 消息附带重新回复 */
function MessageActions({
  open,
  onOpenChange,
  onCite,
  onRegen,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCite: () => void;
  /** 传入时在操作条显示「重新回复」按钮（仅普通 assistant 气泡） */
  onRegen?: () => void;
  children: React.ReactNode;
}) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  const cancel = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
  };

  return (
    <div
      className="relative"
      onContextMenu={(e) => {
        e.preventDefault();
        cancel();
        onOpenChange(true);
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        start.current = { x: e.clientX, y: e.clientY };
        cancel();
        timer.current = window.setTimeout(() => {
          timer.current = null;
          start.current = null;
          onOpenChange(true);
        }, 480);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        if (Math.abs(e.clientX - start.current.x) > 10 || Math.abs(e.clientY - start.current.y) > 10) cancel();
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
    >
      {children}
      {open && (
        <div
          className="drawer-panel absolute right-1/2 top-1 z-30 flex -translate-y-1/2 translate-x-1/2 gap-1 rounded-xl bg-neutral-800/95 p-1 shadow-lg backdrop-blur-sm"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => {
              console.log("[quote] action → 引用");
              onCite();
            }}
            className="jelly-btn flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11.5px] font-medium text-white hover:bg-white/10"
          >
            <Quote className="size-3" />
            引用
          </button>
          {onRegen && (
            <button
              type="button"
              onClick={() => {
                console.log("[regen] action → 重新回复");
                onRegen();
              }}
              className="jelly-btn flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11.5px] font-medium text-white hover:bg-white/10"
            >
              <RefreshCw className="size-3" />
              重新回复
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="关闭"
            className="jelly-icon flex size-6 items-center justify-center rounded-lg text-white/60 hover:text-white"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

/** 转账卡片（微信式橙色渐变）：点击打开详情弹层；已收/已退后置灰显示状态 */
function TransferCard({ entry, charName, onOpen }: { entry: ChatEntry; charName: string; onOpen: () => void }) {
  const t = entry.transfer!;
  const settled = t.settled;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`jelly-btn flex w-[210px] items-center gap-2.5 rounded-xl px-3 py-2.5 text-left shadow-md shadow-[var(--bubble-shadow)] transition-opacity ${
        settled ? "bg-neutral-200 opacity-70" : "bg-gradient-to-br from-[#f5a623] to-[#f0862c]"
      }`}
    >
      <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${settled ? "bg-neutral-300 text-neutral-500" : "bg-white/25 text-white"}`}>
        <Banknote className="size-4" />
      </span>
      <span className="min-w-0">
        <span className={`block truncate text-[12.5px] font-bold ${settled ? "text-neutral-500" : "text-white"}`}>¥{t.amount.toFixed(2)}</span>
        <span className={`block truncate text-[9.5px] ${settled ? "text-neutral-400" : "text-white/80"}`}>
          {settled === "received" ? "已收到" : settled === "refunded" ? "已退还" : t.type === "incoming" ? `${charName}的转账 · 点按收款` : "你发出的转账 · 待对方收取"}
        </span>
      </span>
    </button>
  );
}

/** 定位卡片（微信式地图卡）：地点名 + 地址行 + 迷你地图占位；纯展示不可点 */
function LocationCard({ entry }: { entry: ChatEntry }) {
  const l = entry.location!;
  return (
    <div className="jelly-btn w-[210px] overflow-hidden rounded-xl border border-border/60 bg-white text-left shadow-md shadow-[var(--bubble-shadow)]">
      {/* 迷你地图：CSS 网格 + 道路线模拟，中心定位针 */}
      <div className="relative h-[74px] bg-[oklch(0.94_0.035_150)]">
        <div className="absolute inset-0 opacity-40" style={{ backgroundImage: "linear-gradient(oklch(0.85_0.05_150) 1px, transparent 1px), linear-gradient(90deg, oklch(0.85_0.05_150) 1px, transparent 1px)", backgroundSize: "18px 18px" }} />
        <span className="absolute left-0 top-[22px] h-[7px] w-full -rotate-3 bg-[oklch(0.97_0.02_90)]" />
        <span className="absolute left-[60%] top-0 h-full w-[7px] rotate-6 bg-[oklch(0.97_0.02_90)]" />
        <span className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-[70%] flex-col items-center">
          <MapPin className="size-5 fill-red-500 text-white stroke-red-600" strokeWidth={1.5} />
          <span className="mt-0.5 size-1.5 rounded-full bg-red-500/30" />
        </span>
      </div>
      <div className="px-2.5 py-1.5">
        <p className="truncate text-[12px] font-semibold text-neutral-800">{l.place}</p>
        <p className="truncate text-[9.5px] text-muted-foreground">{l.addr}</p>
      </div>
    </div>
  );
}

/** 外卖/礼物订单卡：外卖=橙色系仿外卖平台条，礼物=粉紫礼盒；待收可点开详情 */
function OrderCard({ entry, charName, onOpen }: { entry: ChatEntry; charName: string; onOpen: () => void }) {
  const o = entry.order!;
  const gift = o.kind === "gift";
  const done = o.status === "received";
  const grad = gift ? "from-[#c8a2e8] to-[#8f7bd9]" : "from-[#f7b267] to-[#e56b6f]";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`jelly-btn flex w-[220px] items-center gap-2.5 rounded-xl px-3 py-2.5 text-left shadow-md shadow-[var(--bubble-shadow)] transition-opacity ${done ? "bg-neutral-200 opacity-70" : `bg-gradient-to-br ${grad}`}`}
    >
      <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${done ? "bg-neutral-300 text-neutral-500" : "bg-white/25 text-white"}`}>
        {gift ? <Gift className="size-4" /> : <UtensilsCrossed className="size-4" />}
      </span>
      <span className="min-w-0">
        <span className={`block truncate text-[12px] font-bold ${done ? "text-neutral-500" : "text-white"}`}>{o.shop}{o.amount > 0 && !gift ? ` ¥${o.amount.toFixed(2)}` : ""}</span>
        <span className={`block truncate text-[9.5px] ${done ? "text-neutral-400" : "text-white/85"}`}>
          {done ? "已收下 · 完成" : o.from === "char" ? `${charName}送的${gift ? "礼物" : "外卖"} · 点按签收` : "已下单 · 骑手配送中"}
        </span>
      </span>
    </button>
  );
}

/** 转账编辑面板：金额 + 快捷额 + 备注 + 余额显示，确认即发 */
function TransferPanel({ charName, balance, onSend, onClose }: { charName: string; balance: number; onSend: (amount: number, note: string) => void; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("恭喜发财，大吉大利");
  const num = Number(amount);
  const valid = Number.isFinite(num) && num > 0 && num <= 52000 && num <= balance;
  return (
    <div className="fade-up mb-2 rounded-2xl border border-border bg-white p-3 shadow-lg">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold">转给 {charName}</span>
        <button type="button" onClick={onClose} aria-label="关闭转账" className="jelly-icon flex size-5 items-center justify-center rounded-full text-muted-foreground">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="mt-2 flex items-baseline gap-1 border-b border-border pb-1.5">
        <span className="text-[18px] font-bold text-neutral-700">¥</span>
        <input
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full bg-transparent text-[24px] font-bold text-neutral-800 outline-none placeholder:text-neutral-300"
        />
      </div>
      <div className="mt-2 flex gap-1.5">
        {[5.2, 52, 131.44, 520].map((v) => (
          <button key={v} type="button" onClick={() => setAmount(String(v))} className={`jelly-btn flex-1 rounded-lg border py-1 text-[10.5px] font-medium ${Number(amount) === v ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary text-secondary-foreground"}`}>
            ¥{v}
          </button>
        ))}
      </div>
      <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={20} placeholder="留言" className="mt-2 h-8 rounded-lg bg-muted/40 text-[11.5px]" />
      <p className={`mt-1.5 text-[10px] ${num > balance ? "text-destructive" : "text-muted-foreground"}`}>
        可用余额 ¥{balance.toFixed(2)}{num > balance ? " · 余额不足" : ""}
      </p>
      <button
        type="button"
        disabled={!valid}
        onClick={() => onSend(Math.round(num * 100) / 100, note.trim() || "恭喜发财，大吉大利")}
        className="jelly-btn mt-2 h-9 w-full rounded-xl bg-gradient-to-br from-[#f5a623] to-[#f0862c] text-[12.5px] font-semibold text-white disabled:opacity-40"
      >
        转账给 TA
      </button>
    </div>
  );
}

/** 定位选择面板：常用地点宫格 + 自定义地点输入 */
function LocationPanel({ disabled, onPick, onClose }: { disabled: boolean; onPick: (place: string, addr: string) => void; onClose: () => void }) {
  const [custom, setCustom] = useState("");
  return (
    <div className="fade-up mb-2 rounded-2xl border border-border bg-white p-3 shadow-lg">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-neutral-700">
          <MapPin className="size-3.5 text-primary" /> 发送位置
        </span>
        <button type="button" onClick={onClose} aria-label="关闭定位面板" className="jelly-icon flex size-5 items-center justify-center rounded-full text-muted-foreground">
          <X className="size-3.5" />
        </button>
      </div>
      <ul className="mt-2 grid max-h-[168px] grid-cols-2 gap-1.5 overflow-y-auto">
        {PLACE_PRESETS.map((p) => (
          <li key={p.place}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(p.place, p.addr)}
              className="jelly-btn flex w-full items-center gap-2 rounded-xl border border-border bg-secondary/40 px-2.5 py-1.5 text-left hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
            >
              <span className="text-[15px]">{p.emoji}</span>
              <span className="min-w-0">
                <span className="block truncate text-[11.5px] font-medium text-neutral-700">{p.place}</span>
                <span className="block truncate text-[9px] text-muted-foreground">{p.addr}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <Input value={custom} onChange={(e) => setCustom(e.target.value.slice(0, 16))} maxLength={16} placeholder="或输入当前位置…" className="h-8 flex-1 rounded-lg bg-muted/40 text-[11.5px]" />
        <button
          type="button"
          disabled={disabled || !custom.trim()}
          onClick={() => onPick(custom.trim(), "自定义位置")}
          className="jelly-btn h-8 shrink-0 rounded-lg bg-primary px-3 text-[11.5px] font-semibold text-primary-foreground disabled:opacity-40"
        >
          发送
        </button>
      </div>
    </div>
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
    { key: "batchQueueMode", label: "连发模式", desc: "开启后每条消息先暂存上屏（不触发回复），点「发送全部」或停止输入 20 秒视为说完，角色才统一回复一次。" },
    { key: "streamingEnabled", label: "流式输出", desc: "开启后 TA 的回复逐段实时上屏（打字机效果）。需要接口支持流式返回；个别网关不支持时自动回落为一次性回复。" },
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
              <Switch id={r.key} checked={Boolean(form[r.key])} onCheckedChange={(v) => setForm((f) => ({ ...f, [r.key]: v }))} />
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
  onPickMiniMaxVoice,
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
  onPickMiniMaxVoice: (id: string) => void;
}) {
  const [form, setForm] = useState<Character>(character);
  const fileRef = useRef<HTMLInputElement>(null);
  const vcConfig = loadVoiceConfig();
  const voices = vcConfig.voices;

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
          {/* MiniMax 通道音色绑定（语音通话播报用）：留空回落全局默认 minimaxVoice */}
          {vcConfig.provider === "minimax" && (
            <div className="space-y-1.5 border-t border-border pt-2.5">
              <p className="text-[12px] font-medium">MiniMax 通话音色</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setForm((f) => ({ ...f, minimaxVoiceId: undefined }));
                    onPickMiniMaxVoice("");
                  }}
                  className={`jelly-btn rounded-full px-2.5 py-1 text-[11px] ${!form.minimaxVoiceId ? "bg-primary text-primary-foreground" : "glass text-secondary-foreground"}`}
                >
                  跟随默认（{vcConfig.minimaxVoice || "male-qn-qingse"}）
                </button>
                {[...MINIMAX_VOICES, ...(vcConfig.voices.filter((v) => v.id.includes("-") && !voices.some((o) => o.id === v.id)))]
                  .filter((v, i, arr) => arr.findIndex((x) => x.id === v.id) === i)
                  .map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        setForm((f) => ({ ...f, minimaxVoiceId: v.id }));
                        onPickMiniMaxVoice(v.id);
                      }}
                      className={`jelly-btn rounded-full px-2.5 py-1 text-[11px] ${form.minimaxVoiceId === v.id ? "bg-primary text-primary-foreground" : "glass text-secondary-foreground"}`}
                    >
                      {v.label}
                    </button>
                  ))}
              </div>
              <p className="text-[11px] text-muted-foreground">语音通话里 TA 用这个音色说话；克隆音色先在设置页拉取「我的音色」再手填 voice_id。</p>
            </div>
          )}
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
