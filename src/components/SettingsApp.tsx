// 手机内「设置」应用：接口地址 / API Key / 模型名 / 连接测试 + 锁屏密码与壁纸自定义
import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, LoaderCircle, CheckCircle2, XCircle, ChevronLeft, Trash2, ListChecks, ImageUp, LockKeyhole, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { AiConfig, TestResult } from "@/lib/types";
import { normalizeBaseUrl } from "@/lib/types";
import { testConnection, fetchModelList } from "@/lib/ai-api";
import { usePasscode, DEFAULT_PASSCODE } from "@/lib/lock-store";
import { loadVoiceConfig, saveVoiceConfig, type VoiceConfig } from "@/lib/tts";
import { loadMusicTracks, saveMusicTracks } from "@/lib/media";

interface Props {
  config: AiConfig;
  onSave: (cfg: AiConfig) => void;
  onBack: () => void;
  onLock: () => void;
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

export function SettingsApp({ config, onSave, onBack, onLock, wallpapers }: Props) {
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
        <WallpaperSection wallpapers={wallpapers} />
        <VoiceSection />
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

/** 外部语音 API 接入：地址/Key 留空则复用聊天接口；音色清单手工维护供角色绑定 */
function VoiceSection() {
  const [form, setForm] = useState<VoiceConfig>(() => loadVoiceConfig());
  const [savedMsg, setSavedMsg] = useState(false);
  const [newVoice, setNewVoice] = useState("");

  const save = () => {
    saveVoiceConfig(form);
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 1500);
  };

  return (
    <div className="glass space-y-2.5 rounded-2xl p-3.5">
      <p className="text-[13px] font-semibold">外部语音（TTS）</p>
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
      <p className="text-[11px] leading-relaxed text-muted-foreground">配好后，在角色设定里给每个角色单独绑音色，聊天消息旁会出现朗读按钮。</p>
    </div>
  );
}

/** 外部音乐真机播放：每行一个音频 URL */
function MusicSourceSection() {
  const [text, setText] = useState(() => loadMusicTracks().map((t) => t.url).filter(Boolean).join("\n"));
  const [savedMsg, setSavedMsg] = useState(false);

  const save = () => {
    saveMusicTracks(
      text.split(/\r?\n/).map((u) => u.trim()).filter(Boolean)
    );
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 1500);
  };

  return (
    <div className="glass space-y-2.5 rounded-2xl p-3.5">
      <p className="text-[13px] font-semibold">音乐 App 音源</p>
      <Textarea rows={4} placeholder={"每行一个可公网访问的音频直链\nhttps://example.com/song.mp3"} value={text} onChange={(e) => setText(e.target.value)} className="resize-none rounded-lg glass-input text-[11.5px] leading-relaxed" />
      <Button size="sm" className="jelly-btn h-8 w-full rounded-xl text-xs" onClick={save}>
        {savedMsg ? "已保存，重开音乐 App 生效" : "保存音源"}
      </Button>
      <p className="text-[11px] leading-relaxed text-muted-foreground">填写后音乐 App 用真机播放这些曲目；留空则为无音源的演示界面。</p>
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
