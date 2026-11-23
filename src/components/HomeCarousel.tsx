// Companion OS 主屏：双屏横向轮播（屏1 陪伴主屏 / 屏2 生活 Bento）+ 常驻玻璃 Dock
import { useEffect, useRef, useState } from "react";
import { Calendar, Images, MessageSquare, Settings, Play, Pause, RotateCcw, Timer, CloudSun, Pencil, UtensilsCrossed } from "lucide-react";
import type { AiConfig, ScreenId } from "@/lib/types";
import { useCharacters, unreadCount, useReadMarks } from "@/lib/chat-store";
import { loadMusicTracks } from "@/lib/media";
import { ICON_URLS, AVATAR_BG, useDiaries, useMemo, useBond, useProfile, HEART_LINES, seedDiaries } from "@/lib/companion-store";

interface Props {
  config: AiConfig;
  wallpaper: string;
  onOpen: (screen: ScreenId) => void;
}

const APPS: { key: keyof typeof ICON_URLS; label: string; screen: ScreenId }[] = [
  { key: "theater", label: "小剧场", screen: "theater" },
  { key: "phone", label: "查手机", screen: "phonepeek" },
  { key: "bond", label: "心动羁绊", screen: "bond" },
  { key: "worldbook", label: "世界书", screen: "worldbook" },
  { key: "memory", label: "偏好记忆", screen: "preference" },
];
/** 外卖 App 无抠图素材，用渐变底 + lucide 图标单独渲染，追加在网格末位 */
const EXTRA_APP = { label: "饿了么恋人", screen: "delivery" as ScreenId };

export function HomeCarousel({ config, wallpaper, onOpen }: Props) {
  const [page, setPage] = useState(0);
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; y: number; on: boolean; t: number } | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const down = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, on: false, t: Date.now() };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (!d.on && Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) {
      d.on = true;
      trackRef.current?.setPointerCapture(e.pointerId);
    }
    if (d.on) setDx(Math.max(-140, Math.min(140, mx))); // 边缘阻尼
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !d.on) {
      setDx(0);
      return;
    }
    const speed = Math.abs(dx) / Math.max(1, Date.now() - d.t);
    if (dx < -60 || (dx < -24 && speed > 0.5)) setPage((p) => Math.min(1, p + 1));
    else if (dx > 60 || (dx > 24 && speed > 0.5)) setPage((p) => Math.max(0, p - 1));
    setDx(0);
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[oklch(0.95_0.03_85)]" style={{ backgroundImage: `url(${wallpaper})`, backgroundSize: "cover", backgroundPosition: "center" }}>
      <div
        ref={trackRef}
        className="flex h-full touch-pan-y"
        style={{ transform: `translateX(calc(${-page * 100}% + ${dx}px))`, transition: drag.current?.on ? "none" : "transform .35s cubic-bezier(.22,.9,.36,1)" }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        <Screen1 onOpen={onOpen} />
        <Screen2 />
      </div>

      {/* 分页指示点 */}
      <div className="pointer-events-auto absolute bottom-[86px] left-1/2 z-40 flex -translate-x-1/2 items-center gap-1.5">
        {[0, 1].map((i) => (
          <button
            key={i}
            type="button"
            aria-label={`第${i + 1}屏`}
            onClick={() => setPage(i)}
            className={`jelly-icon h-1.5 rounded-full transition-all duration-300 ${page === i ? "w-4 bg-[oklch(0.45_0.06_80)]" : "w-1.5 bg-[oklch(0.45_0.06_80/0.3)]"}`}
          />
        ))}
      </div>

      <Dock onOpen={onOpen} />
    </div>
  );
}

/* ---------- 屏1：陪伴主屏 ---------- */
function Screen1({ onOpen }: { onOpen: (s: ScreenId) => void }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const [characters] = useCharacters();
  const [profile] = useProfile();
  const [diaries] = useDiaries();
  const activeId = localStorage.getItem("vp-phone:active-character:v1") || "";
  const ch = characters.find((c) => c.id === activeId) ?? characters[0];
  const latest = diaries[0] ?? seedDiaries(ch?.id ?? "")[0];
  const hour = now.getHours();
  const greet = hour < 5 ? "凌晨好" : hour < 11 ? "早上好" : hour < 17 ? "下午好" : "晚上好";
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][now.getDay()];

  return (
    <section className="flex h-full w-full shrink-0 flex-col px-4 pb-28">
      {/* 时钟 + 日期胶囊 */}
      <div className="mt-10 text-center">
        <p className="text-[56px] font-extralight leading-none tracking-tight text-[oklch(0.34_0.04_80)] tabular-nums [text-shadow:0_2px_10px_oklch(1_0_0/0.6)]">
          {String(now.getHours()).padStart(2, "0")}:{String(now.getMinutes()).padStart(2, "0")}
        </p>
        <div className="glass mx-auto mt-3 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] text-[oklch(0.4_0.04_80)]">
          <Calendar className="size-3.5 text-primary" />
          {now.getMonth() + 1}月{now.getDate()}日 {week} · {greet}，{profile.nickname || "Dreaming"}
        </div>
      </div>

      {/* 头像底座 */}
      <button type="button" onClick={() => onOpen("profile")} className="jelly-btn relative mx-auto mt-6 block w-full max-w-[240px] overflow-hidden rounded-[28px] border border-white/80 shadow-[0_4px_20px_rgba(180,150,90,0.12)]">
        <span className="absolute inset-0 bg-gradient-to-br from-[oklch(0.97_0.025_85)] via-[oklch(0.95_0.035_78)] to-[oklch(0.93_0.045_70)]" />
        <span className="relative flex items-center justify-center py-7">
          <span className="flex size-[110px] items-center justify-center overflow-hidden rounded-full border-4 border-white bg-gradient-to-br from-[oklch(0.95_0.04_85)] to-[oklch(0.88_0.06_75)] shadow-[0_6px_18px_-6px_rgba(180,150,90,0.4)]">
            {ch?.avatar?.startsWith("data:") || ch?.avatar?.startsWith("http") ? (
              <img src={ch.avatar} alt="" className="size-full object-cover" />
            ) : (
              <span className="text-[46px] leading-none">{ch?.avatar || "💛"}</span>
            )}
          </span>
        </span>
      </button>

      {/* 日记预览条 */}
      <button type="button" onClick={() => onOpen("diary")} className="jelly-btn glass mt-5 flex w-full items-center gap-2.5 rounded-full px-3.5 py-2.5 text-left">
        <img src={ICON_URLS.diary} alt="" className="size-6 shrink-0 object-contain" />
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-[oklch(0.38_0.04_80)]">
          {ch?.name ?? "TA"}的新日记：{latest?.title ?? "等待第一篇随笔…"}
        </span>
        <span className="text-[10px] text-muted-foreground">›</span>
      </button>

      {/* 音乐胶囊 */}
      <MusicPill onOpen={onOpen} />

      {/* 6 App 网格（5 图标素材 + 外卖） */}
      <div className="mt-auto grid grid-cols-5 gap-2 pt-4">
        {APPS.map((app, i) => (
          <button key={app.key} type="button" onClick={() => onOpen(app.screen)} className="group flex flex-col items-center gap-1">
            <span
              className={`jelly-icon relative flex size-[56px] items-center justify-center rounded-[18px] border border-white/80 bg-white/60 shadow-[0_4px_14px_-4px_rgba(180,150,90,0.25)] transition-transform duration-200 group-hover:-translate-y-0.5 ${app.key === "bond" ? "group-hover:before:absolute group-hover:before:-top-1 group-hover:before:right-0 group-hover:before:size-2 group-hover:before:animate-pulse group-hover:before:rounded-full group-hover:before:bg-pink-300/80" : ""}`}
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <img src={ICON_URLS[app.key]} alt="" className="size-9 object-contain" />
            </span>
            <span className="max-w-full truncate text-[10px] font-medium text-[oklch(0.38_0.04_80)] [text-shadow:0_1px_4px_oklch(1_0_0/0.65)]">{app.label}</span>
          </button>
        ))}
        <button type="button" onClick={() => onOpen(EXTRA_APP.screen)} className="group flex flex-col items-center gap-1">
          <span className="jelly-icon relative flex size-[56px] items-center justify-center rounded-[18px] border border-white/80 bg-gradient-to-br from-[#f7b267] to-[#e56b6f] shadow-[0_4px_14px_-4px_rgba(220,120,90,0.45)] transition-transform duration-200 group-hover:-translate-y-0.5">
            <UtensilsCrossed className="size-7 text-white" />
          </span>
          <span className="max-w-full truncate text-[10px] font-medium text-[oklch(0.38_0.04_80)] [text-shadow:0_1px_4px_oklch(1_0_0/0.65)]">{EXTRA_APP.label}</span>
        </button>
      </div>
    </section>
  );
}

function MusicPill({ onOpen }: { onOpen: (s: ScreenId) => void }) {
  const [playing, setPlaying] = useState(false);
  const track = loadMusicTracks()[0];
  const real = Boolean(track?.url);
  return (
    <div className="glass mt-3 flex w-full items-center gap-3 rounded-full py-2 pl-2.5 pr-3">
      <button type="button" aria-label="播放/暂停" onClick={() => setPlaying((p) => !p)} className="jelly-icon shrink-0">
        <span className={`relative flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-[oklch(0.32_0.02_60)] to-[oklch(0.18_0.02_60)] ${playing ? "animate-spin [animation-duration:4s]" : ""}`}>
          <span className="size-2 rounded-full bg-[oklch(0.92_0.03_85)]" />
        </span>
      </button>
      <button type="button" onClick={() => onOpen("music")} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[12px] font-semibold text-[oklch(0.36_0.045_80)]">{track?.title || "暂无曲目"}</span>
        <span className="block truncate text-[10px] text-muted-foreground">{real ? "轻触进入音乐 App 真机播放" : "演示曲目 · 去设置填音源"}</span>
      </button>
      <button type="button" aria-label={playing ? "暂停" : "播放"} onClick={() => setPlaying((p) => !p)} className="jelly-icon flex size-7 items-center justify-center rounded-full bg-white/70 text-[oklch(0.4_0.05_80)]">
        {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </button>
    </div>
  );
}

/* ---------- 屏2：生活 Bento ---------- */
function Screen2() {
  const [memo, setMemo] = useMemo();
  const [characters] = useCharacters();
  const activeId = localStorage.getItem("vp-phone:active-character:v1") || "";
  const ch = characters.find((c) => c.id === activeId) ?? characters[0];
  const heartLine = useRef(
    (() => {
      const pool = HEART_LINES[ch?.id ?? ""] ?? ["“今天的风是奶茶味的。”—— 寄自 TA"];
      return pool[Math.floor(Math.random() * pool.length)];
    })()
  );

  return (
    <section className="flex h-full w-full shrink-0 flex-col gap-3 px-4 pb-28 pt-11">
      <div className="grid grid-cols-2 gap-3">
        <PomodoroCard nickname={ch?.name ?? "TA"} />
        <WeatherCard />
      </div>

      {/* 随写便签 */}
      <div className="glass relative rounded-3xl px-4 pb-2.5 pt-5 shadow-[0_4px_20px_rgba(180,150,90,0.10)]">
        <span className="absolute -top-2 left-1/2 h-5 w-20 -translate-x-1/2 rotate-[-2deg] rounded-sm bg-[oklch(0.9_0.02_80/0.7)] shadow-sm backdrop-blur-sm" />
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[oklch(0.38_0.04_80)]">
          <Pencil className="size-3.5 text-primary" /> 随写便签
          <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-normal text-primary">自动保存</span>
        </div>
        <textarea
          rows={4}
          value={memo}
          maxLength={2000}
          onChange={(e) => setMemo(e.target.value.slice(0, 2000))}
          placeholder="随手记点什么…"
          className="mt-1.5 w-full resize-none bg-transparent text-[12px] leading-relaxed text-[oklch(0.36_0.04_80)] outline-none placeholder:text-muted-foreground/60"
        />
        <p className="text-right text-[9.5px] text-muted-foreground">{memo.length}/2000</p>
      </div>

      {/* 心事短句 */}
      <div className="glass rounded-3xl px-4 py-3.5 shadow-[0_4px_20px_rgba(180,150,90,0.10)]">
        <p className="border-l-2 border-primary/40 pl-3 text-[12px] italic leading-relaxed text-[oklch(0.4_0.04_80)]">{heartLine.current}</p>
      </div>
    </section>
  );
}

const DURATIONS = [25, 15, 45];

function PomodoroCard({ nickname }: { nickname: string }) {
  const [idx, setIdx] = useState(0);
  const [left, setLeft] = useState(DURATIONS[0] * 60);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const total = DURATIONS[idx] * 60;

  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => {
      setLeft((s) => {
        if (s <= 1) {
          setRunning(false);
          setDone(true);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [running]);

  const reset = (nextIdx = idx) => {
    setIdx(nextIdx);
    setLeft(DURATIONS[nextIdx] * 60);
    setRunning(false);
    setDone(false);
  };

  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");

  return (
    <div className="glass flex h-[126px] flex-col rounded-3xl px-3 py-2.5 shadow-[0_4px_20px_rgba(180,150,90,0.10)]">
      <div className="flex items-center gap-1 text-[10.5px] font-semibold text-[oklch(0.38_0.04_80)]">
        <Timer className="size-3.5 text-primary" /> 专注计时
        <button type="button" onClick={() => reset((idx + 1) % DURATIONS.length)} className="jelly-icon ml-auto rounded-full bg-primary/12 px-2 py-0.5 text-[9.5px] font-medium text-primary">
          {DURATIONS[idx]}m
        </button>
      </div>
      <p className="mt-1 text-[26px] font-light leading-none tracking-tight text-[oklch(0.34_0.04_80)] tabular-nums">
        {done ? "完成 ✓" : `${mm}:${ss}`}
      </p>
      <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-primary/15">
        <span className="block h-full rounded-full bg-primary/70 transition-[width] duration-1000" style={{ width: `${(left / total) * 100}%` }} />
      </span>
      <div className="mt-auto flex items-center justify-between pt-1.5">
        <span className="flex items-center gap-1 text-[9.5px] text-muted-foreground">
          {running && <span className="size-1.5 animate-pulse rounded-full bg-green-500" />}
          {nickname}陪读中
        </span>
        <span className="flex items-center gap-1.5">
          <button type="button" aria-label="重置" onClick={() => reset()} className="jelly-icon text-muted-foreground hover:text-foreground">
            <RotateCcw className="size-3.5" />
          </button>
          <button type="button" aria-label={running ? "暂停" : "开始"} onClick={() => { setDone(false); setRunning((r) => !r); }} className="jelly-icon flex size-6 items-center justify-center rounded-full bg-[oklch(0.28_0.02_60)] text-white">
            {running ? <Pause className="size-3" /> : <Play className="size-3" />}
          </button>
        </span>
      </div>
    </div>
  );
}

function WeatherCard() {
  const hour = new Date().getHours();
  const temp = hour < 6 ? "17°" : hour < 12 ? "20°" : hour < 18 ? "22°" : "18°";
  const feel = hour < 12 ? "清晨微凉，加件针织衫" : hour < 18 ? "体感舒适，适合出门" : "夜里转凉，外套别脱";
  return (
    <div className="glass flex h-[126px] flex-col rounded-3xl px-3 py-2.5 shadow-[0_4px_20px_rgba(180,150,90,0.10)]">
      <div className="flex items-center gap-1 text-[10.5px] font-semibold text-[oklch(0.38_0.04_80)]">
        <CloudSun className="size-3.5 text-primary" /> 今日天色
        <span className="ml-auto rounded-full bg-primary/12 px-2 py-0.5 text-[9.5px] font-medium text-primary">晴朗 · 优</span>
      </div>
      <p className="mt-1 text-[26px] font-light leading-none text-[oklch(0.34_0.04_80)]">{temp}</p>
      <p className="mt-1 text-[10px] text-muted-foreground">微风 2 级 · {feel}</p>
      <p className="mt-auto text-[9.5px] text-muted-foreground/80">日落 18:32 · 暮色将至</p>
    </div>
  );
}

/* ---------- 常驻 Dock ---------- */
function Dock({ onOpen }: { onOpen: (s: ScreenId) => void }) {
  const [characters] = useCharacters();
  const [marks] = useReadMarks();
  const unread = characters.reduce((n, c) => n + unreadCount(c.id, marks), 0);
  const btn = "jelly-icon flex w-16 flex-col items-center gap-0.5";
  const box = "relative flex size-9 items-center justify-center rounded-[13px] border border-white/80 bg-white/70 text-[oklch(0.42_0.05_80)] shadow-[0_3px_10px_-3px_rgba(180,150,90,0.3)]";
  return (
    <div className="glass-strong absolute bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-8 rounded-full px-6 py-2 shadow-[0_8px_28px_-8px_rgba(180,150,90,0.35)]">
      <button type="button" className={btn} onClick={() => onOpen("album")}>
        <span className={box}><Images className="size-[18px]" /></span>
        <span className="text-[10px] text-[oklch(0.4_0.04_80)]">相册</span>
      </button>
      <button type="button" className={btn} onClick={() => onOpen("rolechat")}>
        <span className={box}>
          <MessageSquare className="size-[18px]" />
          {unread > 0 && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-red-500 ring-2 ring-white/80" />}
        </span>
        <span className="text-[10px] text-[oklch(0.4_0.04_80)]">消息</span>
      </button>
      <button type="button" className={btn} onClick={() => onOpen("settings")}>
        <span className={box}><Settings className="size-[18px]" /></span>
        <span className="text-[10px] text-[oklch(0.4_0.04_80)]">设置</span>
      </button>
    </div>
  );
}
