// 虚拟手机机身：外壳 + 锁屏流程 + 屏幕路由（桌面 / 各 App）
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { startUsageTracker } from "@/lib/reality-mcp";
import type { AiConfig, ScreenId } from "@/lib/types";
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

/** 仅用于截图验收的 URL 参数：?vpDesk=1 直达桌面；?vpApp=rolechat 直达某 App */
const vpParams = new URLSearchParams(window.location.search);

export function PhoneShell({ config, onSaveConfig }: Props) {
  const [locked, setLocked] = useState(!vpParams.has("vpDesk"));
  const [screen, setScreen] = useState<ScreenId>(
    (vpParams.get("vpApp") as ScreenId) || "home",
  );
  const [passcode] = usePasscode();
  const [lockWp, setLockWp] = useLockWallpaper();
  const [homeWp, setHomeWp] = useHomeWallpaper();
  const [chatBg, setChatBg] = useChatBackground();
  const [notifyOn, setNotifyOn] = useNotifyOn();
  const { status: authStatus } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [onboard, setOnboard] = useState(() => !localStorage.getItem(ONBOARD_KEY));
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
              {screen === "rolechat" && <RoleChatApp config={config} background={chatBg} onBack={goHome} />}
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
              {screen === "theater" && <TheaterApp onBack={goHome} />}
              {screen === "profile" && (
                <ProfileApp onBack={goHome} onOpenChar={() => setScreen("rolechat")} onOpenSettings={() => setScreen("settings")} />
              )}
              {screen === "delivery" && (
                <DeliveryApp onBack={goHome} onSend={(charId, order) => sendOrderToChat(charId, order)} />
              )}
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
