// 手机桌面：自定义壁纸、时间日期小组件、音乐小组件、毛玻璃 App 网格、Dock
import { Settings, MessageSquare, BookText, Images, Camera, BrainCircuit, Music } from "lucide-react";
import type { AiConfig, ScreenId } from "@/lib/types";
import { isConfigured } from "@/lib/types";

interface Props {
  config: AiConfig;
  wallpaper: string;
  onOpen: (screen: ScreenId) => void;
}

const APPS: { id: ScreenId; name: string; icon: typeof Settings; tint: string }[] = [
  { id: "settings", name: "设置", icon: Settings, tint: "from-slate-400/80 to-slate-600/80" },
  { id: "rolechat", name: "短信", icon: MessageSquare, tint: "from-green-400/80 to-emerald-600/80" },
  { id: "worldbook", name: "世界书", icon: BookText, tint: "from-amber-400/80 to-orange-600/80" },
  { id: "album", name: "相册", icon: Images, tint: "from-sky-400/80 to-blue-600/80" },
  { id: "camera", name: "相机", icon: Camera, tint: "from-zinc-500/80 to-zinc-700/80" },
  { id: "memory", name: "记忆中枢", icon: BrainCircuit, tint: "from-violet-400/80 to-purple-600/80" },
  { id: "music", name: "音乐", icon: Music, tint: "from-rose-400/80 to-pink-600/80" },
];

const DOCK: ScreenId[] = ["settings", "rolechat", "worldbook", "music"];

export function HomeScreen({ config, wallpaper, onOpen }: Props) {
  const ready = isConfigured(config);
  const now = new Date();
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][now.getDay()];

  return (
    <div className="relative flex h-full flex-col px-4 pb-3" style={{ backgroundImage: `url(${wallpaper})`, backgroundSize: "cover", backgroundPosition: "center" }}>
      {/* 时间日期小组件 */}
      <div className="desk-in glass mt-9 rounded-[22px] px-4 py-3">
        <p className="font-display text-4xl font-semibold tracking-tight text-white tabular-nums drop-shadow-sm">
          {String(now.getHours()).padStart(2, "0")}:{String(now.getMinutes()).padStart(2, "0")}
        </p>
        <div className="mt-0.5 flex items-center justify-between text-[11px] text-white/85">
          <span>
            {now.getMonth() + 1} 月 {now.getDate()} 日 · {week}
          </span>
          <span className={`rounded-full px-2 py-0.5 font-medium ${ready ? "bg-white/30 text-white" : "bg-black/15 text-white/85"}`}>
            {ready ? `已接入 ${config.model}` : "未接入 API"}
          </span>
        </div>
      </div>

      {/* 音乐小组件 */}
      <button type="button" onClick={() => onOpen("music")} className="desk-in glass mt-3 flex items-center gap-3 rounded-[22px] px-3.5 py-2.5 text-left" data-reveal-delay="80">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rose-400 to-purple-500 shadow-inner">
          <Music className="size-5 text-white/95" strokeWidth={1.8} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-semibold text-white">晨间轻音乐</span>
          <span className="mt-1 block h-1 overflow-hidden rounded-full bg-white/25">
            <span className="block h-full w-1/3 rounded-full bg-white/85" />
          </span>
        </span>
        <span className="text-[10px] text-white/70">本地曲库</span>
      </button>

      {/* App 网格 */}
      <div className="mt-6 grid grid-cols-4 gap-x-3 gap-y-4">
        {APPS.map((app, i) => {
          const Icon = app.icon;
          return (
            <button
              key={app.id}
              type="button"
              onClick={() => onOpen(app.id)}
              className="group flex flex-col items-center gap-1"
            >
              <span
                className={`jelly-icon flex size-[52px] items-center justify-center rounded-[16px] bg-gradient-to-br ${app.tint} app-icon-glass transition-transform duration-200 group-hover:-translate-y-0.5`}
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <Icon className="size-6 text-white" strokeWidth={1.8} />
              </span>
              <span className="max-w-full truncate text-[10px] font-medium text-white drop-shadow">{app.name}</span>
            </button>
          );
        })}
      </div>

      {/* Dock */}
      <div className="glass-strong desk-in mx-1 mt-auto flex justify-around rounded-[24px] px-3 py-2.5">
        {DOCK.map((id) => {
          const app = APPS.find((a) => a.id === id)!;
          const Icon = app.icon;
          return (
            <button key={id} type="button" onClick={() => onOpen(id)} aria-label={app.name} className="jelly-icon rounded-[14px] p-2.5">
              <span className={`flex size-9 items-center justify-center rounded-[12px] bg-gradient-to-br ${app.tint}`}>
                <Icon className="size-5 text-white" strokeWidth={1.8} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
