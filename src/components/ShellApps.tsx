// 相册 / 相机 / 记忆中枢 / 音乐：桌面壳应用（毛玻璃 UI，本地数据）
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ImagePlus, Trash2, Camera as CameraIcon, Music, Pause, Play, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePhotos, addPhoto, addPhotos, removePhoto } from "@/lib/photo-store";
import { useCharacters, useWorldBooks, useStickers } from "@/lib/chat-store";
import { loadMusicTracks } from "@/lib/media";

function ShellNav({ title, onBack, right }: { title: string; onBack: () => void; right?: React.ReactNode }) {
  return (
    <div className="glass-nav absolute left-0 right-0 top-0 z-30 flex items-center justify-between px-2 py-2">
      <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onBack} aria-label="返回">
        <ChevronLeft className="size-5" />
      </Button>
      <span className="text-sm font-semibold">{title}</span>
      {right ?? <span className="size-8" />}
    </div>
  );
}

/** 相册：展示用户上传/相机拍摄的图片 */
export function AlbumApp({ onBack }: { onBack: () => void }) {
  const [photos, setPhotos] = usePhotos();
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = (files?: FileList | null) => {
    const imgs = Array.from(files ?? []).filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    // 批量读取全部选中图片，全部完成后一次性写入相册（单张也走同一路径）
    const urls: string[] = [];
    let done = 0;
    imgs.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        urls.push(String(reader.result));
        if (++done === imgs.length) {
          setPhotos((p) => addPhotos(p, urls));
          console.log(`[album] import batch n=${urls.length}`);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  return (
    <div className="relative h-full bg-background pt-12">
      <ShellNav
        title="相册"
        onBack={onBack}
        right={
          <Button variant="ghost" size="icon" className="jelly-icon size-8 text-primary" onClick={() => fileRef.current?.click()} aria-label="导入图片">
            <ImagePlus className="size-5" />
          </Button>
        }
      />
      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
      <div className="h-full overflow-y-auto px-3 pb-6 pt-2">
        {photos.length === 0 ? (
          <p className="pt-16 text-center text-xs leading-relaxed text-muted-foreground">
            还没有照片。
            <br />
            点右上角导入，或用「相机」拍一张。
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p) => (
              <div key={p.id} className="group relative overflow-hidden rounded-xl glass p-1">
                <img src={p.url} alt="" className="aspect-square w-full rounded-lg object-cover" />
                <button
                  type="button"
                  onClick={() => setPhotos((prev) => removePhoto(prev, p.id))}
                  aria-label="删除照片"
                  className="jelly-icon absolute right-1.5 top-1.5 hidden size-6 items-center justify-center rounded-full bg-black/50 text-white group-hover:flex"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 相机：取景框 + 快门，把画面存入相册（本机模拟） */
export function CameraApp({ onBack }: { onBack: () => void }) {
  const [, setPhotos] = usePhotos();
  const [flash, setFlash] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const shoot = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    // 模拟取景：柔和渐变 + 时间水印
    const g = ctx.createLinearGradient(0, 0, c.width, c.height);
    g.addColorStop(0, "oklch(0.85 0.07 300)");
    g.addColorStop(0.5, "oklch(0.82 0.08 240)");
    g.addColorStop(1, "oklch(0.8 0.06 200)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.font = "600 26px sans-serif";
    ctx.fillText(new Date().toLocaleString("zh-CN"), 24, c.height - 32);
    setPhotos((p) => addPhoto(p, c.toDataURL("image/jpeg", 0.8)));
    setFlash(true);
    setTimeout(() => setFlash(false), 220);
  };

  return (
    <div className="relative flex h-full flex-col bg-notch pt-12">
      <ShellNav title="相机" onBack={onBack} />
      <div className="relative mx-3 mt-2 flex-1 overflow-hidden rounded-[22px] glass">
        <canvas ref={canvasRef} width={480} height={640} className="absolute inset-0 size-full object-cover opacity-90" />
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-black/30 px-3 py-1 text-[11px] text-white/90 backdrop-blur">模拟取景 · 点击快门拍照</span>
        </div>
        {flash && <span className="absolute inset-0 animate-pulse bg-white/80" />}
      </div>
      <div className="flex items-center justify-center py-5">
        <button
          type="button"
          onClick={shoot}
          aria-label="拍照"
          className="jelly-blob flex size-16 items-center justify-center rounded-full border-4 border-white/80 bg-white/25 backdrop-blur active:border-white"
        >
          <CameraIcon className="size-6 text-white" />
        </button>
      </div>
    </div>
  );
}

/** 记忆中枢：本机各类数据的统计总览 */
export function MemoryApp({ onBack }: { onBack: () => void }) {
  const [characters] = useCharacters();
  const [books] = useWorldBooks();
  const [stickers] = useStickers();
  const [photos] = usePhotos();

  let totalMsgs = 0;
  for (const c of characters) {
    try {
      const raw = localStorage.getItem(`vp-phone:rolechat-log:${c.id}`);
      totalMsgs += raw ? (JSON.parse(raw) as unknown[]).length : 0;
    } catch {
      /* ignore */
    }
  }
  const stats = [
    { label: "角色", value: `${characters.length} 位`, desc: characters.map((c) => c.name || "未命名").join("、") || "还没有角色" },
    { label: "聊天记录", value: `${totalMsgs} 条`, desc: "所有会话合计" },
    { label: "世界书设定", value: `${books.length} 条`, desc: `全局 ${books.filter((b) => b.scope === "global").length} / 局部 ${books.filter((b) => b.scope === "local").length}` },
    { label: "表情包", value: `${stickers.length} 张`, desc: `全局可用 ${stickers.filter((s) => s.isGlobal).length} 张` },
    { label: "相册", value: `${photos.length} 张`, desc: "含相机拍摄与导入" },
  ];

  return (
    <div className="relative h-full bg-background pt-12">
      <ShellNav title="记忆中枢" onBack={onBack} />
      <div className="h-full overflow-y-auto space-y-2.5 px-3 pb-6 pt-2">
        <p className="px-1 text-[11px] text-muted-foreground">这台小手机在本机记住的所有东西，刷新不丢。</p>
        {stats.map((s, i) => (
          <div key={s.label} className="glass flex items-center gap-3 rounded-[18px] px-4 py-3 fade-up" style={{ animationDelay: `${i * 60}ms` }}>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold">{s.label}</span>
              <span className="block text-[11px] text-muted-foreground">{s.desc}</span>
            </span>
            <span className="shrink-0 font-display text-sm font-bold tabular-nums text-primary">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 音乐：配置外部音源后真机播放，否则为演示界面 */
interface MusicItem {
  title: string;
  sub: string;
  url?: string;
}

export function MusicApp({ onBack }: { onBack: () => void }) {
  const items: MusicItem[] = (() => {
    const tracks = loadMusicTracks();
    if (tracks.some((t) => t.url)) return tracks.map((t) => ({ title: t.title, sub: t.artist ? `${t.artist} · 外部音源` : "外部音源", url: t.url }));
    return [
      { title: "晨间轻音乐", sub: "Pocket FM · 02:41" },
      { title: "午后雨声白噪音", sub: "Ambient Lab · 05:00" },
      { title: "深夜霓虹合成器", sub: "Retro Wave · 03:28" },
      { title: "图书馆的翻书声", sub: "Study Beats · 04:12" },
    ];
  })();
  const real = items.some((t) => t.url);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const track = items[idx];
  const total = items.length;

  // 真实音源：切换曲目 / 播放状态时驱动 <audio>
  useEffect(() => {
    if (!real) return;
    const url = items[idx]?.url;
    if (!url) return;
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.ontimeupdate = () => {
      if (audio.duration) setProgress(audio.currentTime / audio.duration);
    };
    audio.onended = () => setIdx((i) => (i + 1) % total);
    audio.onerror = () => setPlaying(false);
    if (playing) void audio.play().catch(() => setPlaying(false));
    return () => {
      audio.pause();
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [real, idx, playing]);

  // 演示模式：假进度自动切歌
  useEffect(() => {
    if (real || !playing) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % total), 12_000);
    return () => clearInterval(t);
  }, [real, playing, total]);

  return (
    <div className="relative flex h-full flex-col bg-background pt-12">
      <ShellNav title="音乐" onBack={onBack} />
      <div className="flex flex-1 flex-col items-center px-5 pb-4">
        {/* 封面 */}
        <div className={`mt-4 flex size-40 items-center justify-center rounded-[26px] bg-gradient-to-br from-rose-400/90 via-purple-400/90 to-sky-400/90 shadow-xl shadow-purple-300/40 ${playing ? "animate-[pulse_2.4s_ease-in-out_infinite]" : ""}`}>
          <Music className="size-12 text-white/90" strokeWidth={1.5} />
        </div>
        <p className="mt-4 text-base font-semibold">{track.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{real ? "外部音源 · 真机播放" : track.sub}</p>

        {/* 进度 */}
        <div className="mt-5 w-full">
          <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all duration-1000" style={{ width: playing ? `${Math.max(8, (real ? progress : (idx + 1) / total) * 100)}%` : "8%" }} />
          </div>
        </div>

        {/* 控制 */}
        <div className="mt-5 flex items-center gap-6">
          <button type="button" aria-label="上一首" className="jelly-icon text-muted-foreground hover:text-foreground" onClick={() => { setProgress(0); setIdx((i) => (i - 1 + total) % total); }}>
            <Repeat className="size-5 -scale-x-100" />
          </button>
          <button
            type="button"
            aria-label={playing ? "暂停" : "播放"}
            onClick={() => setPlaying((p) => !p)}
            className="jelly-icon flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/35"
          >
            {playing ? <Pause className="size-6" /> : <Play className="size-6 translate-x-0.5" />}
          </button>
          <button type="button" aria-label="下一首" className="jelly-icon text-muted-foreground hover:text-foreground" onClick={() => { setProgress(0); setIdx((i) => (i + 1) % total); }}>
            <Repeat className="size-5" />
          </button>
        </div>

        {/* 列表 */}
        <div className="mt-5 w-full space-y-1.5 overflow-y-auto">
          {items.map((t, i) => (
            <button
              key={i}
              type="button"
              onClick={() => { setIdx(i); setPlaying(true); }}
              className={`glass flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[12px] transition-colors ${i === idx ? "border-primary/50 text-primary" : "hover:bg-accent/40"}`}
            >
              <span className="truncate font-medium">{t.title}</span>
              <span className="ml-2 shrink-0 tabular-nums text-muted-foreground">{real ? "" : t.sub.split("· ").pop()}</span>
            </button>
          ))}
        </div>
        {!real && <p className="mt-2 text-[10px] text-muted-foreground">本地演示曲库；在「设置 → 音乐 App 音源」填入音频直链即可真机播放</p>}
      </div>
    </div>
  );
}
