// 手机内「世界书」应用：全局/局部设定条目 + 角色绑定选择器
import { useState } from "react";
import { ChevronLeft, Plus, Trash2, Globe, Lock, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { WorldBook } from "@/lib/worldbook";
import { useWorldBooks } from "@/lib/chat-store";

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
