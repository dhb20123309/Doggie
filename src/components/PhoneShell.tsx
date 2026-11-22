// 虚拟手机机身：外壳 + 锁屏流程 + 屏幕路由（桌面 / 各 App）
import { useState } from "react";
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
import { usePasscode, useLockWallpaper, useHomeWallpaper, useChatBackground } from "@/lib/lock-store";

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

  const goHome = () => setScreen("home");
  const lock = () => {
    setScreen("home");
    setLocked(true);
  };

  return (
    <div className="phone-frame relative h-full w-full overflow-hidden rounded-none p-0 sm:h-auto sm:w-auto sm:overflow-visible sm:rounded-[48px] sm:p-[10px]">
      {/* 侧边按键 */}
      <span className="absolute -left-[3px] top-[90px] hidden h-8 w-[3px] rounded-l bg-frame-edge sm:block" />
      <span className="absolute -left-[3px] top-[130px] hidden h-12 w-[3px] rounded-l bg-frame-edge sm:block" />
      <span className="absolute -right-[3px] top-[110px] hidden h-16 w-[3px] rounded-r bg-frame-edge sm:block" />

      <div className="screen-glare relative h-full w-full overflow-hidden rounded-none bg-background sm:h-[min(720px,calc(100dvh-56px))] sm:w-[min(360px,calc(100dvw-48px))] sm:rounded-[38px]">
        {/* 灵动岛 */}
        <div className="absolute left-1/2 top-2 z-50 flex h-[26px] w-[92px] -translate-x-1/2 items-center justify-end rounded-full bg-notch pr-3">
          <span className="size-2.5 rounded-full bg-[oklch(0.25_0.03_260)] ring-1 ring-white/10" />
        </div>

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
            </div>

            {/* Home 指示条 */}
            <button
              type="button"
              onClick={goHome}
              aria-label="回到主屏"
              className="absolute bottom-1.5 left-1/2 z-50 h-1.5 w-[110px] -translate-x-1/2 rounded-full backdrop-blur transition-colors hover:bg-black/40"
              style={{ backgroundColor: screen === "home" ? "oklch(1 0 0 / 0.5)" : "oklch(0.4 0.02 275 / 0.4)" }}
            />
          </>
        )}
      </div>
    </div>
  );
}
