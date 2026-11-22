// 手机内「AI 助手」应用：真实调用设置页配置的接口
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, SendHorizontal, LoaderCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AiConfig, ChatMessage } from "@/lib/types";
import { isConfigured } from "@/lib/types";
import { chatCompletion } from "@/lib/ai-api";

interface Props {
  config: AiConfig;
  onBack: () => void;
  onOpenSettings: () => void;
}

export function ChatApp({ config, onBack, onOpenSettings }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "m0",
      role: "assistant",
      content: "嗨，我是住在这台小手机里的 AI 助手。先在「设置」里接好接口，再来找我聊天吧。",
    },
  ]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const ready = isConfigured(config);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  const send = async () => {
    const text = input.trim();
    if (!text || pending || !ready) return;
    const userMsg: ChatMessage = { id: `u${Date.now()}`, role: "user", content: text };
    const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setPending(true);
    try {
      const reply = await chatCompletion(config, history);
      setMessages((prev) => [...prev, { id: `a${Date.now()}`, role: "assistant", content: reply }]);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [
        ...prev,
        {
          id: `e${Date.now()}`,
          role: "assistant",
          content: `⚠️ 调用失败：${detail}\n请回到「设置」点一次“连接测试”，按提示排查。`,
        },
      ]);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border px-2 py-2">
        <Button variant="ghost" size="icon" className="size-8" onClick={onBack} aria-label="返回">
          <ChevronLeft className="size-5" />
        </Button>
        <div className="text-center">
          <span className="block text-sm font-semibold leading-tight">AI 助手</span>
          <span className={`block text-[10px] leading-tight ${ready ? "text-success" : "text-warning"}`}>
            {ready ? `${config.model} · 已接入` : "未配置接口"}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => setMessages([{ id: "m0", role: "assistant", content: "新会话开始，有什么可以帮你？" }])}
          aria-label="清空会话"
        >
          <RotateCcw className="size-4" />
        </Button>
      </div>

      <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {!ready && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="mx-auto block rounded-full bg-warning/15 px-3 py-1.5 text-[11px] text-warning transition-transform active:scale-95"
          >
            接口未配置，点此前往设置 →
          </button>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[82%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed shadow-sm ${
                m.role === "user"
                  ? "rounded-br-md bg-primary text-primary-foreground"
                  : "rounded-bl-md bg-secondary text-secondary-foreground"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {pending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-secondary px-3 py-2.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="typing-dot size-1.5 rounded-full bg-muted-foreground"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
        <Input
          placeholder={ready ? "说点什么…" : "请先在设置中接入接口"}
          value={input}
          disabled={!ready}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          className="h-9 rounded-full bg-muted/50 text-[13px]"
        />
        <Button
          size="icon"
          className="size-9 shrink-0 rounded-full"
          onClick={send}
          disabled={!ready || pending || !input.trim()}
          aria-label="发送"
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
