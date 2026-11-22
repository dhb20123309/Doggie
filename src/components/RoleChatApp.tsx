// 「TA 的聊天」应用：角色设定 + 单角色连续对话 + 输入与发送习惯（SullyOS 式）
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
  buildHistory,
} from "@/lib/chat-types";
import { useCharacter, useChatLog, useSendPrefs, clearChatLog } from "@/lib/chat-store";

interface Props {
  config: AiConfig;
  onBack: () => void;
}

const EMOJIS = ["🌙", "🦊", "🐱", "🤖", "🌸", "⚡", "🫧", "🍵", "🎧", "🪐"];
/** 自动回复倒计时：停止输入后等待时长 */
const AUTO_DELAY_MS = 2000;

type View = "chat" | "edit" | "prefs";

export function RoleChatApp({ config, onBack }: Props) {
  const [character, setCharacter] = useCharacter();
  const [log, setLog] = useChatLog();
  const [prefs, setPrefs] = useSendPrefs();
  const [view, setView] = useState<View>("chat");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const ready = isConfigured(config);

  // 用 ref 保存最新状态，供定时器读取，避免闭包过期
  const stateRef = useRef({ log, input, pending, ready, prefs, character });
  stateRef.current = { log, input, pending, ready, prefs, character };
  const autoTimer = useRef<number | null>(null);

  const scrollBottom = () => {
    requestAnimationFrame(() =>
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })
    );
  };

  /** 请求角色回复；entries 为已含本次用户消息的完整上下文 */
  const requestReply = async (entries: ChatEntry[], userMsgId: string) => {
    setPending(true);
    scrollBottom();
    try {
      const reply = await chatCompletion(config, buildHistory(character, entries));
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

  /** 把当前草稿作为消息发出（模式02：只发文字不请求） */
  const flushDraft = (): boolean => {
    const text = input.trim();
    if (!text || pending || !ready) return false;
    const userMsg: ChatEntry = { id: `u${Date.now()}`, role: "user", content: text, at: Date.now() };
    setLog((prev) => [...prev, userMsg]);
    setInput("");
    scrollBottom();
    return true;
  };

  /** 对最近一条未获回复的用户消息发起生成 */
  const generate = () => {
    if (pending || !ready) return;
    const s = stateRef.current;
    // 有草稿先并入消息再一起回复（模式01/04 下点按钮 = 发送并生成）
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

  /** 主按钮行为：按「发送按钮代替生成按钮」开关决定 */
  const primaryAction = () => {
    if (stateRef.current.prefs.sendReplacesGenerate) generate();
    else flushDraft();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    // 关闭「回车发送文字」时，回车只保留草稿不发出（模式02：先连发再点触发）
    if (stateRef.current.prefs.enterSendsText) flushDraft();
  };

  /** 对指定用户消息重新发起生成（失败重试） */
  const retry = (userMsgId: string) => {
    if (pending || !ready) return;
    const idx = log.findIndex((e) => e.id === userMsgId);
    if (idx < 0) return;
    const kept = log.slice(0, idx + 1).map((en) => (en.id === userMsgId ? { ...en, failed: false } : en));
    setLog(kept);
    void requestReply(kept, userMsgId);
  };

  // 模式03：发完后倒计时自动生成——条件为无草稿、非生成中、有待回复消息；
  // 继续输入或发新消息会重置计时（重新等待）
  useEffect(() => {
    if (autoTimer.current) {
      clearTimeout(autoTimer.current);
      autoTimer.current = null;
    }
    if (view !== "chat" || !prefs.autoReplyAfterSend || !ready || pending) return;
    if (input.trim()) return; // 仍有草稿：退出输入状态前不触发
    const last = log[log.length - 1];
    if (!last || last.role !== "user") return; // 最后一条不是待回复的用户消息
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
        onSave={(c) => {
          setCharacter(c);
          setView("chat");
        }}
        onCancel={() => setView("chat")}
      />
    );
  }

  if (view === "prefs") {
    return <PrefsEditor prefs={prefs} onSave={setPrefs} onCancel={() => setView("chat")} />;
  }

  const hasDraft = Boolean(input.trim());
  const lastEntry = log[log.length - 1];
  const awaitingReply = Boolean(lastEntry && lastEntry.role === "user");
  const showGenerate = !prefs.sendReplacesGenerate;

  return (
    <div className="flex h-full flex-col bg-background">
      {/* 导航条 */}
      <div className="flex items-center justify-between border-b border-border px-2 py-2">
        <Button variant="ghost" size="icon" className="size-8" onClick={onBack} aria-label="返回">
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
          <Button variant="ghost" size="icon" className="size-8" onClick={() => setView("prefs")} aria-label="输入与发送设置">
            <SlidersHorizontal className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={() => setView("edit")} aria-label="编辑角色">
            <Settings2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
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

      {/* 消息列表 */}
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
                  className="h-6 gap-1 rounded-full border-destructive/40 px-2 text-[10px] text-destructive hover:bg-destructive/5 hover:text-destructive"
                  onClick={() => retry(entry.id)}
                >
                  <RefreshCw className="size-3" />
                  回复失败，点此重试
                </Button>
              )}
            </div>
          ) : (
            <AssistantRow key={entry.id} entry={entry} character={character} />
          )
        )}
        {pending && (
          <div className="flex items-end gap-2">
            <Avatar character={character} size={26} />
            <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-secondary px-3 py-2.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="typing-dot size-1.5 rounded-full bg-muted-foreground"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
              <span className="ml-1 text-[10px] text-muted-foreground">正在回复…</span>
            </div>
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="border-t border-border px-3 py-2.5">
        {showGenerate && (hasDraft || awaitingReply) && !pending && ready && (
          <Button
            size="sm"
            variant="outline"
            className="mb-2 h-7 w-full gap-1.5 rounded-lg border-primary/40 text-[11px] font-semibold text-primary hover:bg-primary/5"
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
            className="h-9 rounded-full bg-muted/50 text-[13px] disabled:opacity-60"
          />
          <Button
            size="icon"
            className="size-9 shrink-0 rounded-full"
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

function AssistantRow({ entry, character }: { entry: ChatEntry; character: Character }) {
  const bubbles = splitBubbles(entry.content);
  return (
    <div className="flex items-start gap-2">
      <Avatar character={character} size={26} />
      <div className="flex max-w-[82%] flex-col gap-1.5">
        {bubbles.map((b, i) => (
          <div key={i} data-reveal-delay={String(i * 60)} className="reveal reveal-up">
            <Bubble side="left">{b}</Bubble>
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
      {isImg ? (
        <img src={character.avatar} alt="角色头像" className="size-full object-cover" />
      ) : (
        character.avatar || "👤"
      )}
    </span>
  );
}

function PrefsEditor({
  prefs,
  onSave,
  onCancel,
}: {
  prefs: SendPrefs;
  onSave: (p: SendPrefs) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<SendPrefs>(prefs);

  const rows: { key: keyof SendPrefs; label: string; desc: string }[] = [
    { key: "sendReplacesGenerate", label: "发送按钮代替生成按钮", desc: "开启后点发送直接请求回复（一问一答）；关闭则发送只发文字，另出现“生成回复”按钮。" },
    { key: "enterSendsText", label: "回车发送文字", desc: "开启后回车立即发出这条文字；关闭时回车不发，可连发多条后再点触发。" },
    { key: "autoReplyAfterSend", label: "发完后自动生成回复", desc: "输入框没有草稿且停止输入 2 秒后自动开始回复；期间继续输入或发新消息会重新等待。" },
  ];

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-2 py-2">
        <Button variant="ghost" size="icon" className="size-8" onClick={onCancel} aria-label="取消">
          <ChevronLeft className="size-5" />
        </Button>
        <div className="text-center leading-tight">
          <span className="block text-sm font-semibold">输入与发送</span>
          <span className="block text-[10px] text-muted-foreground">以下习惯对当前设备的聊天生效</span>
        </div>
        <Button
          size="sm"
          className="h-8 rounded-full px-3 text-xs"
          onClick={() => {
            onSave(form);
            onCancel();
          }}
        >
          保存
        </Button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {rows.map((r) => (
          <div key={r.key} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-3">
              <Label className="cursor-pointer text-[13px] font-semibold" htmlFor={r.key}>
                {r.label}
              </Label>
              <Switch
                id={r.key}
                checked={form[r.key]}
                onCheckedChange={(v) => setForm((f) => ({ ...f, [r.key]: v }))}
              />
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{r.desc}</p>
          </div>
        ))}
        <p className="pt-1 text-center text-[10px] text-muted-foreground">
          参考 SullyOS「聊天设置 → 输入与发送」的四种方式，可自由组合。
        </p>
      </div>
    </div>
  );
}

function CharacterEditor({
  character,
  onSave,
  onCancel,
}: {
  character: Character;
  onSave: (c: Character) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Character>(character);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickFile = (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, avatar: String(reader.result) }));
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-2 py-2">
        <Button variant="ghost" size="icon" className="size-8" onClick={onCancel} aria-label="取消">
          <ChevronLeft className="size-5" />
        </Button>
        <span className="text-sm font-semibold">角色设定</span>
        <Button
          size="sm"
          className="h-8 rounded-full px-3 text-xs"
          onClick={() =>
            onSave({
              name: form.name.trim(),
              avatar: form.avatar,
              persona: form.persona.trim(),
            })
          }
        >
          保存
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div className="flex flex-col items-center gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} className="relative group" aria-label="上传头像">
            <Avatar character={form} size={64} />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
              <Upload className="size-4 text-white" />
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          <div className="flex flex-wrap justify-center gap-1.5">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setForm((f) => ({ ...f, avatar: e }))}
                className={`flex size-8 items-center justify-center rounded-full text-lg transition-all ${
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
          <Input
            id="charName"
            placeholder="例如：小灵"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="h-10 rounded-lg bg-muted/40 text-[13px]"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="charPersona">人设（作为系统提示发给模型）</Label>
          <Textarea
            id="charPersona"
            rows={7}
            placeholder="描述 TA 的身份、性格、说话方式……"
            value={form.persona}
            onChange={(e) => setForm((f) => ({ ...f, persona: e.target.value }))}
            className="resize-none rounded-lg bg-muted/40 text-[12.5px] leading-relaxed"
          />
        </div>
      </div>
    </div>
  );
}
