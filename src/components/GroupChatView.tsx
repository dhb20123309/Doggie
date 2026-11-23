// 群聊天页：多角色同群对话/剧情推进；记忆与私聊双向同步（群→私镜像双写、私→群摘要注入）
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, MoreVertical, BookText, ImagePlus, Send, X, Users, UserPlus, Trash2, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/Avatar";
import type { AiConfig } from "@/lib/types";
import { isConfigured } from "@/lib/types";
import { chatCompletion, type ChatPart } from "@/lib/ai-api";
import {
  type ChatEntry,
  type Character,
  displayName,
  splitBubbles,
  sanitizeReply,
  isRepetitiveReply,
  CHAT_LIVENESS,
  STORY_PROTOCOL,
  TRANSFER_PROTOCOL,
  LOCATION_PROTOCOL,
  ORDER_PROTOCOL,
  extractTransfer,
  extractLocation,
  extractOrder,
} from "@/lib/chat-types";
import { REALITY_MCP_PROTOCOL } from "@/lib/reality-mcp";
import { HUMAN_TYPING_PROTOCOL } from "@/lib/human-typing";
import { CHARACTER_FIDELITY } from "@/lib/adult-worldbook";
import { LANGUAGE_PROTOCOL, ANTI_GREASE_BASELINE, LIVING_PERSON_PROTOCOL } from "@/lib/liveliness-worldbook";
import { getActiveWorldBooks, buildWorldSectionV2, type WorldBook } from "@/lib/worldbook";
import { extractMcpMarks, execMcpActions, loadMcpPrefs, buildMcpContext } from "@/lib/reality-mcp";
import { walletCharSend } from "@/lib/wallet-store";
import { emitNotify } from "@/lib/notification-store";
import { readLastEntries } from "@/lib/chat-store";
import { type GroupChat, useGroupLog, groupLogKey, mirrorToMembers, privateDigestFor, GROUP_PROTOCOL } from "@/lib/group-chat-store";

interface Props {
  config: AiConfig;
  group: GroupChat;
  characters: Character[];
  books: WorldBook[];
  background?: string;
  /** 当前是否正停留在本群会话（决定后台回复要不要弹横幅） */
  isOpen: boolean;
  onBack: () => void;
  /** 群资料变更（改名/成员/剧情开关）上报给持有 groups state 的父级 */
  onUpdate: (next: GroupChat) => void;
  onDissolve: (groupId: string) => void;
}

/** 群内某位成员的 system：人设 + 群聊协议 + 私聊同款活人协议精简版 + 该角色世界书 + 私聊近况摘要 */
function buildGroupSys(ch: Character, group: GroupChat, members: Character[], activeBooks: WorldBook[], recentText: string): string {
  const story = Boolean(group.storyMode);
  const roster = members
    .filter((m) => m.id !== ch.id)
    .map((m) => `${displayName(m)}（${(m.persona || "").slice(0, 40) || "无额外设定"}）`)
    .join("；");
  const worldText = buildWorldSectionV2(activeBooks, recentText, []);
  const head =
    `你现在扮演「${ch.name || "无名角色"}」，始终以该身份发言，不要跳出角色。\n` +
    `人设：${ch.persona || "无额外设定"}\n` +
    `【你的小群】群名「${group.name}」。群里除了对方（用户），还有这些角色：${roster || "没有别的人"}。\n`;
  if (story) {
    return (
      head +
      `【多人互动剧情】这不是普通群聊，而是一段小说式互动剧情：在场角色「${members.map(displayName).join("、")}」同场。` +
      `你只负责描写和演绎「${ch.name || "他"}」这一个角色的言行与心理，绝对不许代写其他角色或玩家"你"的台词与决定；` +
      `其他角色刚在群里说的话是既定事实，可以承接、回应或互相拆台（符合你的性格）。\n` +
      STORY_PROTOCOL(ch.name || "他") +
      CHARACTER_FIDELITY +
      LANGUAGE_PROTOCOL +
      ANTI_GREASE_BASELINE +
      LIVING_PERSON_PROTOCOL +
      ORDER_PROTOCOL +
      REALITY_MCP_PROTOCOL +
      worldText +
      privateDigestFor(ch.id)
    );
  }
  return (
    head +
    GROUP_PROTOCOL +
    CHAT_LIVENESS +
    HUMAN_TYPING_PROTOCOL +
    CHARACTER_FIDELITY +
    LANGUAGE_PROTOCOL +
    ANTI_GREASE_BASELINE +
    LIVING_PERSON_PROTOCOL +
    `【最近对话（对方在群里，可能@了别人也可能@你，请先接住和你有关的那句）】\n` +
    worldText +
    TRANSFER_PROTOCOL +
    LOCATION_PROTOCOL +
    ORDER_PROTOCOL +
    REALITY_MCP_PROTOCOL +
    privateDigestFor(ch.id)
  );
}

export function GroupChatView({ config, group, characters, books, background, isOpen, onBack, onUpdate, onDissolve }: Props) {
  const [log, setLog] = useGroupLog(group.id);
  const ready = isConfigured(config);
  const [input, setInput] = useState("");
  const [pendingSpeaker, setPendingSpeaker] = useState<Character | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [memberSheet, setMemberSheet] = useState(false);
  /** 修改群名称弹层 */
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameVal, setRenameVal] = useState(group.name);
  const listRef = useRef<HTMLDivElement>(null);
  const logRef = useRef(log);
  logRef.current = log;
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const members = useMemo(
    () => group.memberIds.map((id) => characters.find((c) => c.id === id)).filter(Boolean) as Character[],
    [group.memberIds, characters]
  );

  const scrollBottom = useCallback((smooth = true) => {
    requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: smooth ? "smooth" : "auto" }));
  }, []);

  // 进入群聊瞬时滚到底（与私聊同款策略：smooth 会被内容撑高截断）
  useEffect(() => {
    scrollBottom(false);
    const t = window.setTimeout(() => scrollBottom(false), 300);
    return () => clearTimeout(t);
  }, [group.id, scrollBottom]);

  /** 追加一条群消息（界面+存储同步）并镜像进各成员私聊记忆 */
  const append = useCallback(
    (entry: ChatEntry) => {
      const next = [...logRef.current, entry];
      logRef.current = next;
      if (mountedRef.current) setLog(next);
      try {
        localStorage.setItem(groupLogKey(group.id), JSON.stringify(next));
      } catch {
        /* 隐私模式忽略 */
      }
      if (!entry.groupTip) mirrorToMembers(group, entry, members);
      scrollBottom();
    },
    [group, members, setLog, scrollBottom]
  );

  /** 让某位成员就当前群上下文生成一条回复文本 */
  const askOne = useCallback(
    async (speaker: Character, entries: ChatEntry[]): Promise<string> => {
      const activeBooks = getActiveWorldBooks(speaker.id, books, speaker.boundWorldBookIds ?? []);
      const usable = entries.filter((e) => !e.failed && !e.groupTip).slice(-24);
      const sys = buildGroupSys(speaker, group, members, activeBooks, usable.slice(-3).map((e) => e.content).join(" "));
      const lastUserIdx = usable.map((e) => e.role).lastIndexOf("user");
      const hist: { role: string; content: string | ChatPart[] }[] = [
        { role: "system", content: sys + buildMcpContext(loadMcpPrefs()) },
      ];
      for (let i = 0; i < usable.length; i++) {
        const e = usable[i];
        if (e.role === "assistant") {
          // 只有她自己的话才是 assistant 轮次；别的角色说的话转成第三人称旁白
          if (e.senderId && e.senderId !== speaker.id) {
            const who = members.find((m) => m.id === e.senderId);
            hist.push({ role: "user", content: `（${who ? displayName(who) : "有人"}在群里说：${e.content}）` });
          } else {
            hist.push({ role: "assistant", content: e.content });
          }
        } else {
          const img = e.imageUrl ?? e.stickerUrl;
          const base = e.transfer
            ? `[转账卡片 ¥${e.transfer.amount.toFixed(2)} 备注:${e.transfer.note}]`
            : e.location
              ? `[定位卡片 ${e.location.place}]`
              : e.order
                ? `[${e.order.kind === "gift" ? "礼物" : "外卖"}卡片 ${e.order.shop} ¥${e.order.amount.toFixed(2)}]`
                : e.content;
          if (img && i === lastUserIdx) {
            hist.push({
              role: "user",
              content: [
                { type: "text", text: base || "（对方发来一张图片）" },
                { type: "image_url", image_url: { url: img } },
              ],
            });
          } else {
            hist.push({ role: "user", content: base });
          }
        }
      }
      return await chatCompletion(config, hist);
    },
    [config, group, members, books]
  );

  /** 消化一位成员的回复：标记拆卡 + 落群库 + 镜像私聊 + 通知 */
  const settleSpeakerReply = useCallback(
    async (speaker: Character, raw: string, anchorId: string) => {
      let clean = sanitizeReply(raw);
      const trans = clean ? extractTransfer(clean) : null;
      if (trans) clean = trans.clean;
      const loc = clean && !trans ? extractLocation(clean) : null;
      if (loc) clean = loc.clean;
      const ord = clean && !trans && !loc ? extractOrder(clean) : null;
      if (ord) clean = ord.clean;
      const mcp = clean ? extractMcpMarks(clean) : { clean, actions: [] };
      clean = mcp.clean;
      if (!clean) return;
      // TA 在群里发钱/点外卖 → 从她的钱包挂账扣款（与私聊同一规则，允许负数"掏空口袋"）
      if (trans) walletCharSend(speaker.id, trans.amount, trans.note);
      if (ord && ord.order.kind === "delivery") walletCharSend(speaker.id, ord.order.amount, `外卖·${ord.order.shop}`);
      const note = mcp.actions.length ? await execMcpActions(mcp.actions, loadMcpPrefs(), config) : undefined;
      const entry: ChatEntry = {
        id: `ga${Date.now()}${Math.floor(Math.random() * 900 + 100)}`,
        role: "assistant",
        content: clean,
        at: Date.now(),
        senderId: speaker.id,
        ...(group.storyMode ? { story: true } : {}),
        ...(note ? { mcpNote: note } : {}),
        ...(trans ? { transfer: { amount: trans.amount, note: trans.note, from: "char" as const, type: "incoming" as const } } : {}),
        ...(loc ? { location: { place: loc.place, addr: `${loc.place}附近 · 实时位置`, from: "char" as const } } : {}),
        ...(ord ? { order: { ...ord.order, from: "char" as const } } : {}),
      };
      append(entry);
      console.log(`[group] reply char=${speaker.id} anchor=${anchorId} len=${clean.length} story=${group.storyMode ? "on" : "off"}`);
      if (!isOpenRef.current) {
        emitNotify({ charId: speaker.id, name: displayName(speaker), avatar: speaker.avatar, text: `${group.name}｜${clean.split(/\r?\n/)[0]}`, tag: "群聊" });
      }
    },
    [append, config, group]
  );

  /** 选人：@点名优先，否则最久没说话的成员先说；一轮最多两位发言 */
  const pickSpeakers = useCallback(
    (text: string, entries: ChatEntry[]): Character[] => {
      const alive = members.filter((m) => !m.blocked);
      if (!alive.length) return [];
      const mentioned = alive.filter((m) => text.includes(m.name || "\u0000") || (m.alias ? text.includes(m.alias) : false) || text.includes(`@${displayName(m)}`));
      const lastSpoken = (id: string) => {
        for (let i = entries.length - 1; i >= 0; i--) {
          if (entries[i].role === "assistant" && entries[i].senderId === id) return entries[i].at;
        }
        return 0;
      };
      const ordered = [...alive].sort((a, b) => lastSpoken(a.id) - lastSpoken(b.id));
      if (mentioned.length) {
        const extra = ordered.find((m) => !mentioned.includes(m));
        return extra && Math.random() < 0.35 ? [...mentioned, extra].slice(0, 2) : mentioned.slice(0, 2);
      }
      return ordered.slice(0, Math.random() < 0.35 && ordered.length > 1 ? 2 : 1);
    },
    [members]
  );

  /** 依次让选中的成员发言（逐条请求，前一条落库后下一条才看得见） */
  const runTurn = useCallback(
    async (speakers: Character[]) => {
      busyRef.current = true;
      try {
        for (const speaker of speakers) {
          setPendingSpeaker(speaker);
          await new Promise((r) => setTimeout(r, 900 + Math.random() * 800));
          try {
            // 每位发言人重新取最新群历史（含上一位刚说的话），才能接梗/拆台
            const entries = JSON.parse(localStorage.getItem(groupLogKey(group.id)) || "[]") as ChatEntry[];
            const raw = await askOne(speaker, entries);
            const clean = sanitizeReply(raw);
            if (!clean) {
              console.warn(`[group] skip empty/OOC char=${speaker.id}`);
              continue;
            }
            // 复读检测：与该角色私聊近期发言 + 她在群里说过的话比对
            const prev = [...readLastEntries(speaker.id, 6), ...entries.filter((e) => e.senderId === speaker.id)];
            if (isRepetitiveReply(clean, prev)) {
              console.warn(`[group] skip repetitive char=${speaker.id}`);
              continue;
            }
            await settleSpeakerReply(speaker, raw, entries.at(-1)?.id ?? "");
          } catch (err) {
            console.error(`[group] reply fail char=${speaker.id}:`, err instanceof Error ? err.message : err);
          } finally {
            setPendingSpeaker(null);
          }
        }
      } finally {
        busyRef.current = false;
        setPendingSpeaker(null);
        scrollBottom();
      }
    },
    [askOne, group.id, scrollBottom, settleSpeakerReply]
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busyRef.current || !ready) return;
    const userMsg: ChatEntry = { id: `gu${Date.now()}`, role: "user", content: text, at: Date.now() };
    setInput("");
    append(userMsg);
    const entries = [...logRef.current];
    await runTurn(pickSpeakers(text, entries));
  }, [input, ready, append, pickSpeakers, runTurn]);

  const photoInputRef = useRef<HTMLInputElement>(null);

  /** 发图（压缩后的 data URL）：vision 识别 + 一位成员接话 */
  const sendPhoto = useCallback(
    async (dataUrl: string) => {
      if (busyRef.current || !ready) return;
      const userMsg: ChatEntry = { id: `gi${Date.now()}`, role: "user", content: "", imageUrl: dataUrl, at: Date.now() };
      append(userMsg);
      await runTurn(pickSpeakers("", [...logRef.current]).slice(0, 1));
    },
    [append, ready, runTurn, pickSpeakers]
  );

  const handlePhotoFile = async (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    try {
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
      void sendPhoto(out);
    } catch {
      console.warn("[group] compress fail, drop");
    }
  };

  const toggleStory = () => {
    const v = !group.storyMode;
    console.log(`[group] story toggle ${group.id} → ${v ? "剧情模式" : "日常群聊"}`);
    onUpdate({ ...group, storyMode: v });
    append({
      id: `gtip${Date.now()}`,
      role: "assistant",
      content: v
        ? `群剧情模式已开启：接下来的回复将以小说叙事推进（${members.map(displayName).join("、")} 同场）`
        : "群剧情模式已关闭，回到日常碎句聊天",
      at: Date.now(),
      groupTip: true,
    });
  };

  return (
    <div
      className="relative flex h-full flex-col bg-[linear-gradient(160deg,oklch(0.96_0.03_92),oklch(0.92_0.045_78))] bg-cover bg-center"
      style={background ? { backgroundImage: `url(${background})` } : undefined}
    >
      <div className="glass-nav flex items-center justify-between px-2 py-2">
        <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onBack} aria-label="会话列表">
          <ChevronLeft className="size-5" />
        </Button>
        <div className="flex min-w-0 flex-col items-center">
          <span className="max-w-[150px] truncate text-sm font-semibold">{group.name}</span>
          <span className={`block text-[10px] ${pendingSpeaker ? "text-primary" : ready ? "text-success" : "text-warning"}`}>
            {pendingSpeaker ? `${displayName(pendingSpeaker)} 正在输入…` : ready ? `${members.length} 人群聊` : "未配置接口"}
          </span>
        </div>
        <div className="flex items-center">
          <button
            type="button"
            onClick={toggleStory}
            aria-label="切换群剧情模式"
            className={`jelly-btn mr-1 flex h-7 items-center gap-1 rounded-full px-2.5 text-[10px] font-semibold transition-colors ${group.storyMode ? "bg-primary text-primary-foreground" : "glass text-secondary-foreground"}`}
          >
            <BookText className="size-3" />
            剧情
          </button>
          <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={() => setMenuOpen((v) => !v)} aria-label="群设置">
            <MoreVertical className="size-4" />
          </Button>
        </div>
      </div>

      {/* 成员头像横排（点开成员管理） */}
      <button type="button" onClick={() => setMemberSheet(true)} className="jelly-btn glass mx-3 mt-2 flex items-center gap-2 rounded-2xl px-3 py-2 text-left">
        <Users className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex -space-x-2">
          {members.slice(0, 5).map((m) => (
            <span key={m.id} className="rounded-full ring-2 ring-white/70">
              <GroupAvatar character={m} size={22} />
            </span>
          ))}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">群成员 · {members.length}</span>
      </button>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {log.length === 0 && (
          <p className="pt-10 text-center text-xs text-muted-foreground">在群里说点什么吧，@ 谁就由谁先接话</p>
        )}
        {log.map((entry) =>
          entry.groupTip ? (
            <p key={entry.id} className="fade-up text-center text-[10.5px] text-muted-foreground">
              {entry.content}
            </p>
          ) : entry.story ? (
            <div key={entry.id} className="fade-up rounded-2xl bg-black/[0.05] px-3 py-2.5 text-[12px] leading-relaxed text-neutral-700">
              {entry.role === "user" ? `你：${entry.content}` : entry.content}
              {entry.mcpNote && <p className="mt-1 text-[9.5px] text-muted-foreground/80">{entry.mcpNote}</p>}
            </div>
          ) : entry.role === "user" ? (
            <div key={entry.id} className="flex flex-col items-end gap-1">
              {entry.imageUrl ? (
                <img src={entry.imageUrl} alt="图片" className="w-44 rounded-2xl shadow-md shadow-[var(--bubble-shadow)]" />
              ) : (
                <div className="bubble-cream bubble-cream-me whitespace-pre-wrap break-words rounded-3xl rounded-br-lg px-3.5 py-2 text-[12.5px] leading-relaxed">
                  {entry.content}
                </div>
              )}
            </div>
          ) : (
            <GroupAssistantRow key={entry.id} entry={entry} members={members} online={ready} />
          )
        )}
        {pendingSpeaker && (
          <div className="flex items-end gap-2 fade-up">
            <GroupAvatar character={pendingSpeaker} size={26} status="typing" />
            <div className="bubble-cream flex items-center gap-1.5 rounded-3xl px-3.5 py-2.5">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-1.5 rounded-full bg-primary/60 typing-dot" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
              <span className="ml-1 text-[10px] text-muted-foreground">{displayName(pendingSpeaker)} 正在输入…</span>
            </div>
          </div>
        )}
      </div>

      <div className="glass-input flex items-center gap-1.5 px-2 py-2">
        <button
          type="button"
          onClick={() => photoInputRef.current?.click()}
          aria-label="发送图片"
          className="jelly-icon flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-primary"
        >
          <ImagePlus className="size-4" />
        </button>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void handlePhotoFile(e.target.files?.[0]);
            e.currentTarget.value = "";
          }}
        />
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
          placeholder={ready ? "说点什么…@角色名可点名" : "请先在设置中接入接口"}
          className="h-9 flex-1 rounded-full border-0 bg-white/60 text-[12.5px]"
        />
        <Button
          size="icon"
          className="jelly-btn size-9 shrink-0 rounded-full"
          onClick={() => void send()}
          disabled={!input.trim() || Boolean(pendingSpeaker) || !ready}
          aria-label="发送"
        >
          <Send className="size-4" />
        </Button>
      </div>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
          <div className="glass-strong fade-up absolute right-3 top-14 z-50 w-40 overflow-hidden rounded-2xl">
            <MenuItem
              icon={<UserPlus className="size-4" />}
              label="群成员管理"
              onClick={() => {
                setMenuOpen(false);
                setMemberSheet(true);
              }}
            />
            <MenuItem
              icon={<BookText className="size-4" />}
              label="修改群名称"
              onClick={() => {
                setMenuOpen(false);
                setRenameOpen(true);
              }}
            />
            <MenuItem
              icon={<Trash2 className="size-4" />}
              label="解散群聊"
              danger
              onClick={() => {
                setMenuOpen(false);
                onDissolve(group.id);
              }}
            />
          </div>
        </>
      )}

      {memberSheet && (
        <MemberSheet group={group} characters={characters} onClose={() => setMemberSheet(false)} onUpdate={onUpdate} appendTip={(tip) => append(tip)} />
      )}

      {renameOpen && (
        <div className="absolute inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setRenameOpen(false)} />
          <div className="glass-strong fade-up relative w-[78%] rounded-2xl p-4">
            <p className="mb-2.5 text-sm font-semibold">修改群名称</p>
            <Input
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              placeholder="群名称"
              className="h-9 rounded-xl border-0 bg-white/60 text-[12.5px]"
              autoFocus
            />
            <div className="mt-3 flex gap-2">
              <Button variant="outline" className="jelly-btn h-9 flex-1 rounded-full text-xs" onClick={() => setRenameOpen(false)}>
                取消
              </Button>
              <Button
                className="jelly-btn h-9 flex-1 rounded-full text-xs"
                disabled={!renameVal.trim()}
                onClick={() => {
                  console.log(`[group] rename ${group.id} →「${renameVal.trim()}」`);
                  onUpdate({ ...group, name: renameVal.trim() });
                  setRenameOpen(false);
                }}
              >
                保存
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`jelly-btn flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] transition-colors hover:bg-primary/5 ${danger ? "text-destructive" : ""}`}
    >
      {icon}
      {label}
    </button>
  );
}

/** 群成员管理：勾选增删（至少保留 1 人），保存即写入 memberIds 并留系统提示行 */
function MemberSheet({
  group,
  characters,
  onClose,
  onUpdate,
  appendTip,
}: {
  group: GroupChat;
  characters: Character[];
  onClose: () => void;
  onUpdate: (g: GroupChat) => void;
  appendTip: (tip: ChatEntry) => void;
}) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(group.memberIds));
  const toggle = (id: string) => {
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const save = () => {
    if (!sel.size) return;
    const added = [...sel].filter((id) => !group.memberIds.includes(id));
    const removed = group.memberIds.filter((id) => !sel.has(id));
    onUpdate({ ...group, memberIds: [...sel] });
    const names = (ids: string[]) => ids.map((id) => displayName(characters.find((c) => c.id === id)!)).join("、");
    if (added.length) appendTip({ id: `gtip${Date.now()}a`, role: "assistant", content: `${names(added)} 加入了群聊`, at: Date.now(), groupTip: true });
    if (removed.length) appendTip({ id: `gtip${Date.now()}r`, role: "assistant", content: `${names(removed)} 退出了群聊`, at: Date.now() + 1, groupTip: true });
    if (added.length || removed.length) console.log(`[group] members changed ${group.id} +${added.length} -${removed.length}`);
    onClose();
  };
  return (
    <div className="absolute inset-0 z-[60] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="glass-strong drawer-panel relative max-h-[70%] overflow-y-auto rounded-t-3xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-semibold">群成员</span>
          <button type="button" onClick={onClose} className="jelly-icon flex size-7 items-center justify-center rounded-full text-muted-foreground">
            <X className="size-4" />
          </button>
        </div>
        <p className="mb-2 text-[10.5px] text-muted-foreground">勾选加入/移出（至少保留一位成员）</p>
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
                <GroupAvatar character={c} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{displayName(c)}</span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">
                    {c.blocked ? "已拉黑，不能进群" : (c.persona || "").slice(0, 24) || "未填人设"}
                  </span>
                </span>
                <span className={`flex size-5 items-center justify-center rounded-full border ${on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
                  {on && <Check className="size-3" />}
                </span>
              </button>
            );
          })}
        </div>
        <Button className="jelly-btn mt-4 h-10 w-full rounded-full" onClick={save} disabled={!sel.size}>
          保存成员
        </Button>
      </div>
    </div>
  );
}

/** 群内 assistant 行：显示发言者头像+名字，气泡沿用奶油样式 */
function GroupAssistantRow({ entry, members, online }: { entry: ChatEntry; members: Character[]; online: boolean }) {
  const speaker = members.find((m) => m.id === entry.senderId) ?? members[0];
  if (!speaker) return null;
  const lines = splitBubbles(entry.content);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-2">
        <GroupAvatar character={speaker} size={26} status={online ? "online" : "offline"} />
        <div className="flex max-w-[82%] flex-col items-start gap-1.5">
          <span className="pl-1 text-[10px] font-medium text-muted-foreground">{displayName(speaker)}</span>
          {lines.map((line, i) => (
            <div key={i} className="reveal reveal-up" data-reveal-delay={String(i * 60)}>
              <div className="bubble-cream whitespace-pre-wrap break-words rounded-3xl rounded-bl-lg px-3.5 py-2 text-[12.5px] leading-relaxed">{line}</div>
            </div>
          ))}
          {entry.transfer && (
            <div className="flex items-center gap-2 rounded-2xl bg-[linear-gradient(135deg,oklch(0.75_0.15_70),oklch(0.7_0.16_55))] px-3.5 py-2.5 text-white shadow-sm">
              <span className="flex size-7 items-center justify-center rounded-full bg-white/25 text-[13px] font-bold">¥</span>
              <span className="flex flex-col">
                <span className="text-[13px] font-semibold leading-tight">¥{entry.transfer.amount.toFixed(2)}</span>
                <span className="text-[9.5px] opacity-80">{entry.transfer.note}</span>
              </span>
            </div>
          )}
          {entry.location && (
            <div className="flex w-52 flex-col gap-1 rounded-2xl bg-white/85 px-3 py-2 shadow-sm">
              <span className="text-[12px] font-medium">{entry.location.place}</span>
              <span className="text-[10px] text-muted-foreground">{entry.location.addr}</span>
            </div>
          )}
          {entry.order && (
            <div className="flex w-56 items-center gap-2 rounded-2xl bg-white/85 px-3 py-2 shadow-sm">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Sparkles className="size-4" />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[12px] font-medium">
                  {entry.order.kind === "gift" ? "礼物" : "外卖"}·{entry.order.shop}
                </span>
                <span className="truncate text-[10px] text-muted-foreground">
                  {entry.order.items.map((i) => `${i.name}x${i.qty}`).join("+") || entry.order.note || "待收下"}
                  {entry.order.amount ? ` ¥${entry.order.amount.toFixed(2)}` : ""}
                </span>
              </span>
            </div>
          )}
        </div>
      </div>
      {entry.mcpNote && <p className="pl-10 text-[9.5px] leading-relaxed text-muted-foreground/80">{entry.mcpNote}</p>}
    </div>
  );
}

/** 群内小头像：复用共享 Avatar；无角色时用占位圆 */
function GroupAvatar({ character, size, status }: { character?: Character; size: number; status?: "online" | "offline" | "typing" }) {
  if (!character) return <span className="shrink-0 rounded-full bg-primary/15" style={{ width: size, height: size }} />;
  return <Avatar character={character} size={size} status={status === "offline" ? "offline" : status} />;
}
