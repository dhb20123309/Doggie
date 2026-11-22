// 虚拟手机机身：外壳 + 屏幕路由（桌面 / 设置 / AI 助手）
import { useState } from "react";
import type { AiConfig, ScreenId } from "@/lib/types";
import { StatusBar } from "./StatusBar";
import { HomeScreen } from "./HomeScreen";
import { SettingsApp } from "./SettingsApp";
import { ChatApp } from "./ChatApp";
import { RoleChatApp } from "./RoleChatApp";

interface Props {
  config: AiConfig;
  onSaveConfig: (cfg: AiConfig) => void;
}

export function PhoneShell({ config, onSaveConfig }: Props) {
  const [screen, setScreen] = useState<ScreenId>("home");
  const darkStatus = screen === "home";

  return (
    <div className="phone-frame relative rounded-[44px] p-[10px]">
      {/* 侧边按键 */}
      <span className="absolute -left-[3px] top-[90px] h-8 w-[3px] rounded-l bg-frame-edge" />
      <span className="absolute -left-[3px] top-[130px] h-12 w-[3px] rounded-l bg-frame-edge" />
      <span className="absolute -right-[3px] top-[110px] h-16 w-[3px] rounded-r bg-frame-edge" />

      <div className="screen-glare relative h-[600px] w-[300px] overflow-hidden rounded-[34px] bg-background sm:h-[640px] sm:w-[320px]">
        {/* 灵动岛 */}
        <div className="absolute left-1/2 top-2 z-30 flex h-[26px] w-[92px] -translate-x-1/2 items-center justify-end rounded-full bg-notch pr-3">
          <span className="size-2.5 rounded-full bg-[oklch(0.25_0.03_260)] ring-1 ring-white/10" />
        </div>

        <StatusBar dark={darkStatus} />

        <div key={screen} className="screen-in h-[calc(100%-34px)]">
          {screen === "home" && <HomeScreen config={config} onOpen={setScreen} />}
          {screen === "settings" && (
            <SettingsApp config={config} onSave={onSaveConfig} onBack={() => setScreen("home")} />
          )}
          {screen === "chat" && (
            <ChatApp config={config} onBack={() => setScreen("home")} onOpenSettings={() => setScreen("settings")} />
          )}
          {screen === "rolechat" && <RoleChatApp config={config} onBack={() => setScreen("home")} />}
        </div>

        {/* Home 指示条 */}
        <button
          type="button"
          onClick={() => setScreen("home")}
          aria-label="回到主屏"
          className="absolute bottom-1.5 left-1/2 z-30 h-1.5 w-[110px] -translate-x-1/2 rounded-full bg-black/25 backdrop-blur transition-colors hover:bg-black/40"
          style={{ backgroundColor: screen === "home" ? undefined : "oklch(0.4 0.02 275 / 0.4)" }}
        />
      </div>
    </div>
  );
}
