// 手机内「设置」应用：填写接口地址 / API Key / 模型名，并提供连接测试
import { useEffect, useState } from "react";
import { Eye, EyeOff, LoaderCircle, CheckCircle2, XCircle, ChevronLeft, Trash2, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AiConfig, TestResult } from "@/lib/types";
import { normalizeBaseUrl } from "@/lib/types";
import { testConnection, fetchModelList } from "@/lib/ai-api";

interface Props {
  config: AiConfig;
  onSave: (cfg: AiConfig) => void;
  onBack: () => void;
}

const PROVIDERS = [
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { name: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  { name: "Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { name: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
];

export function SettingsApp({ config, onSave, onBack }: Props) {
  const [form, setForm] = useState<AiConfig>(config);
  const [showKey, setShowKey] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState("");

  // 外部配置变化时同步（例如其他入口保存后）
  useEffect(() => {
    setForm((prev) => (prev.baseUrl === config.baseUrl && prev.model === config.model ? prev : { ...config }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.baseUrl, config.model]);

  const dirty =
    form.baseUrl !== config.baseUrl || form.apiKey !== config.apiKey || form.model !== config.model;

  const save = () => {
    onSave({ ...form, baseUrl: normalizeBaseUrl(form.baseUrl) });
    setForm((f) => ({ ...f, baseUrl: normalizeBaseUrl(f.baseUrl) }));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    const cfg = { ...form, baseUrl: normalizeBaseUrl(form.baseUrl) };
    const res = await testConnection(cfg, controller.signal);
    clearTimeout(timer);
    setTesting(false);
    setResult(res);
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {/* 导航条 */}
      <div className="flex items-center justify-between border-b border-border px-2 py-2">
        <Button variant="ghost" size="icon" className="size-8" onClick={onBack} aria-label="返回">
          <ChevronLeft className="size-5" />
        </Button>
        <span className="text-sm font-semibold">设置 · API 接入</span>
        <Button
          size="sm"
          variant={saved ? "secondary" : "default"}
          className="h-8 rounded-full px-3 text-xs"
          onClick={save}
          disabled={!dirty && !saved}
        >
          {saved ? "已保存" : "保存"}
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {/* 快捷填充 */}
        <div>
          <Label className="text-xs text-muted-foreground">常用服务商（点击填充地址和模型）</Label>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {PROVIDERS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => setForm((f) => ({ ...f, baseUrl: p.baseUrl, model: p.model }))}
                className="rounded-full border border-border bg-secondary px-2.5 py-1 text-xs text-secondary-foreground transition-colors hover:border-primary hover:text-primary active:scale-95"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="baseUrl">接口地址（Base URL）</Label>
          <Input
            id="baseUrl"
            placeholder="https://api.xxx.com/v1"
            value={form.baseUrl}
            onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
            className="h-10 rounded-lg bg-muted/40 text-[13px]"
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            填服务商文档里的基础地址，到版本号为止；不要带 /chat/completions 后缀。
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="apiKey">API Key</Label>
          <div className="relative">
            <Input
              id="apiKey"
              type={showKey ? "text" : "password"}
              placeholder="sk-..."
              autoComplete="off"
              value={form.apiKey}
              onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              className="h-10 rounded-lg bg-muted/40 pr-10 text-[13px]"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={showKey ? "隐藏 Key" : "显示 Key"}
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Key 只保存在本浏览器（localStorage），不会写进代码或上传。
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="model">模型名</Label>
            <Button
              size="sm"
              variant="ghost"
              className="jelly-btn h-6 gap-1 px-2 text-[11px] text-primary"
              disabled={loadingModels}
              onClick={async () => {
                setLoadingModels(true);
                setModelError("");
                try {
                  setModels(await fetchModelList({ ...form, baseUrl: normalizeBaseUrl(form.baseUrl) }));
                } catch (e) {
                  setModels(null);
                  setModelError(e instanceof Error ? e.message : String(e));
                } finally {
                  setLoadingModels(false);
                }
              }}
            >
              {loadingModels ? <LoaderCircle className="size-3 animate-spin" /> : <ListChecks className="size-3" />}
              拉取模型列表
            </Button>
          </div>
          <Input
            id="model"
            placeholder="例如 deepseek-chat / qwen-plus"
            value={form.model}
            onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            className="h-10 rounded-lg bg-muted/40 text-[13px]"
          />
          {models && (
            <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-border bg-muted/30 p-1.5">
              {models.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, model: m }))}
                  className={`block w-full truncate rounded-md px-2 py-1 text-left text-[11px] transition-colors ${
                    form.model === m ? "bg-primary text-primary-foreground" : "hover:bg-primary/10 hover:text-primary"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
          {modelError && <p className="text-[11px] leading-relaxed text-destructive">{modelError}</p>}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="temperature">采样温度</Label>
            <span className="text-[11px] tabular-nums text-muted-foreground">{(form.temperature ?? 0.8).toFixed(1)}</span>
          </div>
          <input
            id="temperature"
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={form.temperature ?? 0.8}
            onChange={(e) => setForm((f) => ({ ...f, temperature: Number(e.target.value) }))}
            className="w-full accent-[var(--primary)]"
          />
          <p className="text-[11px] text-muted-foreground">低更稳重，高更有创意；默认 0.8。</p>
        </div>

        <Button
          variant="outline"
          className="w-full rounded-xl border-primary/40 py-5 text-sm font-semibold text-primary hover:bg-primary/5"
          onClick={runTest}
          disabled={testing}
        >
          {testing ? (
            <>
              <LoaderCircle className="mr-1.5 size-4 animate-spin" />
              正在测试连接…
            </>
          ) : (
            "连接测试"
          )}
        </Button>

        {result && <TestResultCard result={result} />}

        <div className="pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-center gap-1 text-[11px] text-muted-foreground hover:text-destructive"
            onClick={() => {
              setForm({ baseUrl: "", apiKey: "", model: "" });
              onSave({ baseUrl: "", apiKey: "", model: "" });
              setResult(null);
            }}
          >
            <Trash2 className="size-3.5" />
            清空本机保存的配置
          </Button>
        </div>
      </div>
    </div>
  );
}

function TestResultCard({ result }: { result: TestResult }) {
  const ok = result.status === "success";
  return (
    <div
      className={`screen-in rounded-xl border p-3 text-[12px] ${
        ok ? "border-success/40 bg-success/10" : "border-destructive/40 bg-destructive/10"
      }`}
    >
      <div className="flex items-center gap-1.5 font-semibold">
        {ok ? (
          <CheckCircle2 className="size-4 shrink-0 text-success" />
        ) : (
          <XCircle className="size-4 shrink-0 text-destructive" />
        )}
        <span className={ok ? "text-success" : "text-destructive"}>{result.title}</span>
      </div>
      <p className="mt-1 leading-relaxed text-foreground/80">{result.detail}</p>
      {ok && result.sampleReply && (
        <p className="mt-1.5 rounded-lg bg-background/70 px-2 py-1.5 text-[11px] text-muted-foreground">
          模型回复示例：{result.sampleReply}
        </p>
      )}
      {result.hints.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-foreground/70">
          {result.hints.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
