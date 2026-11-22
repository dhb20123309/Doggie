// 首页：舞台背景 + 虚拟手机 + 侧边说明（移动端自动堆叠）
import { createFileRoute } from "@tanstack/react-router";
import { PhoneShell } from "@/components/PhoneShell";
import { useAiConfig } from "@/lib/config-store";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  const [config, saveConfig] = useAiConfig();

  return (
    <div className="stage-bg flex min-h-full flex-col items-center justify-center px-4 py-8 lg:flex-row lg:gap-16">
      {/* 左侧文案 */}
      <aside className="mb-8 max-w-md text-center lg:mb-0 lg:text-left">
        <p className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-white/50">
          Virtual Pocket Phone
        </p>
        <h1 className="reveal mt-3 font-display text-4xl font-bold leading-tight text-white sm:text-5xl">
          你的浏览器里
          <br />
          住着一台小手机
        </h1>
        <p className="reveal mt-4 text-sm leading-relaxed text-white/70" data-reveal-delay="120">
          点开屏幕上的「设置」，填入服务商的接口地址、API Key 和模型名，按下“连接测试”——
          成功后这台小手机里的 AI 助手就真正活了过来。
        </p>
        <ul className="reveal mt-5 space-y-2 text-left text-[13px] text-white/60" data-reveal-delay="240">
          <li className="flex gap-2">
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
            Key 只存在你当前浏览器的本地存储，代码与日志中不会出现真实密钥。
          </li>
          <li className="flex gap-2">
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
            兼容 OpenAI 格式：DeepSeek、通义千问、Kimi、智谱等均可直接接入。
          </li>
          <li className="flex gap-2">
            <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
            若测试报 CORS 错误，说明该服务商暂不支持浏览器直连，需换网关或代理。
          </li>
        </ul>
      </aside>

      {/* 手机 */}
      <main className="reveal reveal-zoom shrink-0">
        <PhoneShell config={config} onSaveConfig={saveConfig} />
      </main>
    </div>
  );
}
