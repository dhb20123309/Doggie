// 真机联动 · 设置页授权面板：开关 + GitHub 仓库授权表单 + 连接测试 + 分端配置生成（复制即用）
import { useState } from "react";
import { ChevronDown, ChevronRight, Copy, Check, LoaderCircle, Smartphone, ShieldCheck, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useRealPhone, realPhoneReady, testRealPhone, loadRealData, type RealPhoneConfig } from "@/lib/realphone";
import { genItems, type GenItem } from "@/lib/realphone-setup";

const INK = "text-foreground";
const SUB = "text-muted-foreground";

export function RealPhoneSection() {
  const [cfg, setCfg] = useRealPhone();
  const [form, setForm] = useState<RealPhoneConfig>(cfg);
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const ready = realPhoneReady(cfg);
  const dirty = JSON.stringify(form) !== JSON.stringify(cfg);
  const data = loadRealData();

  const save = () => {
    setCfg({ ...form, owner: form.owner.trim(), repo: form.repo.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\/+$/, ""), dir: form.dir.trim() || "vp-data" });
    console.log(`[realphone] config saved enabled=${form.enabled} repo=${form.owner}/${form.repo}`);
  };

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    const r = await testRealPhone({ ...form, enabled: true });
    setResult(r);
    setTesting(false);
  };

  return (
    <div className="glass rounded-2xl p-4">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left">
        <span className={`flex items-center gap-2 text-sm font-semibold ${INK}`}>
          <span className="flex size-8 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Smartphone className="size-4" />
          </span>
          真机联动
          <span className={`rounded-full px-2 py-0.5 text-[10px] ${ready ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
            {ready ? "已接入" : "未开启"}
          </span>
        </span>
        <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <p className={`mt-1.5 pl-10 text-[11px] leading-relaxed ${SUB}`}>
        把你真实手机的状态（电量、亮度、App 使用、位置、锁屏事件）汇报给 TA——TA 会基于这些真实情况查岗、心疼、吃醋。数据走你自己的 GitHub 私有仓库，本应用不经过任何第三方服务器。
      </p>

      {open && (
        <div className="mt-3 space-y-3 border-t border-primary/10 pt-3">
          <div className="flex items-center justify-between">
            <Label className={`text-[12.5px] ${INK}`}>启用联动</Label>
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">GitHub 用户名</Label>
              <Input value={form.owner} onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))} placeholder="your-name" className="h-9 rounded-xl glass-input text-[12.5px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">仓库名（建议新建 Private 仓）</Label>
              <Input value={form.repo} onChange={(e) => setForm((f) => ({ ...f, repo: e.target.value }))} placeholder="vp-phone-data" className="h-9 rounded-xl glass-input text-[12.5px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">分支</Label>
              <Input value={form.branch} onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))} placeholder="main" className="h-9 rounded-xl glass-input text-[12.5px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">数据目录</Label>
              <Input value={form.dir} onChange={(e) => setForm((f) => ({ ...f, dir: e.target.value }))} placeholder="vp-data" className="h-9 rounded-xl glass-input text-[12.5px]" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Fine-grained Token（只勾这个仓库的 Contents 读写；仅存本机浏览器）</Label>
            <Input type="password" value={form.token} onChange={(e) => setForm((f) => ({ ...f, token: e.target.value }))} placeholder="github_pat_…" className="h-9 rounded-xl glass-input text-[12.5px]" />
            <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 text-[11px] text-primary hover:underline`}>
              <ExternalLink className="size-3" /> 去 GitHub 创建 Token
            </a>
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={!dirty} className={`jelly-btn flex-1 rounded-full py-2 text-[12.5px] font-medium ${dirty ? "bg-primary text-primary-foreground" : `bg-muted ${SUB}`}`}>
              {dirty ? "保存配置" : "已保存"}
            </button>
            <button type="button" onClick={runTest} disabled={testing || !form.owner || !form.repo || !form.token} className={`jelly-btn flex-1 rounded-full py-2 text-[12.5px] font-medium bg-white/60 ${INK} disabled:opacity-50`}>
              {testing ? (<><LoaderCircle className="mr-1 inline size-3.5 animate-spin" />检测中…</>) : ("测试连接")}
            </button>
          </div>
          {result && (
            <p className={`flex items-start gap-1.5 rounded-xl px-2.5 py-2 text-[11px] leading-relaxed ${result.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
              {result.ok ? <ShieldCheck className="mt-0.5 size-3.5 shrink-0" /> : <Check className="mt-0.5 hidden" />}
              {result.msg}
            </p>
          )}

          {ready ? (
            <>
              <div className={`rounded-xl bg-white/50 px-3 py-2 text-[11px] ${INK}`}>
                <p className="font-semibold">当前同步状态</p>
                <p className={`mt-1 leading-relaxed ${SUB}`}>
                  {data.fetchedAt ? (
                    <>最近拉取：{new Date(data.fetchedAt).toLocaleString("zh-CN", { hour12: false })} ｜ App 记录 {data.activity.length} 条 ｜ 事件 {data.events.length} 条 ｜ 设备快照 {data.device ? "有" : "无"} ｜ 锁定名单 {data.locks.apps.length ? data.locks.apps.join("、") : "空"}</>
                  ) : (
                    "还没拉到数据——手机端配置好并运行一次后，这里会自动出现内容。"
                  )}
                  {Object.keys(data.errors).length > 0 && <span className="text-red-500">（读取异常：{Object.entries(data.errors).map(([f, m]) => `${f}:${m}`).join("，")}）</span>}
                </p>
              </div>
              <SetupList cfg={cfg} />
            </>
          ) : (
            <p className={`text-[11px] leading-relaxed ${SUB}`}>填写并保存上方配置、打开「启用联动」后，这里会生成属于你自己手机的快捷指令 / Tasker / Termux 配置。</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- 分端配置清单（手风琴 + 一键复制） ---------- */

function SetupList({ cfg }: { cfg: RealPhoneConfig }) {
  const items = genItems(cfg);
  const [openId, setOpenId] = useState<string>("");
  const [copied, setCopied] = useState("");
  const copy = async (item: GenItem) => {
    try {
      await navigator.clipboard.writeText(item.code);
      setCopied(item.id);
      setTimeout(() => setCopied(""), 1600);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="space-y-2">
      <p className={`text-[11.5px] font-semibold ${INK}`}>手机端接入配置（按你的手机类型选一个照做即可）</p>
      {items.map((it) => (
        <div key={it.id} className="overflow-hidden rounded-xl bg-white/50">
          <button type="button" onClick={() => setOpenId(openId === it.id ? "" : it.id)} className="flex w-full items-center gap-1.5 px-3 py-2 text-left">
            <ChevronRight className={`size-3.5 shrink-0 text-primary transition-transform ${openId === it.id ? "rotate-90" : ""}`} />
            <span className={`text-[12px] font-medium ${INK}`}>{it.title}</span>
          </button>
          {openId === it.id && (
            <div className="px-3 pb-2.5">
              <p className={`mb-1.5 text-[10.5px] leading-relaxed ${SUB}`}>{it.desc}</p>
              <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-neutral-900/90 p-2.5 font-mono text-[10px] leading-relaxed text-neutral-100">{it.code}</pre>
              <button type="button" onClick={() => copy(it)} className={`jelly-btn mt-1.5 inline-flex items-center gap-1 rounded-full bg-primary/12 px-2.5 py-1 text-[11px] text-primary`}>
                {copied === it.id ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied === it.id ? "已复制" : "复制配置"}
              </button>
            </div>
          )}
        </div>
      ))}
      <p className={`text-[10px] leading-relaxed ${SUB}`}>
        隐私提示：Token 与数据全程只在你与你的 GitHub 仓库之间流转；关闭上方「启用联动」或到 GitHub 吊销 Token 即可随时断开，角色侧自动回落为模拟数据。
      </p>
    </div>
  );
}
