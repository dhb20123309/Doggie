// 手机内「表情包」应用：上传图片存 base64，AI 按 [表情:名字] 调用
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Plus, Trash2, Globe, Lock, ImagePlus, Store, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Sticker } from "@/lib/worldbook";
import { useStickers } from "@/lib/chat-store";
import { MemeSquarePanel } from "./MemeSquarePanel";

interface Props {
  onBack: () => void;
}

/** 上传时压到 200KB 以内：canvas 缩放 + jpeg 质量递减 */
async function compressToDataUrl(file: File): Promise<string> {
  const bitmapUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const el = new Image();
      el.onload = () => res(el);
      el.onerror = rej;
      el.src = bitmapUrl;
    });
    let w = Math.min(img.width, 512);
    let quality = 0.85;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    let url = "";
    for (let i = 0; i < 6; i++) {
      canvas.width = w;
      canvas.height = Math.round((img.height / img.width) * w);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      url = canvas.toDataURL("image/jpeg", quality);
      if (url.length * 0.75 <= 200 * 1024) break;
      if (w > 256) w = Math.round(w * 0.8);
      else quality = Math.max(0.4, quality - 0.1);
    }
    return url;
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}

export function StickerApp({ onBack }: Props) {
  const [stickers, setStickers] = useStickers();
  const [editing, setEditing] = useState<Sticker | null>(null);
  const [squareOpen, setSquareOpen] = useState(false);
  // 多选删除模式：selecting 开启点选，selected 记录已勾选 id
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitSelect = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);

  const removeSelected = () => {
    const n = selected.size;
    setStickers((prev) => prev.filter((s) => !selected.has(s.id)));
    exitSelect();
    console.log(`[sticker] batch delete n=${n}`);
  };

  // 截图验收专用：?vpSeed=1 注入测试表情（仅空库时生效，不影响正常使用）；?vpSel=1 直接进入多选模式并预选前两张
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("vpSeed") === "1" && stickers.length === 0) {
      setStickers(
        Array.from({ length: 9 }, (_, i) => ({
          id: `st_seed_${i}`,
          name: `测试表情${i + 1}`,
          url: "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" rx="16" fill="hsl(${i * 40},65%,82%)"/><text x="60" y="78" font-size="48" font-family="sans-serif" text-anchor="middle" fill="#5b4a2f">${i + 1}</text></svg>`),
          isGlobal: true,
        })),
      );
    }
    if (sp.get("vpSel") === "1") {
      setSelecting(true);
      setSelected(new Set(["st_seed_0", "st_seed_1"]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (squareOpen) {
    return (
      <MemeSquarePanel
        stickers={stickers}
        onAddStickers={(items) => setStickers((prev) => [...prev, ...items.filter((it) => !prev.some((s) => s.id === it.id))])}
        onRemoveStickers={(ids) => setStickers((prev) => prev.filter((s) => !ids.includes(s.id)))}
        onBack={() => setSquareOpen(false)}
      />
    );
  }

  const save = (st: Sticker & { __del?: boolean }) => {
    setStickers((prev) =>
      st.__del ? prev.filter((s) => s.id !== st.id) : (() => { const i = prev.findIndex((s) => s.id === st.id); return i < 0 ? [...prev, st] : prev.map((s) => (s.id === st.id ? st : s)); })()
    );
    setEditing(null);
  };

  if (editing) return <StickerEditor sticker={editing} onSave={save} onCancel={() => setEditing(null)} />;

  return (
    <div className="relative flex h-full flex-col bg-background">
      <div className="glass-nav flex items-center justify-between px-2 py-2">
        <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={selecting ? exitSelect : onBack} aria-label={selecting ? "退出多选" : "返回"}>
          <ChevronLeft className="size-5" />
        </Button>
        {selecting ? (
          <>
            <Button variant="ghost" size="sm" className="jelly-btn h-8 rounded-full px-2.5 text-xs text-muted-foreground" onClick={exitSelect}>
              <X className="mr-1 size-4" />
              取消
            </Button>
            <span className="text-sm font-semibold">已选 {selected.size} 张</span>
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="sm"
                className="jelly-btn h-8 rounded-full px-2.5 text-xs text-muted-foreground"
                disabled={selected.size === stickers.length}
                onClick={() => setSelected(new Set(stickers.map((s) => s.id)))}
              >
                全选
              </Button>
              <Button
                size="sm"
                variant="destructive"
                className="jelly-btn ml-1 h-8 rounded-full px-3 text-xs"
                disabled={selected.size === 0}
                onClick={removeSelected}
              >
                <Trash2 className="mr-1 size-3.5" />
                删除
              </Button>
            </div>
          </>
        ) : (
          <>
            <span className="text-sm font-semibold">表情包</span>
            <div className="flex items-center">
              {stickers.length > 0 && (
                <Button variant="ghost" size="icon" className="jelly-icon size-8 text-primary" onClick={() => setSelecting(true)} aria-label="多选删除">
                  <Check className="size-5" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="jelly-icon size-8 text-primary" onClick={() => setSquareOpen(true)} aria-label="表情包广场">
                <Store className="size-5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="jelly-icon size-8 text-primary"
                onClick={() => setEditing({ id: `st_${Date.now()}`, name: "", url: "", isGlobal: true })}
                aria-label="新建表情"
              >
                <Plus className="size-5" />
              </Button>
            </div>
          </>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
          给表情起贴合情绪的名字。聊天时 AI 只会从这份名单里选表情，用 [表情:名字] 发出，界面自动换成图片气泡。
        </p>
        {stickers.length === 0 ? (
          <button
            type="button"
            onClick={() => setEditing({ id: `st_${Date.now()}`, name: "", url: "", isGlobal: true })}
            className="jelly-btn mx-auto flex aspect-square w-full max-w-[220px] flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border text-muted-foreground"
          >
            <ImagePlus className="size-7" />
            <span className="text-xs">点我上传第一张表情</span>
          </button>
        ) : (
          <div className="grid grid-cols-3 gap-2.5">
            {stickers.map((st) => {
              const on = selected.has(st.id);
              return (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => (selecting ? toggleSelect(st.id) : setEditing(st))}
                  className={`jelly-btn group relative overflow-hidden rounded-xl border bg-card p-1.5 text-left ${
                    selecting && on ? "border-red-400 ring-2 ring-red-400/40" : "border-border"
                  }`}
                >
                  <img src={st.url} alt={st.name} className={`aspect-square w-full rounded-lg object-cover ${selecting && on ? "opacity-60" : ""}`} />
                  <span className="mt-1 block truncate text-[11px] font-medium">{st.name}</span>
                  {selecting ? (
                    <span
                      className={`absolute left-1 top-1 flex size-5 items-center justify-center rounded-full border-2 ${
                        on ? "border-red-400 bg-red-400 text-white" : "border-white/90 bg-black/30"
                      }`}
                    >
                      {on && <Check className="size-3" />}
                    </span>
                  ) : (
                    <span className="absolute right-1 top-1 rounded-full bg-black/45 p-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      {st.isGlobal ? <Globe className="size-3 text-white" /> : <Lock className="size-3 text-white" />}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selecting && selected.size > 0 && (
        <div className="fade-up glass-strong absolute bottom-3 left-3 right-3 z-30 flex items-center justify-between rounded-2xl px-3 py-2 shadow-lg">
          <span className="text-xs">已选 {selected.size} 张</span>
          <Button size="sm" variant="destructive" className="jelly-btn h-8 gap-1 rounded-full px-3 text-xs" onClick={removeSelected}>
            <Trash2 className="size-3.5" />
            删除所选
          </Button>
        </div>
      )}
    </div>
  );
}

function StickerEditor({
  sticker,
  onSave,
  onCancel,
}: {
  sticker: Sticker;
  onSave: (st: Sticker & { __del?: boolean }) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Sticker>(sticker);
  const fileRef = useRef<HTMLInputElement>(null);
  const isNew = !sticker.name && !sticker.url;

  const pickFile = (file?: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    void compressToDataUrl(file).then((url) => setForm((f) => ({ ...f, url })));
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="glass-nav flex items-center justify-between px-2 py-2">
        <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onCancel} aria-label="取消">
          <ChevronLeft className="size-5" />
        </Button>
        <span className="text-sm font-semibold">{isNew ? "新建表情" : "编辑表情"}</span>
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
          <Button
            size="sm"
            className="jelly-btn ml-1 h-8 rounded-full px-3 text-xs"
            disabled={!form.url || !form.name.trim()}
            onClick={() => onSave({ ...form, name: form.name.trim() })}
          >
            保存
          </Button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="jelly-btn mx-auto block aspect-square w-full max-w-[200px] overflow-hidden rounded-2xl border-2 border-dashed border-border bg-muted/30"
          aria-label="选择图片"
        >
          {form.url ? (
            <img src={form.url} alt="表情预览" className="size-full object-cover" />
          ) : (
            <span className="flex size-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
              <ImagePlus className="size-7" />
              <span className="text-xs">点击上传图片</span>
            </span>
          )}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />

        <Input
          placeholder="表情名字，例如：委屈（AI 靠这个名字选用）"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="h-10 rounded-lg bg-muted/40 text-[13px]"
        />
        <div className="flex gap-2">
          {[true, false].map((g) => (
            <button
              key={String(g)}
              type="button"
              onClick={() => setForm((f) => ({ ...f, isGlobal: g }))}
              className={`jelly-btn flex-1 rounded-lg border py-2 text-xs font-medium ${
                form.isGlobal === g ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary text-secondary-foreground"
              }`}
            >
              {g ? "🌍 所有角色可用" : "🔒 需角色绑定"}
            </button>
          ))}
        </div>
        <p className="text-[10px] leading-relaxed text-muted-foreground">图片会自动压缩到 200KB 以内并以 base64 持久保存，刷新不丢。</p>
      </div>
    </div>
  );
}
