// 虚拟手机机身：外壳 + 锁屏流程 + 屏幕路由（桌面 / 各 App）
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { startUsageTracker } from "@/lib/reality-mcp";
import type { AiConfig, ScreenId } from "@/lib/types";
import type { ChatEntry } from "@/lib/chat-types";
import { isConfigured } from "@/lib/types";
import { StatusBar } from "./StatusBar";
import { LockScreen } from "./LockScreen";
import { HomeCarousel } from "./HomeCarousel";
import { SettingsApp } from "./SettingsApp";
import { ChatApp } from "./ChatApp";
import { RoleChatApp } from "./RoleChatApp";
import { WorldBookApp } from "./WorldBookApp";
import { StickerApp } from "./StickerApp";
import { AlbumApp, CameraApp, MemoryApp, MusicApp } from "./ShellApps";
import { DiaryApp, PhonePeekApp, BondApp, PreferenceApp, TheaterApp, ProfileApp } from "./CompanionApps";
import { DeliveryApp } from "./DeliveryApp";
import { VoiceCallApp } from "./VoiceCallApp";
import { DuelApp } from "./DuelApp";
import { McpApp } from "./McpApp";
import { usePasscode, useLockWallpaper, useHomeWallpaper, useChatBackground } from "@/lib/lock-store";
import { onNotify, onOpenChat, requestOpenChat, useNotifyOn, type NotifyPayload } from "@/lib/notification-store";
import { useAuth } from "@/features/supabase-auth-runtime";
import { AuthSheet } from "./AuthSheet";
import { CloudOnboard } from "./CloudOnboard";
import { backupNow, installDirtyTracker, isAutoBackupOn, isDirty, readLastBackupAt } from "@/lib/cloud-store";
import { handleOAuthCallback } from "@/lib/remote-mcp";

const ONBOARD_KEY = "vp-pho…d:v1";
const AUTO_GAP_MS = 30 * 60 * 1000; // 自动备份节流：距上次成功至少 30 分钟

interface Props {
  config: AiConfig;
  onSaveConfig: (cfg: AiConfig) => void;
}

/** 仅用于截图验收的 URL 参数：?vpDesk=1 直达桌面；?vpApp=rolechat 直达某 App；?vpGame=uno&vpChar=xx 双弈直达 */
const vpParams = new URLSearchParams(window.location.search);
const vpGame = vpParams.get("vpGame") || undefined;

export function PhoneShell({ config, onSaveConfig }: Props) {
  const [locked, setLocked] = useState(!vpParams.has("vpDesk"));
  const [screen, setScreen] = useState<ScreenId>(
    (vpParams.get("vpApp") as ScreenId) || "home",
  );
  const vpChar = vpParams.get("vpChar") || "";
  const [passcode] = usePasscode();
  const [lockWp, setLockWp] = useLockWallpaper();
  const [homeWp, setHomeWp] = useHomeWallpaper();
  const [chatBg, setChatBg] = useChatBackground();
  const [notifyOn, setNotifyOn] = useNotifyOn();
  const { status: authStatus } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  // 截图验收直达参数 vpOnboard=0 时跳过云备份引导弹层（仅诊断用途，不影响正常使用）
  const [onboard, setOnboard] = useState(() => !localStorage.getItem(ONBOARD_KEY) && !new URLSearchParams(window.location.search).has("vpOnboard"));
  const [oauthMsg, setOauthMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // OAuth 回调接收：URL 带 code/state（或 error）时处理一次并清理地址栏，只认本次发起的授权
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (!sp.has("code") && !sp.has("state") && !sp.has("error")) return;
    let alive = true;
    void handleOAuthCallback(window.location.search).then((r) => {
      const clean = window.location.pathname + window.location.hash.replace(/[?&].*$/, "");
      window.history.replaceState({}, "", clean);
      if (alive) {
        setOauthMsg({ ok: r.ok, text: r.message });
        console.log(`[mcp-remote] oauth callback handled ok=${r.ok}`);
        window.setTimeout(() => setOauthMsg(null), 6000);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // 云存档：安装写入脏标记监听 + 切后台/关页时按开关静默自动备份
  useEffect(() => {
    installDirtyTracker();
    let ticking = false;
    const autoBackup = () => {
      if (ticking || !isAutoBackupOn() || !isDirty()) return;
      if (Date.now() - readLastBackupAt() < AUTO_GAP_MS) return;
      ticking = true;
      void backupNow().then((r) => {
        ticking = false;
        console.log(`[cloud] auto backup ${r.ok ? "ok" : "skip"}${r.error ? ` (${r.error})` : ""}`);
      });
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") autoBackup();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", autoBackup);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", autoBackup);
    };
  }, []);

  // 登录成功后关闭登录页与引导卡
  useEffect(() => {
    if (authStatus === "authenticated") {
      setAuthOpen(false);
      setOnboard(false);
    }
  }, [authStatus]);

  // ===== 消息通知横幅：聊天页发事件 → 这里弹出 iOS 式顶部横幅，点按直达会话 =====
  const [banner, setBanner] = useState<NotifyPayload | null>(null);
  const bannerTimer = useRef<number | null>(null);
  const notifyOnRef = useRef(notifyOn);
  notifyOnRef.current = notifyOn;
  useEffect(() => {
    const offN = onNotify((p) => {
      if (!notifyOnRef.current) return;
      setBanner(p);
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
      bannerTimer.current = window.setTimeout(() => setBanner(null), 5_000);
    });
    const offO = onOpenChat((charId) => {
      if (charId) setScreen("rolechat");
    });
    return () => {
      offN();
      offO();
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
    };
  }, []);
  const dismissBanner = () => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBanner(null);
  };

  // MCP「读取使用时长」前台计时 + 「震动手持」降级：振动接口不可用时机身抖动动画
  useEffect(() => startUsageTracker(), []);

  // AI 每日自动日记：跨天首次进入（或页面存活过午夜）时，为最近聊过天的角色各生成一篇
  const dailyDiaryRef = useRef(false);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (dailyDiaryRef.current) return;
      const mod = await import("@/lib/companion-store");
      if (mod.isDailyDiaryDone()) return;
      dailyDiaryRef.current = true;
      if (!isConfigured(config)) {
        console.log("[diary] daily skip api not configured");
        return;
      }
      const { readLastEntries } = await import("@/lib/chat-store");
      const { readCallLog } = await import("@/lib/call-reply");
      // 非 hook 场景读存储：characters 走 localStorage 直读（与 useCharacters 同 key）
      const chars: { id: string; name?: string; persona?: string }[] = (() => {
        try {
          return JSON.parse(localStorage.getItem("vp-phone:characters:v2") || "[]");
        } catch {
          return [];
        }
      })();
      const entries: import("@/lib/companion-store").DiaryEntry[] = [];
      for (const ch of chars.slice(0, 6)) {
        const priv = readLastEntries(ch.id, 14).filter((e) => !e.proactive && !e.transfer);
        const calls = readCallLog(ch.id).slice(-8);
        const material = [...priv, ...calls]
          .sort((a, b) => a.at - b.at)
          .filter((e) => Date.now() - e.at < 3 * 86_400_000)
          .map((e) => `${e.role === "user" ? "我" : ch.name || "TA"}：${(e.content || "").replace(/\n/g, " ").slice(0, 60)}`)
          .join("\n");
        if (!material.trim()) {
          console.log(`[diary] daily skip no-material char=${ch.id}`);
          continue;
        }
        const entry = await mod.generateDailyDiary(config, { ch: ch as never, material });
        if (entry && alive) entries.push(entry);
      }
      if (entries.length && alive) {
        try {
          const key = "vp-phone:diaries:v1";
          const prev = JSON.parse(localStorage.getItem(key) || "[]") as import("@/lib/companion-store").DiaryEntry[];
          localStorage.setItem(key, JSON.stringify([...entries, ...prev]));
          window.dispatchEvent(new StorageEvent("storage", { key, newValue: localStorage.getItem(key) }));
          console.log(`[diary] daily wrote ${entries.length} entr(y/ies)`);
        } catch {
          /* 隐私模式忽略 */
        }
      }
      mod.markDailyDiaryDone();
    };
    const t = setTimeout(() => void run(), 6000);
    const iv = setInterval(() => void run(), 3_600_000);
    return () => {
      alive = false;
      clearTimeout(t);
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [shaking, setShaking] = useState(false);
  useEffect(() => {
    const h = () => {
      setShaking(true);
      setTimeout(() => setShaking(false), 600);
    };
    window.addEventListener("vp-mcp:shake", h);
    return () => window.removeEventListener("vp-mcp:shake", h);
  }, []);

  const goHome = () => setScreen("home");
  /** 外卖 App 下单后：订单写入待投递表（RoleChatApp 进入会话时消化成聊天卡片），并跳进该角色会话 */
  const sendOrderToChat = (charId: string, order: { kind: "delivery" | "gift"; shop: string; items: { name: string; qty: number; price: number }[]; amount: number; note?: string }) => {
    try {
      const key = "vp-phone:delivery-outbox:v1";
      const prev = JSON.parse(localStorage.getItem(key) || "[]") as { id: string; charId: string; at: number; order: typeof order }[];
      localStorage.setItem(key, JSON.stringify([...prev, { id: `o${Date.now()}`, charId, at: Date.now(), order }]));
    } catch {
      /* ignore */
    }
    if (charId) localStorage.setItem("vp-phone:active-character:v1", charId);
    console.log(`[delivery] outbox → char=${charId} ${order.kind} ¥${order.amount}`);
    setScreen("rolechat");
  };
  /** 双弈终局：把结果写进该角色会话（居中系统灰字），并切回聊天页让角色感想自然衔接 */
  const duelFinish = (charId: string, result: "win" | "lose" | "draw", gameName: string) => {
    try {
      const key = `vp-phone:rolechat-log:${charId}`;
      const prev = JSON.parse(localStorage.getItem(key) || "[]") as ChatEntry[];
      const tip: ChatEntry = { id: `d${Date.now()}`, role: "assistant", content: "", at: Date.now(), blockedTip: true };
      // 复用拒收提示的居中灰字渲染形态：文案按对局结果生成
      tip.content = result === "win" ? `「你赢了这局${gameName}」` : result === "lose" ? `「${gameName}对局结束，你输了」` : `「${gameName}对局结束，和棋」`;
      localStorage.setItem(key, JSON.stringify([...prev, tip]));
    } catch {
      /* ignore */
    }
    localStorage.setItem("vp-phone:active-character:v1", charId);
    console.log(`[duel] finish → chat char=${charId} result=${result}`);
  };
  const lock = () => {
    setScreen("home");
    setLocked(true);
  };

  return (
    <div className={`phone-frame relative h-full w-full overflow-hidden rounded-none p-0 sm:h-auto sm:w-auto sm:overflow-visible sm:rounded-[48px] sm:p-[10px] ${shaking ? "shake-x" : ""}`}>
      {/* 侧边按键 */}
      <span className="absolute -left-[3px] top-[90px] hidden h-8 w-[3px] rounded-l bg-frame-edge sm:block" />
      <span className="absolute -left-[3px] top-[130px] hidden h-12 w-[3px] rounded-l bg-frame-edge sm:block" />
      <span className="absolute -right-[3px] top-[110px] hidden h-16 w-[3px] rounded-r bg-frame-edge sm:block" />

      <div className="screen-glare relative h-full w-full overflow-hidden rounded-none bg-background sm:h-[min(720px,calc(100dvh-56px))] sm:w-[min(360px,calc(100dvw-48px))] sm:rounded-[38px]">
        {/* 灵动岛 */}
        <div className="absolute left-1/2 top-2 z-50 flex h-[26px] w-[92px] -translate-x-1/2 items-center justify-end rounded-full bg-notch pr-3">
          <span className="size-2.5 rounded-full bg-[oklch(0.25_0.03_260)] ring-1 ring-white/10" />
        </div>

        {/* 消息通知横幅：锁屏与所有 App 之上（iOS 式顶部下滑卡） */}
        {banner && (
          <div className="notify-banner absolute inset-x-2.5 top-[42px] z-[70]">
            <div className="glass-strong flex items-start gap-2.5 rounded-2xl p-3 shadow-lg">
              <button
                type="button"
                onClick={() => {
                  console.log(`[notify] open chat char=${banner.charId}`);
                  requestOpenChat(banner.charId);
                  dismissBanner();
                }}
                aria-label={`打开与${banner.name}的聊天`}
                className="jelly-icon shrink-0 text-left"
              >
                <span className="flex size-9 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-wallpaper-from to-wallpaper-to text-[16px] ring-1 ring-white/40">
                  {banner.avatar.startsWith("data:") || banner.avatar.startsWith("http") ? (
                    <img src={banner.avatar} alt="" className="size-full object-cover" />
                  ) : (
                    banner.avatar || "👤"
                  )}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  console.log(`[notify] open chat char=${banner.charId}`);
                  requestOpenChat(banner.charId);
                  dismissBanner();
                }}
                aria-label="查看消息"
                className="jelly-btn min-w-0 flex-1 text-left"
              >
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[12px] font-semibold">{banner.name}</span>
                  {banner.tag && <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-primary">{banner.tag}</span>}
                  <span className="ml-auto shrink-0 text-[9px] text-muted-foreground">现在</span>
                </span>
                <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-muted-foreground">{banner.text}</span>
              </button>
              <button
                type="button"
                onClick={dismissBanner}
                aria-label="关闭通知"
                className="jelly-icon -m-1 shrink-0 self-center p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
        )}

        {/* OAuth 授权结果横幅：回调处理完显示一次，6 秒自动消失 */}
        {oauthMsg && (
          <div className="notify-banner absolute inset-x-2.5 top-[42px] z-[71]">
            <div className={`glass-strong flex items-start gap-2 rounded-2xl p-3 shadow-lg ${oauthMsg.ok ? "" : "ring-1 ring-rose-300/60"}`}>
              <span className={`mt-0.5 size-2 shrink-0 rounded-full ${oauthMsg.ok ? "bg-emerald-500" : "bg-rose-500"}`} />
              <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-neutral-800">{oauthMsg.text}</p>
              <button type="button" aria-label="关闭" onClick={() => setOauthMsg(null)} className="jelly-icon -m-1 shrink-0 p-1 text-muted-foreground">
                <X className="size-4" />
              </button>
            </div>
          </div>
        )}

        {locked ? (
          <LockScreen passcode={passcode} wallpaper={lockWp} onUnlock={() => setLocked(false)} />
        ) : (
          <>
            <StatusBar dark={screen === "home"} />

            <div key={screen} className={`h-full pt-8 ${screen === "home" ? "" : "app-open"}`}>
              {screen === "home" && <HomeCarousel config={config} wallpaper={homeWp} onOpen={setScreen} />}
              {screen === "settings" && (
                <SettingsApp
                  config={config}
                  onSave={onSaveConfig}
                  onBack={goHome}
                  onLock={lock}
                  notify={{ on: notifyOn, setOn: setNotifyOn }}
                  onOpenMcp={() => setScreen("mcp")}
                  onOpenAuth={() => setAuthOpen(true)}
                  wallpapers={{ lockWp, homeWp, chatBg, setLockWp, setHomeWp, setChatBg }}
                />
              )}
              {screen === "chat" && (
                <ChatApp config={config} onBack={goHome} onOpenSettings={() => setScreen("settings")} />
              )}
              {screen === "rolechat" && <RoleChatApp config={config} background={chatBg} onBack={goHome} onOpenDuel={() => setScreen("duel")} />}
              {screen === "worldbook" && <WorldBookApp onBack={goHome} />}
              {screen === "sticker" && <StickerApp onBack={goHome} />}
              {screen === "album" && <AlbumApp onBack={goHome} />}
              {screen === "camera" && <CameraApp onBack={goHome} />}
              {screen === "memory" && <MemoryApp onBack={goHome} />}
              {screen === "music" && <MusicApp onBack={goHome} />}
              {screen === "diary" && <DiaryApp config={config} onBack={goHome} />}
              {screen === "phonepeek" && <PhonePeekApp config={config} onBack={goHome} />}
              {screen === "bond" && <BondApp config={config} onBack={goHome} />}
              {screen === "preference" && <PreferenceApp config={config} onBack={goHome} />}
              {screen === "theater" && <TheaterApp config={config} onBack={goHome} />}
              {screen === "profile" && (
                <ProfileApp onBack={goHome} onOpenChar={() => setScreen("rolechat")} onOpenSettings={() => setScreen("settings")} />
              )}
              {screen === "delivery" && (
                <DeliveryApp onBack={goHome} onSend={(charId, order) => sendOrderToChat(charId, order)} />
              )}
              {screen === "voicecall" && <VoiceCallApp config={config} onBack={goHome} />}
              {screen === "duel" && <DuelApp config={config} gameId={vpGame} charId={vpChar || undefined} onBack={goHome} onFinish={duelFinish} />}
              {screen === "mcp" && <McpApp config={config} onBack={goHome} />}
            </div>

            {/* Home 指示条 */}
            <button
              type="button"
              onClick={goHome}
              aria-label="回到主屏"
              className="absolute bottom-1.5 left-1/2 z-50 h-1.5 w-[110px] -translate-x-1/2 rounded-full backdrop-blur transition-colors hover:bg-black/40"
              style={{ backgroundColor: screen === "home" ? "oklch(1 0 0 / 0.5)" : "oklch(0.4 0.02 275 / 0.4)" }}
            />

            {/* 云存档开机引导：未登录且没跳过时弹一次 */}
            {onboard && authStatus === "anonymous" && (
              <CloudOnboard
                onLogin={() => setAuthOpen(true)}
                onSkip={() => {
                  localStorage.setItem(ONBOARD_KEY, "1");
                  setOnboard(false);
                }}
              />
            )}
          </>
        )}

        {/* 云账号登录/注册全屏页（盖在锁屏与桌面之上） */}
        {authOpen && <AuthSheet onDone={() => setAuthOpen(false)} onClose={() => setAuthOpen(false)} />}
      </div>
    </div>
  );
}
