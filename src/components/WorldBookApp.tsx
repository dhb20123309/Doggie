// 手机内「世界书」应用：全局/局部设定条目 + 角色绑定选择器 + 热梗世界书（300条预置）
import { useState } from "react";
import { ChevronLeft, Plus, Trash2, Globe, Lock, Check, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import type { WorldBook } from "@/lib/worldbook";
import { useWorldBooks, usePersisted } from "@/lib/chat-store";
import { PRESET_MEME_BOOK } from "@/lib/meme-book-data";
import { type MemePrefs, DEFAULT_MEME_PREFS } from "@/lib/meme-worldbook";

interface Props {
  onBack: () => void;
  /** 传入时作为角色绑定选择器：勾选局部世界书并保存 */
  boundIds?: string[];
  onPick?: (ids: string[]) => void;
}

const upsert = (prev: WorldBook[], wb: WorldBook) => {
  const i = prev.findIndex((b) => b.id === wb.id);
  return i < 0 ? [...prev, wb] : prev.map((b) => (b.id === wb.id ? wb : b));
};

export function WorldBookApp({ onBack, boundIds, onPick }: Props) {
  const [books, setBooks] = useWorldBooks();
  const [editing, setEditing] = useState<WorldBook | null>(null);
  const [memeOpen, setMemeOpen] = useState(false);

  const save = (wb: WorldBook & { __del?: boolean }) => {
    setBooks((prev) => (wb.__del ? prev.filter((b) => b.id !== wb.id) : upsert(prev, wb)));
    setEditing(null);
  };

  if (onPick && boundIds) {
    return <BookPicker books={books} initial={boundIds} onDone={onPick} onBack={onBack} />;
  }

  if (editing) {
    return <BookEditor book={editing} onSave={save} onCancel={() => setEditing(null)} />;
  }

  if (memeOpen) {
    return <MemeBookPanel onBack={() => setMemeOpen(false)} />;
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="glass-nav flex items-center justify-between px-2 py-2">
        <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onBack} aria-label="返回">
          <ChevronLeft className="size-5" />
        </Button>
        <span className="text-sm font-semibold">世界书</span>
        <Button
          size="icon"
          variant="ghost"
          className="jelly-icon size-8 text-primary"
          onClick={() => setEditing({ id: `wb_${Date.now()}`, name: "", content: "", scope: "local" })}
          aria-label="新建条目"
        >
          <Plus className="size-5" />
        </Button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {/* 热梗世界书入口：300 条网络流行梗，按触发词命中注入让角色接话更有活人感 */}
        <button
          type="button"
          onClick={() => setMemeOpen(true)}
          className="jelly-btn block w-full rounded-xl border border-primary/30 bg-primary/10 p-3 text-left"
        >
          <div className="flex items-center gap-1.5">
            <Flame className="size-3.5 text-primary" />
            <span className="text-[13px] font-semibold">网上冲浪 · 热梗世界书</span>
            <span className="ml-auto text-[10px] text-muted-foreground">{PRESET_MEME_BOOK.length} 条</span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            整理了 300 条网络流行热梗，聊天触及时角色自然接梗，更有活人感。
          </p>
        </button>
        <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
          世界书是喂给 AI 但不出现在聊天记录里的背景设定。「全局」对所有角色生效，「局部」需在角色设定里勾选绑定。
        </p>
        {books.length === 0 && (
          <p className="pt-8 text-center text-xs text-muted-foreground">还没有条目，点右上角 + 新建</p>
        )}
        {books.map((wb) => (
          <button
            key={wb.id}
            type="button"
            onClick={() => setEditing(wb)}
            className="jelly-btn block w-full rounded-xl border border-border bg-card p-3 text-left"
          >
            <div className="flex items-center gap-1.5">
              {wb.scope === "global" ? <Globe className="size-3.5 text-success" /> : <Lock className="size-3.5 text-warning" />}
              <span className="text-[13px] font-semibold">{wb.name || "未命名设定"}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">{wb.scope === "global" ? "全局" : "局部"}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{wb.content}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

/** 角色编辑页进入的绑定选择器：只列局部条目，全局自动生效无需勾选 */
function BookPicker({
  books,
  initial,
  onDone,
  onBack,
}: {
  books: WorldBook[];
  initial: string[];
  onDone: (ids: string[]) => void;
  onBack: () => void;
}) {
  const [sel, setSel] = useState<string[]>(initial);
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
        {locals.length === 0 && <p className="pt-8 text-center text-xs text-muted-foreground">还没有局部条目</p>}
        {locals.map((wb) => {
          const on = sel.includes(wb.id);
          return (
            <button
              key={wb.id}
              type="button"
              onClick={() => setSel((s) => (on ? s.filter((x) => x !== wb.id) : [...s, wb.id]))}
              className={`jelly-btn flex w-full items-center gap-2 rounded-xl border p-3 text-left ${
                on ? "border-primary bg-primary/10" : "border-border bg-card"
              }`}
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

/** 热梗世界书面板：开关 + 注入模式 + 300 条浏览（标题/触发词搜索） */
function MemeBookPanel({ onBack }: { onBack: () => void }) {
  const [prefs, setPrefs] = usePersisted<MemePrefs>("vp-phone:memebook:prefs:v1", DEFAULT_MEME_PREFS);
  const [q, setQ] = useState("");
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const keyword = q.trim().toLowerCase();
  const list = keyword
    ? PRESET_MEME_BOOK.map((e, i) => ({ e, i })).filter(({ e }) => e.title.toLowerCase().includes(keyword) || e.keys.some((k) => k.toLowerCase().includes(keyword)))
    : PRESET_MEME_BOOK.map((e, i) => ({ e, i }));

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="glass-nav flex items-center justify-between px-2 py-2">
        <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onBack} aria-label="返回">
          <ChevronLeft className="size-5" />
        </Button>
        <span className="text-sm font-semibold">热梗世界书</span>
        <span className="w-8" />
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center justify-between">
            <span className="text-[12.5px] font-semibold">启用热梗接话</span>
            <Switch
              checked={prefs.enabled}
              onCheckedChange={(v) => {
                setPrefs((p) => ({ ...p, enabled: v }));
                console.log(`[meme] enabled=${v}`);
              }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[12.5px] font-semibold">全量常驻注入</span>
            <Switch
              checked={prefs.alwaysInject}
              onCheckedChange={(v) => {
                setPrefs((p) => ({ ...p, alwaysInject: v }));
                console.log(`[meme] alwaysInject=${v}`);
              }}
            />
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            关闭时角色完全不读梗库。默认只在你的话触发到关键词时才把对应几条梗喂给 AI（省 token、不硬塞梗）；
            开启「全量常驻」后，300 条梗名摘要每次都在设定里，AI 随时可自主取用，但每条消息都会变长。
          </p>
        </div>
        <Input
          placeholder="搜索梗名或触发词，例如：摸鱼 / 搭子 / 真香"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-9 rounded-lg bg-muted/40 text-[12.5px]"
        />
        <p className="px-1 text-[10.5px] text-muted-foreground">共 {PRESET_MEME_BOOK.length} 条{keyword ? `，匹配 ${list.length} 条` : ""}</p>
        {list.map(({ e, i }) => {
          const open = openIdx === i;
          return (
            <button
              key={e.title}
              type="button"
              onClick={() => setOpenIdx(open ? null : i)}
              className="jelly-btn block w-full rounded-xl border border-border bg-card p-3 text-left"
            >
              <span className="block text-[12.5px] font-semibold">{e.title}</span>
              <span className="mt-0.5 block truncate text-[10.5px] text-primary/80">{e.keys.join(" · ")}</span>
              {open && (
                <span className="mt-1.5 block whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
                  {e.usage}
                  {e.demo ? `\n示例——对方：${e.demo[0]}\n角色：${e.demo[1]}` : ""}
                </span>
              )}
            </button>
          );
        })}
        {list.length === 0 && <p className="pt-8 text-center text-xs text-muted-foreground">没有匹配的梗，换个关键词试试</p>}
      </div>
    </div>
  );
}

function BookEditor({
  book,
  onSave,
  onCancel,
}: {
  book: WorldBook;
  onSave: (wb: WorldBook & { __del?: boolean }) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<WorldBook>(book);
  const isNew = !book.name && !book.content;

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="glass-nav flex items-center justify-between px-2 py-2">
        <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onCancel} aria-label="取消">
          <ChevronLeft className="size-5" />
        </Button>
        <span className="text-sm font-semibold">{isNew ? "新建设定" : "编辑设定"}</span>
        <div className="flex">
          {!isNew && (
            <Button
              variant="ghost"
              size="icon"
              className="jelly-icon size-8 text-destructive"
              onClick={() => onSave({ ...form, __del: true })}
              aria-label="删除"
            >
              <Trash2 className="size-4" />
            </Button>
          )}
          <Button size="sm" className="jelly-btn ml-1 h-8 rounded-full px-3 text-xs" onClick={() => onSave(form)}>
            保存
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <Input
          placeholder="设定名称，例如：现代都市背景"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="h-10 rounded-lg bg-muted/40 text-[13px]"
        />
        <div className="flex gap-2">
          {(["global", "local"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setForm((f) => ({ ...f, scope: s }))}
              className={`jelly-btn flex-1 rounded-lg border py-2 text-xs font-medium ${
                form.scope === s ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary text-secondary-foreground"
              }`}
            >
              {s === "global" ? "🌍 全局生效" : "🔒 仅绑定角色"}
            </button>
          ))}
        </div>
        <Textarea
          rows={10}
          placeholder="正文内容，AI 每次回复前都会读到这段设定……"
          value={form.content}
          onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
          className="resize-none rounded-lg bg-muted/40 text-[12.5px] leading-relaxed"
        />
      </div>
    </div>
  );
}
