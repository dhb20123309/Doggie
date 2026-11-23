// 首页：无介绍文案，加载即居中展示竖版虚拟手机（锁屏 → 桌面）
import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PhoneShell } from "@/components/PhoneShell";
import { useAiConfig } from "@/lib/config-store";
import { isRealDevice, useAppViewportHeight } from "@/lib/real-device";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  const [config, saveConfig] = useAiConfig();
  // 真机沉浸模式：--app-vh 跟随可视视口；html.real-device 供 CSS/PhoneShell 判定隐藏假系统 UI
  useAppViewportHeight();
  useEffect(() => {
    if (isRealDevice()) {
      document.documentElement.classList.add("real-device");
      console.log("[viewport] real device → immersive mode (fake status bar hidden)");
    }
  }, []);

  return (
    <div className="stage-bg flex h-full items-center justify-center sm:p-6">
      <PhoneShell config={config} onSaveConfig={saveConfig} />
    </div>
  );
}
