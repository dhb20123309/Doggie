// 「TA 的聊天」应用：角色设定 + 单角色连续对话
import { useRef, useState } from "react";
import {
  ChevronLeft,
  SendHorizontal,
  LoaderCircle,
  RefreshCw,
  Settings2,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { AiConfig } from "@/lib/types";
import { isConfigured } from "@/lib/types";
import { chatCompletion } from "@/lib/ai-api";
import {
  type Character,
  type ChatEntry,
  splitBubbles,
  buildHistory,
} from "@/lib/chat-types";
import { useCharacter, useChatLog, clearChatLog } from "@/lib/chat-store";

interface Props {
  config: AiConfig;
  onBack: () => void;
}

const EMOJIS = ["🌙", "🦊", "🐱", "🤖", "🌸", "⚡", "🫧", "🍵", "🎧", "🪐"];

export function RoleChatApp({ config, onBack }: Props) {
  const [character, setCharacter] = useCharacter();
  const [log, setLog] = useChatLog();
  const [view, setView] = useState<"chat" | "edit">("chat");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const ready = isConfigured(config);

  const scrollBottom = () => {
    requestAnimationFrame(() =>
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })
    );
  };

  /** 发送或重试：history 为已含本次用户消息的完整上下文 */
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
      setLog((prev) =>
        prev.map((e) => (e.id === userMsgId ? { ...e, failed: true } : e))
      );
    } finally {
      setPending(false);
      scrollBottom();
    }
  };

  const send = () => {
    const text = input.trim();
    if (!text || pending || !ready) return;
    const userMsg: ChatEntry = { id: `u${Date.now()}`, role: "user", content: text, at: Date.now() };
    const next = [...log, userMsg];
    setLog(next);
    setInput("");
    void requestReply(next, userMsg.id);
  };

  const retry = (userMsgId: string) => {
    if (pending || !ready) return;
    // 移除该失败消息之后的残留，保留已发消息本身
    const idx = log.findIndex((e) => e.id === userMsgId);
    const kept = log.slice(0, idx + 1).map((e) => (e.id === userMsgId ? { ...e, failed: false } : e));
    setLog([...kept, ...log.slice(idx + 1).filter((e) => e.id !== userMsgId)]);
    void requestReply(log.slice(0, idx + 1), userMsgId);
  };

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
      <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
        <Input
          placeholder={ready ? (pending ? "等待回复中…" : `发给 ${character.name || "TA"}…`) : "请先在设置中接入接口"}
          value={input}
          disabled={!ready || pending}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          className="h-9 rounded-full bg-muted/50 text-[13px] disabled:opacity-60"
        />
        <Button size="icon" className="size-9 shrink-0 rounded-full" onClick={send} disabled={!ready || pending || !input.trim()} aria-label="发送">
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
        </Button>
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
