// 「TA 的聊天」应用：角色设定 + 连续对话 + 输入发送习惯 + 世界书/表情包联动
import { useEffect, useRef, useState } from "react";
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
  type SendPrefs,
  splitBubbles,
} from "@/lib/chat-types";
import {
  type WorldBook,
  type Sticker,
  getActiveWorldBooks,
  buildWorldSection,
  buildStickerHint,
  parseReplyToMessages,
} from "@/lib/worldbook";
import { useCharacter, useChatLog, useSendPrefs, useWorldBooks, useStickers, clearChatLog } from "@/lib/chat-store";

interface Props {
  config: AiConfig;
  onBack: () => void;
}

const EMOJIS = ["🌙", "🦊", "🐱", "🤖", "🌸", "⚡", "🫧", "🍵", "🎧", "🪐"];
/** 自动回复倒计时：停止输入后等待时长 */
const AUTO_DELAY_MS = 2000;

type View = "chat" | "edit" | "prefs" | "worldbooks" | "stickers";

export function RoleChatApp({ config, onBack }: Props) {
  const [character, setCharacter] = useCharacter();
  const [log, setLog] = useChatLog();
  const [prefs, setPrefs] = useSendPrefs();
  const [books] = useWorldBooks();
  const [stickers] = useStickers();
  const [view, setView] = useState<View>("chat");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const ready = isConfigured(config);

  const stateRef = useRef({ log, input, pending, ready, prefs });
  stateRef.current = { log, input, pending, ready, prefs };
  const autoTimer = useRef<number | null>(null);

  /** 每次请求现算：人设 + 生效世界书 + 表情名单 → system prompt */
  const buildHistory = (entries: ChatEntry[]) => {
    const active = getActiveWorldBooks("solo", books, character.boundWorldBookIds ?? []);
    const usable = stickers.filter((s) => s.isGlobal);
    const sys =
      `你现在扮演以下角色，请始终以该身份第一人称回复，不要跳出角色。\n名字：${
        character.name || "无名角色"
      }\n人设：${character.persona || "无额外设定"}\n` +
      "重要：像日常聊天一样回复——每条消息单独占一行，按内容自然分条；只输出角色要发来的消息本身，不要任何解释或格式标记。" +
      buildWorldSection(active) +
      "\n\n" +
      buildStickerHint(usable);
    return [{ role: "system", content: sys }, ...entries.filter((e) => !e.failed).slice(-20).map((e) => ({ role: e.role, content: e.content }))];
  };

  const scrollBottom = () => {
    requestAnimationFrame(() =>
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })
    );
  };

  const requestReply = async (entries: ChatEntry[], userMsgId: string) => {
    setPending(true);
    scrollBottom();
    try {
      const reply = await chatCompletion(config, buildHistory(entries));
      setLog((prev) => [
        ...prev.map((e) => (e.id === userMsgId ? { ...e, failed: false } : e)),
        { id: `a${Date.now()}`, role: "assistant", content: reply, at: Date.now() },
      ]);
    } catch {
      setLog((prev) => prev.map((e) => (e.id === userMsgId ? { ...e, failed: true } : e)));
    } finally {
      setPending(false);
      scrollBottom();
    }
  };

  const flushDraft = (): boolean => {
    const text = input.trim();
    if (!text || pending || !ready) return false;
    const userMsg: ChatEntry = { id: `u${Date.now()}`, role: "user", content: text, at: Date.now() };
    setLog((prev) => [...prev, userMsg]);
    setInput("");
    scrollBottom();
    return true;
  };

  const generate = () => {
    if (pending || !ready) return;
    const s = stateRef.current;
    let entries = s.log;
    let targetId: string | null = null;
    const draft = s.input.trim();
    if (draft) {
      const userMsg: ChatEntry = { id: `u${Date.now()}`, role: "user", content: draft, at: Date.now() };
      entries = [...entries, userMsg];
      targetId = userMsg.id;
      setLog(entries);
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
    void requestReply(entries, targetId);
  };

  const primaryAction = () => {
    if (stateRef.current.prefs.sendReplacesGenerate) generate();
    else flushDraft();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    // 关闭「回车发送文字」时，回车只留草稿不发出（模式02：先连发再点触发）
    if (stateRef.current.prefs.enterSendsText) flushDraft();
  };

  const retry = (userMsgId: string) => {
    if (pending || !ready) return;
    const idx = log.findIndex((e) => e.id === userMsgId);
    if (idx < 0) return;
    const kept = log.slice(0, idx + 1).map((en) => (en.id === userMsgId ? { ...en, failed: false } : en));
    setLog(kept);
    void requestReply(kept, userMsgId);
  };

  // 模式03：发完后倒计时自动生成——无草稿、非生成中、最后一条是用户消息；
  // 继续输入或发新消息会重置计时（重新等待）
  useEffect(() => {
    if (autoTimer.current) {
      clearTimeout(autoTimer.current);
      autoTimer.current = null;
    }
    if (view !== "chat" || !prefs.autoReplyAfterSend || !ready || pending) return;
    if (input.trim()) return;
    const last = log[log.length - 1];
    if (!last || last.role !== "user") return;
    autoTimer.current = window.setTimeout(() => generate(), AUTO_DELAY_MS);
    return () => {
      if (autoTimer.current) clearTimeout(autoTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, log, pending, ready, prefs.autoReplyAfterSend, view]);

  if (view === "edit") {
    return (
      <CharacterEditor
        character={character}
        bookCount={books.filter((b) => b.scope === "local").length}
        onSave={(c) => {
          setCharacter(c);
          setView("chat");
        }}
        onCancel={() => setView("chat")}
        onOpenWorldBooks={() => setView("worldbooks")}
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
        boundIds={character.boundWorldBookIds ?? []}
        onDone={(ids) => {
          setCharacter((c) => ({ ...c, boundWorldBookIds: ids }));
          setView("edit");
        }}
        onBack={() => setView("edit")}
      />
    );
  }
  if (view === "stickers") {
    return <StickerPanel stickers={stickers} onBack={() => setView("chat")} />;
  }

  const hasDraft = Boolean(input.trim());
  const lastEntry = log[log.length - 1];
  const awaitingReply = Boolean(lastEntry && lastEntry.role === "user");
  const showGenerate = !prefs.sendReplacesGenerate;

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-[oklch(0.95_0.015_265)] to-[oklch(0.91_0.025_275)]">
      <div className="glass-nav flex items-center justify-between px-2 py-2">
        <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onBack} aria-label="返回">
          <ChevronLeft className="size-5" />
        </Button>
        <div className="flex items-center gap-2">
          <Avatar character={character} size={28} />
          <div className="text-center leading-tight">
            <span className="block text-sm font-semibold">{character.name || "未命名角色"}</span>
            <span className={`block text-[10px] ${pending ? "text-primary" : ready ? "text-success" : "text-warning"}`}>
              {pending ? "正在回复…" : ready ? "在线" : "未配置接口"}
            </span>
          </div>
        </div>
        <div className="flex">
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
              clearChatLog();
              setLog([]);
            }}
            aria-label="清空聊天记录"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {log.length === 0 && !pending && (
          <p className="pt-10 text-center text-xs text-muted-foreground">
            和 {character.name || "TA"} 说点什么吧
            {!ready && <><br />（先在「设置」里接好 API）</>}
          </p>
        )}
        {log.map((entry) =>
          entry.role === "user" ? (
            <div key={entry.id} className="flex flex-col items-end gap-1">
              <Bubble side="right">{entry.content}</Bubble>
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
            <AssistantRow key={entry.id} entry={entry} character={character} stickerLib={stickers} />
          )
        )}
        {pending && (
          <div className="flex items-end gap-2">
            <Avatar character={character} size={26} />
            <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-secondary px-3 py-2.5">
              {[0, 1, 2].map((i) => (
                <span key={i} className="typing-dot size-1.5 rounded-full bg-muted-foreground" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
              <span className="ml-1 text-[10px] text-muted-foreground">正在回复…</span>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-white/60 px-3 py-2.5 backdrop-blur-xl">
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
                  ? `发给 ${character.name || "TA"}，点击即生成回复…`
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

/** 助手消息：按换行拆气泡，[表情:名字] 换成图片气泡 */
function AssistantRow({ entry, character, stickerLib }: { entry: ChatEntry; character: Character; stickerLib: Sticker[] }) {
  const lines = splitBubbles(entry.content);
  const parts = lines.flatMap((line) => parseReplyToMessages(line, stickerLib));
  return (
    <div className="flex items-start gap-2">
      <Avatar character={character} size={26} />
      <div className="flex max-w-[82%] flex-col items-start gap-1.5">
        {parts.map((p, i) => (
          <div key={i} data-reveal-delay={String(i * 60)} className="reveal reveal-up">
            {p.type === "sticker" ? (
              <img src={p.sticker.url} alt={p.sticker.name} className="w-24 rounded-xl shadow-lg shadow-black/15" />
            ) : (
              <Bubble side="left">{p.content}</Bubble>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Bubble({ side, children }: { side: "left" | "right"; children: React.ReactNode }) {
  return (
    <div
      className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed shadow-sm ${
        side === "right"
          ? "rounded-br-md bg-primary text-primary-foreground"
          : "rounded-bl-md bg-secondary text-secondary-foreground"
      }`}
    >
      {children}
    </div>
  );
}

function Avatar({ character, size }: { character: Character; size: number }) {
  const isImg = character.avatar.startsWith("data:") || character.avatar.startsWith("http");
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-wallpaper-from to-wallpaper-to ring-1 ring-white/30"
      style={{ width: size, height: size, fontSize: size * 0.55 }}
    >
      {isImg ? <img src={character.avatar} alt="角色头像" className="size-full object-cover" /> : character.avatar || "👤"}
    </span>
  );
}

/** 表情库速览面板（完整管理在桌面「表情包」应用） */
function StickerPanel({ stickers, onBack }: { stickers: Sticker[]; onBack: () => void }) {
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="glass-nav flex items-center justify-between px-2 py-2">
        <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onBack} aria-label="返回">
          <ChevronLeft className="size-5" />
        </Button>
        <span className="text-sm font-semibold">当前可用表情</span>
        <span className="size-8" />
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {stickers.filter((s) => s.isGlobal).length === 0 ? (
          <p className="pt-10 text-center text-xs leading-relaxed text-muted-foreground">
            还没有全局表情。
            <br />
            去桌面「表情包」应用上传，AI 聊天时就会按名字调用它们。
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2.5">
            {stickers
              .filter((s) => s.isGlobal)
              .map((s) => (
                <div key={s.id} className="rounded-xl border border-border bg-card p-1.5">
                  <img src={s.url} alt={s.name} className="aspect-square w-full rounded-lg object-cover" />
                  <p className="mt-1 truncate text-center text-[11px]">{s.name}</p>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

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

function CharacterEditor({
  character,
  bookCount,
  onSave,
  onCancel,
  onOpenWorldBooks,
}: {
  character: Character;
  bookCount: number;
  onSave: (c: Character) => void;
  onCancel: () => void;
  onOpenWorldBooks: () => void;
}) {
  const [form, setForm] = useState<Character>(character);
  const fileRef = useRef<HTMLInputElement>(null);

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
          onClick={() => onSave({ name: form.name.trim(), avatar: form.avatar, persona: form.persona.trim(), boundWorldBookIds: form.boundWorldBookIds })}
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
          <Textarea id="charPersona" rows={7} placeholder="描述 TA 的身份、性格、说话方式……" value={form.persona} onChange={(e) => setForm((f) => ({ ...f, persona: e.target.value }))} className="resize-none rounded-lg bg-muted/40 text-[12.5px] leading-relaxed" />
        </div>

        <button type="button" onClick={onOpenWorldBooks} className="jelly-btn flex w-full items-center gap-2 rounded-xl border border-border bg-card p-3 text-left">
          <BookText className="size-4 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold">绑定局部世界书</span>
            <span className="block text-[11px] text-muted-foreground">已绑 {form.boundWorldBookIds?.length ?? 0} 条 / 可选 {bookCount} 条；全局条目自动生效</span>
          </span>
          <ChevronLeft className="size-4 -rotate-90 text-muted-foreground" />
        </button>
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
        {locals.length === 0 && <p className="pt-8 text-center text-xs text-muted-foreground">还没有局部条目，去桌面「世界书」应用新建</p>}
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
