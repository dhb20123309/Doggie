// Reality MCP · 手机能力页：9 项能力开关卡片（权限标签+支持态探测+试一下）+ 我创建的提醒清单
import { useEffect, useState } from "react";
import { BellRing, ChevronLeft, CircleCheck, CircleX, Clock3, Gauge, Globe2, HardDrive, MessageSquareText, Play, Radio, Share2, Sparkles, Vibrate, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { AiConfig } from "@/lib/types";
import { emitNotify } from "@/lib/notification-store";
import { loadMusicTracks } from "@/lib/media";
import { RemoteMcpPanel } from "./RemoteMcpPanel";
import { loadServers, loadToolCache, saveToolCache } from "@/lib/remote-mcp";
import {
  MCP_CARDS,
  useMcpPrefs,
  detectSupport,
  readDeviceStatus,
  fireSystemNotification,
  vibrate,
  speakToUser,
  createReminder,
  listReminders,
  removeReminder,
  readRecentAppMessages,
  usageStatsText,
  shareTrackToMusicApp,
  type McpCapabilityId,
  type McpReminder,
} from "@/lib/reality-mcp";

interface Props {
  config: AiConfig;
  onBack: () => void;
}

const ICONS: Record<McpCapabilityId, React.ComponentType<{ className?: string }>> = {
  device_status: Gauge,
  app_notifications: MessageSquareText,
  app_usage: Clock3,
  send_music: Share2,
  system_notify: BellRing,
  speak: Radio,
  vibrate: Vibrate,
  set_reminder: BellRing,
  list_reminders: Clock3,
};

export function McpApp({ config, onBack }: Props) {
  const [prefs, setPrefs] = useMcpPrefs();
  const [toast, setToast] = useState<string>("");
  const [reminders, setReminders] = useState<McpReminder[]>(listReminders);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [remoteCount, setRemoteCount] = useState(() => loadServers().length);
  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast(""), 3500);
  };
  // 每秒刷新提醒倒计时
  useEffect(() => {
    const timer = window.setInterval(() => setReminders(listReminders()), 1000);
    return () => clearInterval(timer);
  }, []);

  const toggle = (id: McpCapabilityId, v: boolean) => {
    setPrefs((p) => ({ enabled: { ...p.enabled, [id]: v } }));
    console.log(`[mcp] toggle ${id}=${v}`);
    // 开启系统通知时顺手请求权限（Android Chrome）
    if (id === "system_notify" && v) void fireSystemNotification("通知已开启", "TA 之后可以直接给你发系统通知");
  };

  const runTest = async (id: McpCapabilityId) => {
    switch (id) {
      case "device_status": {
        const lines = await readDeviceStatus();
        flash(lines.join(" / "));
        break;
      }
      case "app_notifications": {
        const msgs = readRecentAppMessages(24);
        flash(msgs.length ? `最近 24h 收到 ${msgs.length} 条：${msgs[msgs.length - 1]}` : "最近 24 小时没有消息记录");
        break;
      }
      case "app_usage":
        flash(usageStatsText().join(" / "));
        break;
      case "send_music": {
        const tracks = loadMusicTracks().filter((t) => t.url);
        if (!tracks.length) {
          flash("歌单是空的——先在设置里粘贴音乐源再试");
          break;
        }
        const t = tracks[0];
        const r = await shareTrackToMusicApp(t.url, t.title);
        flash(r.text);
        break;
      }
      case "system_notify": {
        const r = await fireSystemNotification("来自 TA 的通知", "测试一下真实系统通知能不能弹出来");
        if (!r.ok) {
          // iOS/不支持 → 内置横幅代替，让用户看到效果
          emitNotify({ charId: "", name: "Reality MCP", avatar: "✨", text: "iOS 不支持网页系统通知，这就是内置横幅的样子", tag: "降级演示" });
        }
        flash(r.ok ? "已发送系统通知（下拉通知栏查看）" : `${r.text}，已用内置横幅演示`);
        break;
      }
      case "speak": {
        const r = await speakToUser("我在呢，有什么想说的直接讲。", { baseUrl: config.baseUrl, apiKey: config.apiKey });
        flash(r.text);
        break;
      }
      case "vibrate": {
        const r = vibrate("standard");
        if (!r.ok && r.fallbackShake) window.dispatchEvent(new CustomEvent("vp-mcp:shake"));
        flash(r.text);
        break;
      }
      case "set_reminder": {
        const r = createReminder("起来活动一下", 5);
        setReminders(listReminders());
        flash(r.text);
        break;
      }
      case "list_reminders":
        setReminders(listReminders());
        break;
    }
  };

  const enabledCount = MCP_CARDS.filter((c) => prefs.enabled[c.id]).length;

  return (
    <div className="flex h-full flex-col bg-[oklch(0.97_0.02_85)]">
      {/* 顶栏 */}
      <div className="glass-nav flex items-center justify-between px-2 py-2">
        <button type="button" onClick={onBack} aria-label="返回" className="jelly-icon flex size-8 items-center justify-center rounded-full text-neutral-700">
          <ChevronLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1 px-1">
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Connection</p>
          <h1 className="truncate text-[15px] font-bold text-neutral-800">Reality MCP · 手机能力</h1>
        </div>
        <span className="mr-1 flex shrink-0 items-center gap-1 rounded-full border border-border bg-white/70 px-2 py-1 text-[10px] font-semibold text-primary">
          <Sparkles className="size-3" /> MCP
        </span>
      </div>

      <div className="flex-1 space-y-2.5 overflow-y-auto px-3 pb-6 pt-2">
        <p className="px-1 text-[10.5px] leading-relaxed text-muted-foreground">
          这里的能力全部走浏览器真实接口，TA 在聊天里可以调用（震动/播报/提醒等会留下执行记录）。已启用 {enabledCount}/{MCP_CARDS.length} 项；标注「需原生 App」的边界是网页沙箱限制，不假装可用。
        </p>

        {MCP_CARDS.map((card) => {
          const Icon = ICONS[card.id];
          const support = detectSupport(card.id);
          const on = prefs.enabled[card.id];
          return (
            <section key={card.id} className={`fade-up glass rounded-2xl p-3.5 shadow-sm transition-opacity ${on ? "" : "opacity-70"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
                  <h2 className="text-[13px] font-bold text-neutral-800">{card.title}</h2>
                </div>
                <Switch checked={on} onCheckedChange={(v) => toggle(card.id, v)} aria-label={card.title} />
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{card.desc}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span
                  className={`rounded-full px-2 py-0.5 text-[9.5px] font-semibold ${
                    card.tag === "readonly" ? "bg-emerald-500/12 text-emerald-600" : "bg-rose-500/12 text-rose-500"
                  }`}
                >
                  {card.tag === "readonly" ? "只读查询" : "会执行操作"}
                </span>
                <span className="flex min-w-0 items-center gap-1 text-[9.5px] text-muted-foreground">
                  {support.level === "full" ? <CircleCheck className="size-3 shrink-0 text-emerald-500" /> : support.level === "fallback" ? <HardDrive className="size-3 shrink-0 text-amber-500" /> : <CircleX className="size-3 shrink-0 text-rose-400" />}
                  {support.note}
                </span>
                {card.id !== "list_reminders" && (
                  <button
                    type="button"
                    disabled={!on}
                    onClick={() => void runTest(card.id)}
                    className="jelly-btn ml-auto flex shrink-0 items-center gap-1 rounded-full border border-primary/30 px-2.5 py-0.5 text-[10px] font-semibold text-primary disabled:opacity-35"
                  >
                    <Play className="size-2.5" /> 试一下
                  </button>
                )}
              </div>
            </section>
          );
        })}

        {/* 远程 MCP 导入 */}
        <section className="fade-up glass rounded-2xl p-3.5 shadow-sm">
          <div className="flex items-center gap-2">
            <Globe2 className="size-4 shrink-0 text-primary" />
            <h2 className="text-[13px] font-bold text-neutral-800">远程 MCP 服务</h2>
            <span className="ml-auto text-[10px] text-muted-foreground">{remoteCount ? `已连接 ${remoteCount} 个` : "未连接"}</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            粘贴 https 服务地址或 GitHub 仓库链接导入第三方工具。系统只读取明确约定的配置清单，绝不执行仓库代码；安装前展示域名、工具、权限与认证方式，高危调用每次都要你确认。
          </p>
          <button
            type="button"
            onClick={() => setRemoteOpen(true)}
            className="jelly-btn mt-2 flex w-full items-center justify-center gap-1 rounded-full border border-primary/30 py-1.5 text-[11px] font-semibold text-primary"
          >
            <Sparkles className="size-3" /> 导入 / 管理远程服务
          </button>
        </section>

        {/* 我创建的提醒 */}
        <section className="fade-up glass rounded-2xl p-3.5">
          <div className="flex items-center gap-2">
            <Clock3 className="size-4 text-primary" />
            <h2 className="text-[13px] font-bold text-neutral-800">我创建的提醒</h2>
            <span className="ml-auto text-[10px] text-muted-foreground">{reminders.length} 个待触发</span>
          </div>
          {reminders.length === 0 ? (
            <p className="mt-2 text-[11px] text-muted-foreground">还没有提醒。开启「设置提醒」后，让 TA「提醒我十分钟后拿快递」就会生成日历提醒。</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {reminders.map((r) => {
                const leftMs = r.at - Date.now();
                const mm = Math.max(0, Math.floor(leftMs / 60_000));
                const ss = Math.max(0, Math.floor((leftMs % 60_000) / 1000));
                return (
                  <li key={r.id} className="flex items-center gap-2 rounded-xl bg-white/50 px-2.5 py-2">
                    <BellRing className="size-3.5 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-neutral-800">{r.title}</span>
                    <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
                      {mm >= 60 ? `${Math.floor(mm / 60)}小时${mm % 60}分` : `${mm}:${String(ss).padStart(2, "0")}`}
                    </span>
                    <button type="button" aria-label="删除提醒" onClick={() => { removeReminder(r.id); setReminders(listReminders()); }} className="jelly-icon shrink-0 text-muted-foreground hover:text-destructive">
                      <X className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="px-1 pt-1 text-[9.5px] leading-relaxed text-muted-foreground">
          说明：网页运行在浏览器沙箱里，无法读取系统通知栏、其他 App 使用时长或静默写入日历——这些需要原生 App 权限。本页面把能真实做到的部分做到位，做不到的如实标注。
        </p>
      </div>

      {/* 远程 MCP 导入面板 */}
      {remoteOpen && (
        <RemoteMcpPanel
          onClose={() => setRemoteOpen(false)}
          onChanged={() => {
            setRemoteCount(loadServers().length);
            saveToolCache(loadToolCache());
          }}
        />
      )}

      {/* 测试结果浮层 */}
      {toast && (
        <div className="notify-banner absolute inset-x-3 bottom-8 z-[70] rounded-2xl border border-border/70 bg-white/95 px-3.5 py-2.5 shadow-lg backdrop-blur">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-neutral-700">{toast}</p>
            <button type="button" aria-label="关闭" onClick={() => setToast("")} className="jelly-icon shrink-0 text-muted-foreground">
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
