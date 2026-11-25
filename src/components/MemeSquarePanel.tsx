// 表情包广场：浏览 AstrBot 开放协议的公开表情包包，一键安装进本地表情库。
// 与工具箱「表情包」浮层、模型 [表情:名字] 名单共用同一份 stickers 存储——装完即全员可调用。
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Download, RefreshCw, Search, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Sticker } from "@/lib/worldbook";
import {
  BUILTIN_SQUARE_PACKS, catLabel, fetchCommunityPacks, fetchPackManifest, installPack, listPackImages, parseRepoInput,
  type SquarePack,
} from "@/lib/meme-square";

interface Props {
  stickers: Sticker[];
  onAddStickers: (items: Sticker[]) => void;
  onRemoveStickers: (ids: string[]) => void;
  onBack: () => void;
}

const SRC_PREFIX = "sq:"; // 表情 id 前缀，标记"来自广场某包"，支持整包卸载

export function MemeSquarePanel({ stickers, onAddStickers, onRemoveStickers, onBack }: Props) {
  const [community, setCommunity] = useState<SquarePack[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [customInput, setCustomInput] = useState("");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ id: string; done: number; total: number; current?: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [confirmUninstall, setConfirmUninstall] = useState<SquarePack | null>(null);
  const noticeTimer = useRef<number>(0);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 4000);
  }, []);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    setCommunity(await fetchCommunityPacks());
    setLoadingList(false);
  }, []);
  useEffect(() => {
    void loadList();
  }, [loadList]);

  const packs = [...BUILTIN_SQUARE_PACKS, ...community.filter((c) => !BUILTIN_SQUARE_PACKS.some((b) => b.id === c.id))];
  const shown = query.trim() ? packs.filter((p) => `${p.name}${p.description ?? ""}${(p.tags ?? []).join("")}`.toLowerCase().includes(query.trim().toLowerCase())) : packs;

  const installedCount = (id: string) => stickers.filter((s) => s.id.startsWith(`${SRC_PREFIX}${id}:`)).length;

  const doInstall = async (pack: SquarePack) => {
    if (busyId) return;
    setBusyId(pack.id);
    setProgress(null);
    try {
      const existing = new Set(stickers.map((s) => s.name));
      const res = await installPack<Sticker>(pack, existing, {
        onProgress: (p) => setProgress({ id: pack.id, ...p }),
        onBatch: (items) => items.forEach((it) => onAddStickers([it])),
        makeSticker: (name, url) => ({ id: `${SRC_PREFIX}${pack.id}:${name}`, name, url, isGlobal: true }),
      });
      flash(`已安装《${pack.name}》：新增 ${res.added} 张${res.skipped ? `，跳过已有 ${res.skipped} 张` : ""}${res.failed ? `，失败 ${res.failed} 张` : ""}`);
    } catch (e) {
      flash(`安装失败：${(e as Error).message}`);
    } finally {
      setBusyId(null);
      setProgress(null);
    }
  };

  /** 自定义仓库：先探 manifest 拿真名再装 */
  const doCustom = async () => {
    const parsed = parseRepoInput(customInput);
    if (!parsed) {
      flash("地址格式不对，示例：https://github.com/owner/repo 或 owner/repo");
      return;
    }
    const src = { repo: parsed.repo, ref: "main", subpath: parsed.subpath || "." };
    const id = `custom-${parsed.repo.replace("/", "-")}${parsed.subpath || ""}`;
    try {
      const man = await fetchPackManifest(src);
      const imgs = await listPackImages(src, man.categories);
      if (!imgs.length) {
        flash("这个仓库里没找到符合协议的表情（需要 manifest.json + memes/分类目录）");
        return;
      }
      const pack: SquarePack = { id, name: man.name || parsed.repo, description: man.description, source: src };
      await doInstall(pack);
      setCustomInput("");
    } catch (e) {
      flash(`探测失败：${(e as Error).message}（确认仓库公开、分支为 main）`);
    }
  };

  const doUninstall = (pack: SquarePack) => {
    const ids = stickers.filter((s) => s.id.startsWith(`${SRC_PREFIX}${pack.id}:`)).map((s) => s.id);
    onRemoveStickers(ids);
    setConfirmUninstall(null);
    flash(`已卸载《${pack.name}》的 ${ids.length} 张表情`);
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="glass-nav absolute left-0 right-0 top-0 z-30 flex items-center justify-between px-2 py-2">
        <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onBack} aria-label="返回">
          <ChevronLeft className="size-5" />
        </Button>
        <span className="text-sm font-semibold">表情包广场</span>
        <button type="button" onClick={() => void loadList()} aria-label="刷新列表" className="jelly-icon flex size-8 items-center justify-center rounded-full text-muted-foreground hover:text-primary">
          <RefreshCw className={`size-4 ${loadingList ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="mt-12 flex-1 overflow-y-auto px-3 pb-6 pt-2">
        <p className="mb-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
          兼容 AstrBot 表情包开放协议的社区资源。点「安装」即可把整套表情收进你的表情库——
          聊天时 TA 会按语境自动调用，工具箱「表情包」里也能手动发送。所有使用者免部署直接用。
        </p>

        {/* 搜索 */}
        <div className="glass-input mb-3 flex items-center gap-2 rounded-xl px-3 py-2">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜包名 / 标签…"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/70"
          />
        </div>

        {/* 包列表 */}
        <div className="space-y-2.5">
          {shown.map((p) => {
            const n = installedCount(p.id);
            const busy = busyId === p.id;
            const prog = progress && progress.id === p.id ? progress : null;
            return (
              <div key={p.id} className="glass rounded-2xl p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold">{p.name}</p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{p.description || "无简介"}</p>
                  </div>
                  {n > 0 && (
                    <button
                      type="button"
                      onClick={() => setConfirmUninstall(p)}
                      aria-label={`卸载 ${p.name}`}
                      className="jelly-icon flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-red-500"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
                {!!p.tags?.length && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {p.tags.map((t) => (
                      <span key={t} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">{t}</span>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] text-muted-foreground">
                    {n > 0 ? `已装 ${n} 张 · ` : ""}{p.source.repo}
                  </span>
                  <Button
                    size="sm"
                    variant={n > 0 ? "outline" : "default"}
                    disabled={busy || !!busyId}
                    onClick={() => void doInstall(p)}
                    className="jelly-btn h-7 gap-1 rounded-lg px-3 text-[11px]"
                  >
                    {busy ? <Sparkles className="size-3.5 animate-pulse" /> : <Download className="size-3.5" />}
                    {busy ? "安装中…" : n > 0 ? "补装更新" : "安装"}
                  </Button>
                </div>
                {prog && (
                  <div className="mt-2">
                    <div className="h-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, Math.round((prog.done / Math.max(1, prog.total)) * 100))}%` }} />
                    </div>
                    <p className="mt-1 truncate text-[10px] text-muted-foreground">{prog.done}/{prog.total} {prog.current ? `· ${prog.current}` : ""}</p>
                  </div>
                )}
              </div>
            );
          })}
          {!shown.length && !loadingList && <p className="pt-6 text-center text-xs text-muted-foreground">没有匹配的包</p>}
        </div>

        {/* 自定义仓库 */}
        <div className="glass mt-4 rounded-2xl p-3">
          <p className="text-[12px] font-semibold">安装自己的包</p>
          <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
            任何符合协议的公开 GitHub 仓库都能装（manifest.json + memes/分类图片）。
            分类名会自动翻译成中文标签。
          </p>
          <div className="mt-2 flex gap-2">
            <input
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              placeholder="owner/repo 或完整链接"
              className="glass-input min-w-0 flex-1 rounded-lg px-2.5 py-1.5 text-[12px] outline-none placeholder:text-muted-foreground/60"
            />
            <Button size="sm" variant="outline" disabled={!!busyId || !customInput.trim()} onClick={() => void doCustom()} className="jelly-btn h-8 shrink-0 rounded-lg text-[12px]">
              探测并安装
            </Button>
          </div>
        </div>

        {/* 分类翻译说明 */}
        <p className="mt-3 px-1 text-[10px] leading-relaxed text-muted-foreground/80">
          安装后的表情命名规则：{Object.entries({ happy: "开心", shy: "害羞" }).map(([k, v]) => `${v}·文件名`).join(" / ")}，
          TA 在聊天里看到的就是这些名字。
        </p>
      </div>

      {notice && (
        <div className="fade-up pointer-events-none absolute bottom-20 left-1/2 z-40 -translate-x-1/2 rounded-xl bg-neutral-800/90 px-4 py-2 text-center text-[11px] text-white shadow-lg">
          {notice}
        </div>
      )}

      {confirmUninstall && (
        <>
          <div className="absolute inset-0 z-40 bg-black/30" onClick={() => setConfirmUninstall(null)} aria-hidden />
          <div className="glass-strong fade-up absolute bottom-24 left-6 right-6 z-50 rounded-2xl p-4 text-center shadow-xl">
            <p className="text-[13px] font-semibold">卸载《{confirmUninstall.name}》？</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              会把从广场装的 {installedCount(confirmUninstall.id)} 张表情移出表情库，自己上传的不受影响。
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" className="jelly-btn h-9 flex-1 rounded-xl text-[12px]" onClick={() => setConfirmUninstall(null)}>
                再想想
              </Button>
              <Button size="sm" className="jelly-btn h-9 flex-1 rounded-xl bg-red-500/90 text-[12px] text-white hover:bg-red-500" onClick={() => doUninstall(confirmUninstall)}>
                卸载
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** 供其他入口提示：某个 sticker 是否来自广场（卸载确认等场景可用） */
export const isSquareSticker = (s: Sticker) => s.id.startsWith(SRC_PREFIX);
export { catLabel };
