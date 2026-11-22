// 首页：无介绍文案，加载即居中展示竖版虚拟手机（锁屏 → 桌面）
import { createFileRoute } from "@tanstack/react-router";
import { PhoneShell } from "@/components/PhoneShell";
import { useAiConfig } from "@/lib/config-store";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  const [config, saveConfig] = useAiConfig();

  return (
    <div className="stage-bg flex min-h-full items-center justify-center p-3 sm:p-6">
      <PhoneShell config={config} onSaveConfig={saveConfig} />
    </div>
  );
}
