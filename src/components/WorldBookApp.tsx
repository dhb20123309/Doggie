// 手机内「世界书」应用：全局/局部设定条目 + 插入深度 + 文档一键导入 + 热梗世界书（300条预置）
import { useRef, useState } from "react";
import { ChevronLeft, Clock, FileUp, Flame, Globe, Lock, Pin, Plus, Trash2, Waves, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import type { WorldBook } from "@/lib/worldbook";
import { effectiveKeywords, autoKeywords, parseDocxBuffer } from "@/lib/worldbook";
import { useWorldBooks, usePersisted } from "@/lib/chat-store";
import { parseWorldBookMd } from "@/lib/import-parse";
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

/** 深度徽章文案 */
export const DEPTH_META: Record<0 | 1 | 2, { icon: string; label: string; tip: string }> = {
  0: { icon: "📌", label: "常驻", tip: "每次回复都完整喂给 AI，最稳但最费字——适合世界观、人物关系等核心设定" },
  1: { icon: "🕐", label: "触发", tip: "只有你或 TA 的话触发了关键词，这条才会被喂给 AI——省 token、不硬塞" },
  2: { icon: "🌊", label: "深层", tip: "平时只以名字出现在目录里，AI 觉得需要时会主动申请查看全文" },
};

/** emoji 在部分浏览器缺字体渲染成豆腐块，徽章/按钮统一用 lucide 图标 */
const DEPTH_ICON: Record<0 | 1 | 2, React.ComponentType<{ className?: string }>> = {
  0: Pin,
  1: Clock,
  2: Waves,
};
function DepthBadge({ d, className }: { d: 0 | 1 | 2; className?: string }) {
  const Icon = DEPTH_ICON[d];
  return (
    <span className={className}>
      <Icon className="mr-1 inline size-2.5 align-[-1px]" />
      {DEPTH_META[d].label}
    </span>
  );
}

export function WorldBookApp({ onBack, boundIds, onPick }: Props) {
  const [books, setBooks] = useWorldBooks();
  const [editing, setEditing] = useState<WorldBook | null>(null);
  const [memeOpen, setMemeOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  // 管理模式：条目卡显示勾选框，支持全选/多选后一键改为全局或局部
  const [managing, setManaging] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());

  const save = (wb: WorldBook & { __del?: boolean }) => {
    setBooks((prev) => (wb.__del ? prev.filter((b) => b.id !== wb.id) : upsert(prev, wb)));
    setEditing(null);
  };

  const toggleManage = () => {
    setManaging((v) => !v);
    setSel(new Set());
  };
  const toggleSel = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allSelected = books.length > 0 && sel.size === books.length;
  const applyScope = (scope: "global" | "local") => {
    setBooks((prev) => prev.map((b) => (sel.has(b.id) ? { ...b, scope } : b)));
    console.log(`[worldbook] batch scope=${scope} count=${sel.size}`);
    setSel(new Set());
  };

  if (onPick && boundIds) {
    return <BookPicker books={books} initial={boundIds} onDone={onPick} onBack={onBack} />;
  }

  if (importing) {
    return (
      <ImportPanel
        onBack={() => setImporting(false)}
        onCommit={(items, depth) => {
          setBooks((prev) => {
            let next = [...prev];
            for (const it of items) {
              let name = it.name;
              let n = 2;
              while (next.some((b) => b.name === name)) name = `${it.name} ${n++}`;
              next = upsert(next, { id: `wb_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name, content: it.content, scope: "local", depth });
            }
            return next.slice(0, 400);
          });
          console.log(`[worldbook] import count=${items.length} depth=${depth}`);
          setImporting(false);
        }}
      />
    );
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
        <span className="text-sm font-semibold">{managing ? `管理（已选 ${sel.size}）` : "世界书"}</span>
        <div className="flex">
          {managing ? (
            <Button size="sm" variant="ghost" className="jelly-btn h-8 rounded-full px-3 text-xs text-muted-foreground" onClick={toggleManage}>
              退出
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="jelly-btn h-8 rounded-full px-2.5 text-xs text-primary"
                onClick={toggleManage}
                disabled={!books.length}
                aria-label="管理模式"
              >
                管理
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="jelly-icon size-8 text-primary"
                onClick={() => setImporting(true)}
                aria-label="导入文档"
              >
                <FileUp className="size-5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="jelly-icon size-8 text-primary"
                onClick={() => setEditing({ id: `wb_${Date.now()}`, name: "", content: "", scope: "local", depth: 1 })}
                aria-label="新建条目"
              >
                <Plus className="size-5" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 管理工具条：全选 + 一键改全局/局部 */}
      {managing && (
        <div className="fade-up flex items-center gap-2 border-b border-border/60 bg-card/60 px-3 py-2">
          <button
            type="button"
            onClick={() => setSel(allSelected ? new Set() : new Set(books.map((b) => b.id)))}
            disabled={!books.length}
            className="jelly-btn flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1 text-[11.5px] font-medium disabled:opacity-40"
          >
            <span className={`flex size-4 items-center justify-center rounded border ${allSelected ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
              {allSelected && <Check className="size-3" />}
            </span>
            全选
          </button>
          <button
            type="button"
            onClick={() => applyScope("global")}
            disabled={!sel.size}
            className="jelly-btn flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-3 py-1 text-[11.5px] font-medium text-success disabled:opacity-40"
          >
            <Globe className="size-3.5" /> 改为全局
          </button>
          <button
            type="button"
            onClick={() => applyScope("local")}
            disabled={!sel.size}
            className="jelly-btn flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-[11.5px] font-medium text-warning disabled:opacity-40"
          >
            <Lock className="size-3.5" /> 改为局部
          </button>
          {!!sel.size && (
            <button type="button" onClick={() => setSel(new Set())} className="jelly-icon ml-auto flex size-6 items-center justify-center rounded-full text-muted-foreground" aria-label="清空选择">
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}

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
          世界书是喂给 AI 但不出现在聊天记录里的背景设定。「全局」对所有角色生效，「局部」需在角色设定里勾选绑定；每条可调节插入深度控制注入时机。点右上角 <FileUp className="inline size-3" /> 可从 txt / md / Word 文档一键导入。
        </p>
        {books.length === 0 && (
          <p className="pt-8 text-center text-xs text-muted-foreground">还没有条目，点右上角 + 新建或导入文档</p>
        )}
        {books.map((wb) => {
          const d = wb.depth ?? 1;
          const checked = sel.has(wb.id);
          return (
            <button
              key={wb.id}
              type="button"
              onClick={() => (managing ? toggleSel(wb.id) : setEditing(wb))}
              className={`jelly-btn block w-full rounded-xl border p-3 text-left ${
                managing && checked ? "border-primary bg-primary/10" : "border-border bg-card"
              }`}
            >
              <div className="flex items-center gap-1.5">
                {managing && (
                  <span className={`flex size-4.5 shrink-0 items-center justify-center rounded border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-white"}`}>
                    {checked && <Check className="size-3" />}
                  </span>
                )}
                {wb.scope === "global" ? <Globe className="size-3.5 text-success" /> : <Lock className="size-3.5 text-warning" />}
                <span className="text-[13px] font-semibold">{wb.name || "未命名设定"}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                  <DepthBadge d={d} className="rounded-full bg-primary/10 px-1.5 py-0.5 font-medium text-primary" />
                  {wb.scope === "global" ? "全局" : "局部"}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{wb.content}</p>
              {d === 1 && (
                <p className="mt-1 truncate text-[10px] text-primary/70">触发词：{effectiveKeywords(wb).join(" · ")}</p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** 文档导入面板：选文件 → 解析预览 → 勾选 + 统一深度 → 导入 */
function ImportPanel({
  onBack,
  onCommit,
}: {
  onBack: () => void;
  onCommit: (items: { name: string; content: string }[], depth: 0 | 1 | 2) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<{ name: string; content: string }[]>([]);
  const [sel, setSel] = useState<boolean[]>([]);
  const [fileName, setFileName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [depth, setDepth] = useState<0 | 1 | 2>(1);

  const parse = async (file: File) => {
    setErr("");
    setBusy(true);
    setFileName(file.name);
    try {
      const lower = file.name.toLowerCase();
      let out: { name: string; content: string }[];
      if (lower.endsWith(".docx")) {
        out = await parseDocxBuffer(await file.arrayBuffer(), file.name.replace(/\.docx$/i, ""));
      } else if (lower.endsWith(".doc")) {
        throw new Error("暂不支持老版 .doc，请在 Word 里另存为 .docx 或 .md");
      } else {
        // txt / md：先试 markdown 分节；无分节时按"第X章/数字序号"行兜底切分
        const text = await file.text();
        out = parseWorldBookMd(text, file.name.replace(/\.(md|txt)$/i, ""));
        if (out.length === 1) {
          const parts = text.split(/^\s*(?:第[一二三四五六七八九十百\d]+[章节部分篇]|\d+[、.．])\s*\S.*$/m);
          if (parts.length > 2) {
            out = [];
            const heads = text.match(/^ *(?:第[一二三四五六七八九十百\d]+[章节部分篇]|\d+[、.．]).*$/gm) ?? [];
            heads.forEach((h, i) => {
              const body = (parts[i + 1] ?? "").trim();
              if (body) out.push({ name: `${file.name.replace(/\.(md|txt)$/i, "")} · ${h.trim()}`, content: body.length > 2500 ? `${body.slice(0, 2500)}…` : body });
            });
            if (!out.length) out = [{ name: file.name, content: text.slice(0, 2500) }];
          }
        }
      }
      out = out.filter((s) => s.content.trim()).slice(0, 50);
      if (!out.length) throw new Error("没解析出文字内容，换 md/txt 试试");
      setItems(out);
      setSel(out.map(() => true));
      console.log(`[worldbook] import parsed file=${file.name} sections=${out.length}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "解析失败");
      setItems([]);
    } finally {
      setBusy(false);
    }
  };

  const chosen = items.filter((_, i) => sel[i]);

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="glass-nav flex items-center justify-between px-2 py-2">
        <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onBack} aria-label="返回">
          <ChevronLeft className="size-5" />
        </Button>
        <span className="text-sm font-semibold">导入文档</span>
        <span className="w-8" />
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".md,.txt,.docx,.doc"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void parse(f);
          e.target.value = "";
        }}
      />
      <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="jelly-btn block w-full rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4 text-center text-[12.5px] font-medium text-primary"
        >
          {busy ? "正在解析…" : fileName ? `重新选择（当前：${fileName}）` : "选择 txt / md / docx 文件"}
        </button>
        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-[11.5px] text-destructive">{err}</p>}
        {items.length > 0 && (
          <>
            <p className="px-1 text-[11px] text-muted-foreground">
              按二级标题/章节自动分成 {items.length} 条设定，取消勾选不想导入的节。单节超 2500 字会截断。
            </p>
            {items.map((it, i) => (
              <button
                key={`${it.name}-${i}`}
                type="button"
                onClick={() => setSel((s) => s.map((v, j) => (j === i ? !v : v)))}
                className={`jelly-btn flex w-full items-start gap-2 rounded-xl border p-3 text-left ${
                  sel[i] ? "border-primary bg-primary/10" : "border-border bg-card opacity-60"
                }`}
              >
                <span className={`mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded border ${sel[i] ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                  {sel[i] && <Check className="size-3" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-semibold">{it.name}</span>
                  <span className="mt-0.5 line-clamp-2 block text-[11px] leading-relaxed text-muted-foreground">{it.content}</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">{it.content.length} 字</span>
                </span>
              </button>
            ))}
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="mb-2 text-[12px] font-semibold">默认插入深度</p>
              <div className="flex gap-1.5">
                {([0, 1, 2] as const).map((d) => {
                  const Icon = DEPTH_ICON[d];
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDepth(d)}
                      className={`jelly-btn flex flex-1 items-center justify-center gap-1 rounded-lg border py-1.5 text-[11px] font-medium ${
                        depth === d ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary text-secondary-foreground"
                      }`}
                    >
                      <Icon className="size-3" /> {DEPTH_META[d].label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted-foreground">{DEPTH_META[depth].tip}</p>
            </div>
            <Button
              size="sm"
              className="jelly-btn h-9 w-full rounded-xl text-[13px]"
              disabled={!chosen.length}
              onClick={() => onCommit(chosen, depth)}
            >
              导入 {chosen.length} 条
            </Button>
          </>
        )}
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
              className={`jelly-btn flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium ${
                form.scope === s ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary text-secondary-foreground"
              }`}
            >
              {s === "global" ? <Globe className="size-3.5" /> : <Lock className="size-3.5" />}
              {s === "global" ? "全局生效" : "仅绑定角色"}
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
        {/* 插入深度：控制这条设定什么时候被喂给 AI */}
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="mb-2 text-[12px] font-semibold">插入深度</p>
          <div className="flex gap-1.5">
            {([0, 1, 2] as const).map((d) => {
              const Icon = DEPTH_ICON[d];
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, depth: d }))}
                  className={`jelly-btn flex flex-1 items-center justify-center gap-1 rounded-lg border py-1.5 text-[11px] font-medium ${
                    (form.depth ?? 1) === d ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary text-secondary-foreground"
                  }`}
                >
                  <Icon className="size-3" /> {DEPTH_META[d].label}
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted-foreground">{DEPTH_META[form.depth ?? 1].tip}</p>
          {(form.depth ?? 1) === 1 && (
            <div className="mt-2">
              <Input
                placeholder={autoKeywords(form).join(" / ") || "触发词（用 / 分隔，留空自动提取）"}
                defaultValue={(form.keywords ?? []).join(" / ")}
                onBlur={(e) => {
                  const ks = e.target.value.split(/[\/、,，\s]+/).map((x) => x.trim()).filter(Boolean);
                  setForm((f) => ({ ...f, keywords: ks.length ? ks : undefined }));
                }}
                className="h-8 rounded-lg bg-muted/40 text-[11px]"
              />
              <p className="mt-1 text-[10px] text-muted-foreground">
                留空则按名称与正文自动提取：{autoKeywords(form).join(" · ") || "（先写点内容）"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
