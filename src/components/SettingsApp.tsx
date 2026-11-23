// 手机内「设置」应用：接口地址 / API Key / 模型名 / 连接测试 + 锁屏密码与壁纸自定义
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, LoaderCircle, CheckCircle2, XCircle, ChevronLeft, Trash2, ListChecks, ImageUp, LockKeyhole, X, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { AiConfig, TestResult } from "@/lib/types";
import { normalizeBaseUrl } from "@/lib/types";
import { testConnection, fetchModelList } from "@/lib/ai-api";
import { usePasscode, DEFAULT_PASSCODE } from "@/lib/lock-store";
import { loadVoiceConfig, saveVoiceConfig, testVoiceChannel, fetchMiniMaxVoices, MINIMAX_VOICES, type VoiceConfig } from "@/lib/tts";
import { loadMusicTracks, saveMusicTracks, parseMusicSource, loadImageConfig, saveImageConfig, DEFAULT_IMAGE_CONFIG, GPT_IMAGE_MODELS, type ImageConfig } from "@/lib/media";

interface Props {
  config: AiConfig;
  onSave: (cfg: AiConfig) => void;
  onBack: () => void;
  onLock: () => void;
  notify: { on: boolean; setOn: (v: boolean | ((p: boolean) => boolean)) => void };
  wallpapers: {
    lockWp: string;
    homeWp: string;
    chatBg: string;
    setLockWp: (v: string | ((p: string) => string)) => void;
    setHomeWp: (v: string | ((p: string) => string)) => void;
    setChatBg: (v: string | ((p: string) => string)) => void;
  };
}

const PROVIDERS = [
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { name: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  { name: "Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { name: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
];

export function SettingsApp({ config, onSave, onBack, onLock, notify, wallpapers }: Props) {
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
      <div className="glass-nav flex items-center justify-between px-2 py-2">
        <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onBack} aria-label="返回">
          <ChevronLeft className="size-5" />
        </Button>
        <span className="text-sm font-semibold">设置</span>
        <Button
          size="sm"
          variant={saved ? "secondary" : "default"}
          className="jelly-btn h-8 rounded-full px-3 text-xs"
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
                className="jelly-btn rounded-full glass px-2.5 py-1 text-xs text-secondary-foreground hover:text-primary"
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
            className="h-10 rounded-xl glass-input text-[13px]"
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
              className="h-10 rounded-xl glass-input pr-10 text-[13px]"
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
            className="h-10 rounded-xl glass-input text-[13px]"
          />
          {models && (
            <div className="max-h-32 space-y-1 overflow-y-auto rounded-xl glass p-1.5">
              {models.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, model: m }))}
                  className={`block w-full truncate rounded-lg px-2 py-1 text-left text-[11px] transition-colors ${
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
          className="jelly-blob w-full rounded-2xl border-primary/40 py-5 text-sm font-semibold text-primary hover:bg-primary/5"
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

        <PasscodeSection onLock={onLock} />
        <NotificationSection notify={notify} />
        <WallpaperSection wallpapers={wallpapers} />
        <ImageSection />
        <VoiceSection config={config} />
        <MusicSourceSection />

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

/** 锁屏密码修改区：验证旧密码后设置 4-6 位新数字密码 */
function PasscodeSection({ onLock }: { onLock: () => void }) {
  const [passcode, setPasscode] = usePasscode();
  const [oldVal, setOldVal] = useState("");
  const [newVal, setNewVal] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = () => {
    if (oldVal !== passcode) {
      setMsg({ ok: false, text: "旧密码不正确" });
      return;
    }
    if (!/^\d{4,6}$/.test(newVal)) {
      setMsg({ ok: false, text: "新密码需为 4-6 位数字" });
      return;
    }
    setPasscode(newVal);
    setOldVal("");
    setNewVal("");
    setMsg({ ok: true, text: "已更新，下次锁屏生效" });
  };

  return (
    <div className="glass space-y-2.5 rounded-2xl p-3.5">
      <div className="flex items-center gap-1.5 text-[13px] font-semibold">
        <LockKeyhole className="size-4 text-primary" />
        锁屏密码
        <span className="ml-auto text-[10px] font-normal text-muted-foreground">初始 {DEFAULT_PASSCODE}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input inputMode="numeric" placeholder="旧密码" value={oldVal} onChange={(e) => setOldVal(e.target.value.replace(/\D/g, ""))} className="h-9 rounded-lg glass-input text-[12px]" />
        <Input inputMode="numeric" placeholder="新密码 4-6 位" value={newVal} onChange={(e) => setNewVal(e.target.value.replace(/\D/g, "").slice(0, 6))} className="h-9 rounded-lg glass-input text-[12px]" />
      </div>
      {msg && (
        <p className={`text-[11px] ${msg.ok ? "text-success" : "text-destructive"}`}>{msg.text}</p>
      )}
      <div className="flex gap-2">
        <Button size="sm" className="jelly-btn h-8 flex-1 rounded-xl text-xs" onClick={submit}>
          修改密码
        </Button>
        <Button size="sm" variant="outline" className="jelly-btn h-8 flex-1 rounded-xl text-xs" onClick={onLock}>
          立即锁屏
        </Button>
      </div>
    </div>
  );
}

/** 消息通知：角色来消息时屏幕顶部弹横幅，点按直达会话 */
function NotificationSection({ notify }: { notify: Props["notify"] }) {
  return (
    <div className="glass space-y-2.5 rounded-2xl p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold">
          <BellRing className="size-4 text-primary" />
          消息通知
        </div>
        <Switch checked={notify.on} onCheckedChange={(v) => notify.setOn(v)} aria-label="消息通知" />
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        开启后，TA 发来回复或主动消息时屏幕顶部会弹出横幅（正在看该会话时不打扰）；点横幅直接进入聊天。关闭则完全静默。
      </p>
    </div>
  );
}

/** 锁屏 / 桌面 / 聊天背景上传替换 */
function WallpaperSection({ wallpapers }: { wallpapers: Props["wallpapers"] }) {
  return (
    <div className="glass grid grid-cols-3 gap-3 rounded-2xl p-3.5">
      <WallpaperPicker label="锁屏背景" value={wallpapers.lockWp} onChange={wallpapers.setLockWp} />
      <WallpaperPicker label="桌面背景" value={wallpapers.homeWp} onChange={wallpapers.setHomeWp} />
      <WallpaperPicker label="聊天背景" value={wallpapers.chatBg} onChange={wallpapers.setChatBg} />
    </div>
  );
}

function WallpaperPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string | ((p: string) => string)) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = (file?: File) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => onChange(String(reader.result));
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="jelly-icon group relative block aspect-[9/14] w-full overflow-hidden rounded-xl ring-1 ring-white/50"
        style={{ backgroundImage: `url(${value})`, backgroundSize: "cover", backgroundPosition: "center" }}
        aria-label={`更换${label}`}
      >
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-all group-hover:bg-black/35 group-hover:opacity-100">
          <ImageUp className="size-5" />
        </span>
      </button>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}

/** 独立生图通道：不影响聊天 API 地址。可选免费网关（Pollinations，免 Key）或自备 OpenAI 兼容图像网关 */
function ImageSection() {
  const [form, setForm] = useState<ImageConfig>(() => loadImageConfig());
  const [savedMsg, setSavedMsg] = useState(false);

  const save = () => {
    saveImageConfig(form);
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 1500);
  };

  return (
    <div className="glass space-y-2.5 rounded-2xl p-3.5">
      <p className="text-[13px] font-semibold">角色生图通道</p>
      <div className="flex gap-2">
        {(
          [
            { k: "openai", label: "OpenAI 兼容" },
            { k: "pollinations", label: "免费网关（推荐）" },
          ] as const
        ).map((o) => (
          <button
            key={o.k}
            type="button"
            onClick={() => setForm((f) => ({ ...f, mode: o.k }))}
            className={`jelly-btn h-8 flex-1 rounded-xl text-xs ${
              form.mode === o.k ? "bg-primary text-primary-foreground" : "glass-input text-muted-foreground"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {form.mode === "openai" ? (
        <>
          <Input placeholder="图像接口地址（留空=复用聊天接口）" value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} className="h-9 rounded-lg glass-input text-[12px]" />
          <Input type="password" placeholder="图像 Key（留空=复用聊天 Key）" autoComplete="off" value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} className="h-9 rounded-lg glass-input text-[12px]" />
        </>
      ) : (
        <p className="rounded-lg bg-white/40 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
          使用 Pollinations 免费生图网关，无需注册、无需 Key，直接点保存即可启用。
        </p>
      )}
      <Input
        placeholder={form.mode === "pollinations" ? "模型名（选填，如 flux / turbo）" : "图像模型名（默认 gpt-image-2）"}
        value={form.model}
        onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
        className="h-9 rounded-lg glass-input text-[12px]"
      />
      {form.mode === "openai" && (
        <div className="flex flex-wrap gap-1.5">
          {GPT_IMAGE_MODELS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setForm((f) => ({ ...f, model: m }))}
              className={`jelly-btn h-6 rounded-full px-2.5 text-[10.5px] font-medium ${
                form.model === m ? "bg-primary text-primary-foreground" : "glass-input text-muted-foreground"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" className="jelly-btn h-8 flex-1 rounded-xl text-xs" onClick={save}>
          {savedMsg ? "已保存" : "保存生图配置"}
        </Button>
        <Button size="sm" variant="outline" className="jelly-btn h-8 rounded-xl text-xs" onClick={() => setForm(DEFAULT_IMAGE_CONFIG)}>
          恢复默认
        </Button>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        此通道只用于角色「分享日常照片」，与聊天接口互不影响；全部失败时自动回落角色定妆照。
      </p>
    </div>
  );
}

/** 外部语音 API 接入：通用网关（OpenAI 兼容）或 MiniMax 官方通道；音色清单供角色绑定 */
function VoiceSection({ config }: { config: AiConfig }) {
  const [form, setForm] = useState<VoiceConfig>(() => loadVoiceConfig());
  const [savedMsg, setSavedMsg] = useState(false);
  const [newVoice, setNewVoice] = useState("");
  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState(false);
  const [testErr, setTestErr] = useState("");
  const [myVoices, setMyVoices] = useState<{ id: string; label: string }[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);

  const save = () => {
    saveVoiceConfig(form);
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 1500);
  };

  /** MiniMax 通道：先真实合成一段试听，成功才保存并显示"已成功" */
  const testAndSave = async () => {
    if (!form.minimaxKey.trim() || testing) return;
    setTesting(true);
    setTestErr("");
    try {
      await testVoiceChannel(form, { baseUrl: config.baseUrl, apiKey: config.apiKey });
      saveVoiceConfig(form);
      setTestOk(true);
      console.log(`[tts] minimax test ok region=${form.minimaxRegion} model=${form.minimaxModel}`);
      setTimeout(() => setTestOk(false), 2500);
    } catch (e) {
      setTestErr(e instanceof Error ? e.message : "测试失败");
      console.warn("[tts] minimax test fail:", e);
    } finally {
      setTesting(false);
    }
  };

  const isMiniMax = form.provider === "minimax";

  /** 拉取账户下全部音色（系统+克隆+文生），供一键选用 */
  const loadMyVoices = async () => {
    if (voicesLoading) return;
    setVoicesLoading(true);
    setTestErr("");
    try {
      const list = await fetchMiniMaxVoices(form);
      setMyVoices(list);
      console.log(`[tts] get_voice ok count=${list.length}`);
      if (!list.length) setTestErr("没查到任何音色——克隆音色需要先用它成功合成过一次才会出现在列表里");
    } catch (e) {
      setTestErr(e instanceof Error ? e.message : "获取音色列表失败");
      console.warn("[tts] get_voice fail:", e);
    } finally {
      setVoicesLoading(false);
    }
  };

  return (
    <div className="glass space-y-2.5 rounded-2xl p-3.5">
      <p className="text-[13px] font-semibold">外部语音（TTS）</p>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setForm((f) => ({ ...f, provider: "openai" }))}
          className={`jelly-btn rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${!isMiniMax ? "bg-primary text-primary-foreground" : "glass text-secondary-foreground"}`}
        >
          通用网关
        </button>
        <button
          type="button"
          onClick={() => setForm((f) => ({ ...f, provider: "minimax" }))}
          className={`jelly-btn rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${isMiniMax ? "bg-primary text-primary-foreground" : "glass text-secondary-foreground"}`}
        >
          MiniMax
        </button>
      </div>
      {isMiniMax ? (
        <>
          <Input type="password" placeholder="MiniMax API Key" autoComplete="off" value={form.minimaxKey} onChange={(e) => { setForm((f) => ({ ...f, minimaxKey: e.target.value })); setTestOk(false); setTestErr(""); }} className="h-9 rounded-lg glass-input text-[12px]" />
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, minimaxRegion: "cn" }))}
              className={`jelly-btn rounded-full px-3 py-1 text-[10.5px] ${form.minimaxRegion === "cn" ? "bg-primary/15 font-semibold text-primary" : "text-muted-foreground"}`}
            >
              国内 api.minimaxi.com
            </button>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, minimaxRegion: "global" }))}
              className={`jelly-btn rounded-full px-3 py-1 text-[10.5px] ${form.minimaxRegion === "global" ? "bg-primary/15 font-semibold text-primary" : "text-muted-foreground"}`}
            >
              国际 api.minimax.io
            </button>
          </div>
          <Input placeholder="模型名，如 speech-02-hd / speech-2.8-hd" value={form.minimaxModel} onChange={(e) => setForm((f) => ({ ...f, minimaxModel: e.target.value }))} className="h-9 rounded-lg glass-input text-[12px]" />
          <Input placeholder="默认音色 voice_id，如 male-qn-qingse" value={form.minimaxVoice} onChange={(e) => setForm((f) => ({ ...f, minimaxVoice: e.target.value }))} className="h-9 rounded-lg glass-input text-[12px]" />
          <div className="flex flex-wrap gap-1.5">
            {MINIMAX_VOICES.map((v) => (
              <button key={v.id} type="button" onClick={() => setForm((f) => ({ ...f, minimaxVoice: v.id }))} className={`jelly-btn rounded-full px-2.5 py-0.5 text-[10.5px] ${form.minimaxVoice === v.id ? "bg-primary/15 font-semibold text-primary" : "bg-white/50 text-secondary-foreground"}`}>
                {v.label}
              </button>
            ))}
            <button type="button" disabled={voicesLoading || !form.minimaxKey.trim()} onClick={loadMyVoices} className="jelly-btn flex items-center gap-1 rounded-full border border-primary/30 px-2.5 py-0.5 text-[10.5px] font-semibold text-primary disabled:opacity-40">
              {voicesLoading ? <LoaderCircle className="size-3 animate-spin" /> : <ListChecks className="size-3" />}
              我的音色{myVoices.length ? `（${myVoices.length}）` : ""}
            </button>
          </div>
          {myVoices.length > 0 && (
            <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg bg-white/40 p-2">
              {myVoices.map((v) => (
                <button key={v.id} type="button" onClick={() => setForm((f) => ({ ...f, minimaxVoice: v.id }))} className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-[10.5px] transition-colors hover:bg-primary/10 ${form.minimaxVoice === v.id ? "font-semibold text-primary" : "text-secondary-foreground"}`}>
                  <span className="truncate">{v.label}</span>
                  <span className="shrink-0 font-mono text-[9px] text-muted-foreground">{v.id}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" className="jelly-btn h-8 flex-1 rounded-xl text-xs" disabled={!form.minimaxKey.trim() || testing} onClick={testAndSave}>
              {testing ? <span className="flex items-center gap-1"><LoaderCircle className="size-3 animate-spin" />正在接入…</span> : testOk ? <span className="flex items-center gap-1 text-success"><CheckCircle2 className="size-3.5" />已成功</span> : "测试并保存"}
            </Button>
          </div>
          {testErr && (
            <p className="flex items-start gap-1 rounded-lg bg-destructive/10 px-2.5 py-2 text-[11px] leading-relaxed text-destructive">
              <XCircle className="mt-0.5 size-3 shrink-0" />{testErr}
            </p>
          )}
          <p className="text-[11px] leading-relaxed text-muted-foreground">在 MiniMax 控制台复制 API Key 粘贴即可；测错区域会报 Key 无效，切换另一个区域重测。</p>
        </>
      ) : (
        <>
          <Input placeholder="语音接口地址（留空=复用聊天接口）" value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} className="h-9 rounded-lg glass-input text-[12px]" />
          <Input type="password" placeholder="语音 Key（留空=复用聊天 Key）" autoComplete="off" value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} className="h-9 rounded-lg glass-input text-[12px]" />
          <Input placeholder="TTS 模型名，如 tts-1" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} className="h-9 rounded-lg glass-input text-[12px]" />
          <div className="flex flex-wrap items-center gap-1.5">
            {form.voices.map((v) => (
              <span key={v.id} className="flex items-center gap-1 rounded-full bg-white/50 px-2 py-0.5 text-[10.5px]">
                {v.label}
                <button type="button" aria-label={`移除 ${v.id}`} onClick={() => setForm((f) => ({ ...f, voices: f.voices.filter((x) => x.id !== v.id) }))} className="text-muted-foreground hover:text-destructive">
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input placeholder="新增音色 id / id·说明" value={newVoice} onChange={(e) => setNewVoice(e.target.value)} className="h-8 flex-1 rounded-lg glass-input text-[11px]" />
            <Button size="sm" variant="outline" className="jelly-btn h-8 rounded-lg px-2.5 text-[11px]" onClick={() => {
              const id = newVoice.trim().split(/[·\s]/)[0];
              if (!id) return;
              setForm((f) => ({ ...f, voices: [...f.voices, { id, label: newVoice.trim() }] }));
              setNewVoice("");
            }}>
              添加
            </Button>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="jelly-btn h-8 flex-1 rounded-xl text-xs" onClick={save}>
              {savedMsg ? "已保存" : "保存语音配置"}
            </Button>
          </div>
        </>
      )}
      <p className="text-[11px] leading-relaxed text-muted-foreground">配好后，在角色设定里给每个角色单独绑音色，聊天消息旁会出现朗读按钮。</p>
    </div>
  );
}

/** 外部音乐歌单：粘贴 JSON / JS 歌单文件或每行一条 URL，解析后真机播放 */
function MusicSourceSection() {
  const [text, setText] = useState(() => {
    const tracks = loadMusicTracks().filter((t) => t.url);
    return tracks.length ? JSON.stringify(tracks.map(({ title, url }) => ({ title, url })), null, 2) : "";
  });
  const [savedMsg, setSavedMsg] = useState("");

  const save = () => {
    const tracks = parseMusicSource(text);
    if (!tracks.length) {
      setSavedMsg("没解析到任何曲目，检查一下格式");
      setTimeout(() => setSavedMsg(""), 2500);
      return;
    }
    saveMusicTracks(tracks);
    console.log(`[music] source saved tracks=${tracks.length}`);
    setSavedMsg(`已解析 ${tracks.length} 首，重开音乐 App 生效`);
    setTimeout(() => setSavedMsg(""), 2500);
  };

  return (
    <div className="glass space-y-2.5 rounded-2xl p-3.5">
      <p className="text-[13px] font-semibold">音乐 App 歌单源（JSON / JS）</p>
      <Textarea
        rows={6}
        placeholder={'直接粘贴歌单，支持三种格式：\n\n1. JSON 数组：[{"title":"晴天","url":"https://.../mp3"}]\n2. JS 文件内容：const list = [{"name":"晴天","src":"https://..."}];\n3. 每行一条："歌名|音频直链"'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="resize-none rounded-lg glass-input text-[11px] leading-relaxed font-mono"
      />
      <Button size="sm" className="jelly-btn h-8 w-full rounded-xl text-xs" onClick={save}>
        {savedMsg || "解析并保存歌单"}
      </Button>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        自动识别 title/name/song 为歌名、url/src/link 为音频地址；留空则为无音源的演示界面。
      </p>
    </div>
  );
}

function TestResultCard({ result }: { result: TestResult }) {
  const ok = result.status === "success";
  return (
    <div
      className={`screen-in rounded-2xl border p-3 text-[12px] ${
        ok ? "border-success/40 bg-success/10 backdrop-blur-md" : "border-destructive/40 bg-destructive/10 backdrop-blur-md"
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
