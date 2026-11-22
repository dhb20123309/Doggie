// 手机桌面：壁纸、时钟小组件、应用图标网格
import { Settings, MessageSquareText, Phone, Camera, Music, Calculator } from "lucide-react";
import type { AiConfig, ScreenId } from "@/lib/types";
import { isConfigured } from "@/lib/types";

interface Props {
  config: AiConfig;
  onOpen: (screen: ScreenId) => void;
}

const APPS = [
  { id: "settings" as ScreenId, name: "设置", icon: Settings, tint: "from-slate-500 to-slate-700" },
  { id: "chat" as ScreenId, name: "AI 助手", icon: MessageSquareText, tint: "from-violet-500 to-fuchsia-600" },
  { id: null, name: "电话", icon: Phone, tint: "from-emerald-500 to-green-600" },
  { id: null, name: "相机", icon: Camera, tint: "from-zinc-600 to-zinc-800" },
  { id: null, name: "音乐", icon: Music, tint: "from-rose-500 to-pink-600" },
  { id: null, name: "计算器", icon: Calculator, tint: "from-amber-500 to-orange-600" },
];

export function HomeScreen({ config, onOpen }: Props) {
  const ready = isConfigured(config);
  const now = new Date();
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][now.getDay()];

  return (
    <div className="wallpaper relative flex h-full flex-col px-4 pb-3">
      {/* 时钟小组件 */}
      <div className="reveal reveal-zoom mt-6 rounded-2xl bg-black/15 px-4 py-3 backdrop-blur-md">
        <p className="font-display text-4xl font-semibold tracking-tight text-white tabular-nums">
          {String(now.getHours()).padStart(2, "0")}:{String(now.getMinutes()).padStart(2, "0")}
        </p>
        <div className="mt-0.5 flex items-center justify-between text-[11px] text-white/75">
          <span>
            {now.getMonth() + 1} 月 {now.getDate()} 日 · {week}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 font-medium ${
              ready ? "bg-white/20 text-white" : "bg-black/25 text-white/80"
            }`}
          >
            {ready ? `已接入 ${config.model}` : "未接入 API"}
          </span>
        </div>
      </div>

      {/* 应用网格 */}
      <div className="mt-7 grid grid-cols-3 gap-x-4 gap-y-5">
        {APPS.map((app, i) => {
          const Icon = app.icon;
          const clickable = app.id !== null;
          return (
            <button
              key={app.name}
              type="button"
              disabled={!clickable}
              onClick={() => app.id && onOpen(app.id)}
              data-reveal-delay={String(60 * i)}
              className={`reveal group flex flex-col items-center gap-1.5 ${
                clickable ? "cursor-pointer active:scale-90" : "cursor-default opacity-70"
              } transition-transform duration-150`}
            >
              <span
                className={`flex size-[52px] items-center justify-center rounded-[15px] bg-gradient-to-br ${app.tint} shadow-lg shadow-black/25 ring-1 ring-white/20 transition-transform duration-200 group-hover:-translate-y-0.5`}
              >
                <Icon className="size-6 text-white" strokeWidth={1.8} />
              </span>
              <span className="text-[11px] font-medium text-white/90 drop-shadow">{app.name}</span>
            </button>
          );
        })}
      </div>

      {/* Dock */}
      <div className="mt-auto flex justify-center gap-5 rounded-2xl bg-black/15 px-6 py-2.5 backdrop-blur-md">
        <button type="button" onClick={() => onOpen("chat")} className="transition-transform hover:-translate-y-0.5 active:scale-90" aria-label="AI 助手">
          <MessageSquareText className="size-6 text-white drop-shadow" strokeWidth={1.8} />
        </button>
        <button type="button" onClick={() => onOpen("settings")} className="transition-transform hover:-translate-y-0.5 active:scale-90" aria-label="设置">
          <Settings className="size-6 text-white drop-shadow" strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
