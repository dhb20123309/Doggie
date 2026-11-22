// Companion OS 子应用：日记 / 查手机 / 心动羁绊 / 偏好记忆 / 小剧场 / 个人资料
import { useEffect, useState } from "react";
import { ChevronLeft, Plus, RefreshCw, Search, NotebookPen, LoaderCircle, Trash2, LockKeyhole, Image as ImageIcon, Settings2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AiConfig } from "@/lib/types";
import { isConfigured } from "@/lib/types";
import { chatCompletion } from "@/lib/ai-api";
import { useCharacters, readLastEntries } from "@/lib/chat-store";
import {
  ICON_URLS,
  useDiaries,
  useBond,
  usePreferences,
  usePhonePeek,
  useProfile,
  makePeek,
  seedDiaries,
  SCRIPTS,
  type DiaryEntry,
  type SceneNode,
} from "@/lib/companion-store";

interface AppProps {
  config?: AiConfig;
  onBack: () => void;
}

const INK = "text-[oklch(0.36_0.045_80)]";
const SUB = "text-[oklch(0.5_0.04_80)]";

/** 共用顶栏 */
function ShellHeader({ title, onBack, action }: { title: string; onBack: () => void; action?: React.ReactNode }) {
  return (
    <div className="glass-nav flex items-center justify-between px-2 py-2">
      <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onBack} aria-label="返回">
        <ChevronLeft className="size-5" />
      </Button>
      <span className={`text-sm font-semibold ${INK}`}>{title}</span>
      <div className="flex min-w-8 justify-end">{action ?? null}</div>
    </div>
  );
}

function EmptyTip({ text }: { text: string }) {
  return <p className={`pt-16 text-center text-xs ${SUB}`}>{text}</p>;
}

/* ================= 1. 日记 ================= */
export function DiaryApp({ config, onBack }: AppProps) {
  const [characters] = useCharacters();
  const [diaries, setDiaries] = useDiaries();
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const charId = characters[0]?.id ?? "zhou-chenyan";
  const ch = characters.find((c) => c.id === charId) ?? characters[0];
  const ready = config ? isConfigured(config) : false;

  useEffect(() => {
    if (!diaries.some((d) => d.charId === charId)) setDiaries((prev) => [...prev, ...seedDiaries(charId)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const write = async () => {
    if (!config || !ch || busy) return;
    setBusy(true);
    setErr("");
    try {
      const raw = await chatCompletion(config, [
        { role: "system", content: `${(ch.persona || "").slice(0, 500)}\n\n以第一人称写一篇 60-120 字的日常随笔，先输出标题行再空一行正文，不要旁白解释。` },
        { role: "user", content: "写今天的。" },
      ]);
      const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const entry: DiaryEntry = { id: `d${Date.now()}`, charId, title: lines[0] ?? "无题", content: lines.slice(1).join("\n") || lines[0], at: Date.now() };
      setDiaries((prev) => [entry, ...prev]);
    } catch {
      setErr("TA 今天灵感枯竭了，稍后再试");
    } finally {
      setBusy(false);
    }
  };

  const list = [...diaries].sort((a, b) => b.at - a.at);
  return (
    <div className="flex h-full flex-col">
      <ShellHeader title="TA 的日记" onBack={onBack} action={
        <button type="button" onClick={() => void write()} disabled={!ready || busy} className="jelly-btn flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-medium text-primary disabled:opacity-40">
          {busy ? <LoaderCircle className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
          让 TA 写新的
        </button>
      } />
      {!ready && <p className={`px-4 pt-2 text-center text-[11px] ${SUB}`}>连接大脑后才能现场生成（去设置填 API）</p>}
      {err && <p className="px-4 pt-1 text-center text-[11px] text-destructive">{err}</p>}
      <div className="flex-1 space-y-2.5 overflow-y-auto px-3 pb-6 pt-3">
        {list.length === 0 && <EmptyTip text="还没有日记" />}
        {list.map((d) => (
          <button key={d.id} type="button" onClick={() => setOpenId(openId === d.id ? null : d.id)} className={`glass block w-full rounded-2xl p-3.5 text-left ${INK}`}>
            <p className="text-[13px] font-semibold">{d.title}</p>
            <p className={`mt-1 text-[11.5px] leading-relaxed ${SUB} ${openId === d.id ? "" : "line-clamp-1"}`}>{d.content}</p>
            <p className="mt-1.5 text-[10px] opacity-60">{new Date(d.at).toLocaleDateString("zh-CN")} · {String(new Date(d.at).getHours()).padStart(2, "0")}:{String(new Date(d.at).getMinutes()).padStart(2, "0")}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ================= 2. 查手机 ================= */
export function PhonePeekApp({ onBack }: AppProps) {
  const [characters] = useCharacters();
  const [peek, setPeek] = usePhonePeek();
  const charId = characters[0]?.id ?? "zhou-chenyan";
  const ch = characters.find((c) => c.id === charId) ?? characters[0];
  const data = peek?.charId === charId ? peek : makePeek(charId);
  useEffect(() => {
    if (!peek || peek.charId !== charId) setPeek(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const avatarIsImg = ch?.avatar?.startsWith("data:") || ch?.avatar?.startsWith("http");
  return (
    <div className="lock-fade flex h-full flex-col">
      <ShellHeader title="查手机" onBack={onBack} action={
        <button type="button" aria-label="刷新" onClick={() => setPeek(makePeek(charId))} className="jelly-icon p-1.5 text-muted-foreground hover:text-primary">
          <RefreshCw className="size-4" />
        </button>
      } />
      <div className="flex-1 space-y-3 overflow-y-auto px-3 pb-6 pt-3">
        {/* 模拟锁屏 */}
        <div className={`glass rounded-2xl px-4 py-5 text-center ${INK}`}>
          <p className="font-display text-4xl font-extralight tabular-nums tracking-tight">
            {String(new Date().getHours()).padStart(2, "0")}:{String(new Date().getMinutes()).padStart(2, "0")}
          </p>
          <p className="mt-1 text-2xl font-light">🔋 {data.battery}%</p>
          <p className={`mt-1 text-[10px] ${SUB}`}>密码错误 3 次，已偷偷解锁 🔓</p>
        </div>
        {/* 搜索记录 */}
        <div className="glass rounded-2xl p-3.5">
          <p className={`mb-2 text-[12px] font-semibold ${INK}`}>隐秘搜索记录</p>
          <ul className="space-y-1.5">
            {data.searches.map((s, i) => (
              <li key={i} className={`flex items-center gap-2 text-[11.5px] ${SUB}`}>
                <Search className="size-3.5 shrink-0 opacity-60" />{s}
              </li>
            ))}
          </ul>
        </div>
        {/* 草稿箱 */}
        <div className="glass rounded-2xl p-3.5">
          <p className={`mb-2 text-[12px] font-semibold ${INK}`}>未发出的草稿箱</p>
          <div className="space-y-2">
            {data.drafts.map((d, i) => (
              <div key={i} className={`flex gap-2 rounded-xl bg-white/45 p-2.5 text-[11.5px] leading-relaxed ${INK}`}>
                <NotebookPen className="size-4 shrink-0 mt-0.5 opacity-50" />
                <span>{d}</span>
              </div>
            ))}
          </div>
        </div>
        {/* 私密相册 */}
        <div className="glass rounded-2xl p-3.5">
          <p className={`mb-2 flex items-center gap-1.5 text-[12px] font-semibold ${INK}`}><LockKeyhole className="size-3.5 text-primary" />私密相册</p>
          <div className="grid grid-cols-3 gap-2">
            {avatarIsImg ? (
              <>
                <img src={ch!.avatar} alt="" className="aspect-square w-full rounded-xl object-cover" />
                <div className="flex aspect-square items-center justify-center rounded-xl bg-white/40 text-2xl">🤫</div>
                <div className="flex aspect-square items-center justify-center rounded-xl bg-white/40 text-2xl">🔒</div>
              </>
            ) : (
              ["🙈", "🤫", "🔒"].map((e) => (
                <div key={e} className="flex aspect-square items-center justify-center rounded-xl bg-white/40 text-3xl">{e}</div>
              ))
            )}
          </div>
          <p className={`mt-2 flex items-center gap-1 text-[10px] ${SUB}`}><ImageIcon className="size-3" />被锁起来的照片，暂时看不到啦</p>
        </div>
      </div>
    </div>
  );
}

/* ================= 3. 心动羁绊 ================= */
export function BondApp({ onBack }: AppProps) {
  const [characters] = useCharacters();
  const [bond, setBond] = useBond();
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const charId = characters[0]?.id ?? "zhou-chenyan";

  useEffect(() => {
    if (!bond.startDate) {
      const log = readLastEntries(charId, 50);
      const first = log.find((e) => e.role === "user");
      setBond((b) => ({ ...b, startDate: first?.at ?? Date.now() }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const days = bond.startDate ? Math.max(1, Math.floor((Date.now() - bond.startDate) / 86400_000) + 1) : 1;
  const addAnniv = () => {
    if (!name.trim() || !date) return;
    setBond((b) => ({ ...b, anniversaries: { ...b.anniversaries, [name.trim()]: new Date(date).getTime() } }));
    setName(""); setDate("");
  };
  const countdown = (t: number) => {
    const diff = Math.ceil((t - Date.now()) / 86400_000);
    return diff >= 0 ? `还有 ${diff} 天` : `已过 ${-diff} 天`;
  };

  return (
    <div className="flex h-full flex-col">
      <ShellHeader title="心动羁绊" onBack={onBack} />
      <div className="flex-1 space-y-3 overflow-y-auto px-3 pb-6 pt-3">
        <div className="glass rounded-2xl p-5 text-center">
          <p className="text-[11px] tracking-wide text-[oklch(0.55_0.09_355)]">在一起</p>
          <p className="font-display my-1 text-6xl font-extralight tabular-nums text-[oklch(0.6_0.14_355)]">{days}</p>
          <p className="text-[12px] font-medium text-[oklch(0.4_0.05_355)]">天 💕</p>
          <label className={`mt-3 block text-[10.5px] text-[oklch(0.5_0.04_80)]`}>
            开始的日子
            <Input type="date" value={bond.startDate ? new Date(bond.startDate).toISOString().slice(0, 10) : ""} onChange={(e) => e.target.value && setBond((b) => ({ ...b, startDate: new Date(e.target.value).getTime() }))} className="mx-auto mt-1 h-8 w-36 rounded-lg glass-input text-center text-[11px]" />
          </label>
        </div>
        <div className="glass rounded-2xl p-3.5">
          <p className="mb-2 text-[12px] font-semibold text-[oklch(0.36_0.045_80)]">纪念日倒计时</p>
          {Object.keys(bond.anniversaries).length === 0 && <p className="py-2 text-center text-[11px] text-[oklch(0.5_0.04_80)]">还没有纪念日，加一个重要的日子吧</p>}
          <div className="space-y-1.5">
            {Object.entries(bond.anniversaries).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 rounded-xl bg-white/45 px-3 py-2">
                <span className="flex-1 truncate text-[12px] text-[oklch(0.36_0.045_80)]">{k}</span>
                <span className="rounded-full bg-pink-100 px-2 py-0.5 text-[10.5px] font-medium text-[oklch(0.55_0.12_355)]">{countdown(v)}</span>
                <button type="button" aria-label={`删除 ${k}`} onClick={() => setBond((b) => { const n = { ...b.anniversaries }; delete n[k]; return { ...b, anniversaries: n }; })} className="text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" /></button>
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex gap-2">
            <Input placeholder="名称，如 初遇" value={name} onChange={(e) => setName(e.target.value)} className="h-8 flex-1 rounded-lg glass-input text-[11px]" />
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 w-32 rounded-lg glass-input text-[11px]" />
            <Button size="sm" variant="outline" className="jelly-btn h-8 rounded-lg px-2.5" onClick={addAnniv}><Plus className="size-3.5" /></Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================= 4. 偏好记忆 ================= */
export function PreferenceApp({ config, onBack }: AppProps) {
  const [characters] = useCharacters();
  const [prefs, setPrefs] = usePreferences();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const charId = characters[0]?.id ?? "zhou-chenyan";
  const ready = config ? isConfigured(config) : false;

  const observe = async () => {
    if (!config || busy) return;
    setBusy(true); setErr("");
    try {
      const log = readLastEntries(charId, 15);
      const convo = log.map((e) => `${e.role === "user" ? "我" : "TA"}：${e.content}`).join("\n") || "（还没有聊天记录）";
      const raw = await chatCompletion(config, [
        { role: "system", content: "根据以下聊天记录，用 3-5 条短句总结「我」的习惯偏好，像恋人观察笔记，每条一行，不超过 20 字。" },
        { role: "user", content: convo },
      ]);
      const items = raw.split(/\r?\n/).map((s) => s.replace(/^[-•\d.、\s]+/, "").trim()).filter(Boolean).slice(0, 5);
      if (!items.length) throw new Error("empty");
      setPrefs((prev) => [...items.map((t) => ({ id: `m${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, text: t, at: Date.now() })), ...prev]);
    } catch {
      setErr("TA 观察失败，先聊几句再来");
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const t = text.trim();
    if (!t) return;
    setPrefs((prev) => [{ id: `m${Date.now()}`, text: t, at: Date.now() }, ...prev]);
    setText("");
  };

  return (
    <div className="flex h-full flex-col">
      <ShellHeader title="偏好记忆" onBack={onBack} action={
        <button type="button" onClick={() => void observe()} disabled={!ready || busy} className="jelly-btn flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-medium text-primary disabled:opacity-40">
          {busy ? <LoaderCircle className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
          TA 观察到的我
        </button>
      } />
      {err && <p className="px-4 pt-1 text-center text-[11px] text-destructive">{err}</p>}
      <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-6 pt-3">
        {prefs.length === 0 && <EmptyTip text="还没有记录，点右上角让 TA 从聊天里观察你" />}
        {prefs.map((p) => (
          <div key={p.id} className={`group flex items-start gap-2 rounded-2xl glass p-3 ${INK}`}>
            <span className="mt-0.5 text-primary">💡</span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] leading-relaxed">{p.text}</p>
              <p className={`mt-0.5 text-[10px] opacity-50`}>{new Date(p.at).toLocaleDateString("zh-CN")}</p>
            </div>
            <button type="button" aria-label="删除" onClick={() => setPrefs((prev) => prev.filter((x) => x.id !== p.id))} className="opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive">
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          <Input placeholder="手动记一条…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} className="h-9 flex-1 rounded-lg glass-input text-[12px]" />
          <Button size="sm" className="jelly-btn h-9 rounded-xl px-3" onClick={add}><Plus className="size-4" /></Button>
        </div>
      </div>
    </div>
  );
}

/* ================= 5. 小剧场 ================= */
export function TheaterApp({ onBack }: AppProps) {
  const [scriptId, setScriptId] = useState<string | null>(null);
  const [nodeId, setNodeId] = useState<string>("");
  const script = SCRIPTS.find((s) => s.id === scriptId);
  const node: SceneNode | undefined = script?.nodes[nodeId];

  if (!script) {
    return (
      <div className="flex h-full flex-col">
        <ShellHeader title="小剧场" onBack={onBack} />
        <div className="flex-1 space-y-3 overflow-y-auto px-3 pb-6 pt-3">
          {SCRIPTS.map((s) => (
            <button key={s.id} type="button" onClick={() => { setScriptId(s.id); setNodeId(s.start); }} className="glass flex w-full items-center gap-3 rounded-2xl p-3.5 text-left">
              <img src={ICON_URLS.theater} alt="" className="size-14 shrink-0 object-contain drop-shadow-sm" />
              <span className="min-w-0">
                <span className={`block text-[13.5px] font-semibold ${INK}`}>{s.title}</span>
                <span className={`mt-0.5 block text-[11px] ${SUB}`}>{s.sub} · 分支剧情</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ShellHeader title={script.title} onBack={() => setScriptId(null)} />
      <div className="flex-1 space-y-2.5 overflow-y-auto px-3 pb-6 pt-4">
        {node ? (
          <>
            {node.text.map((t, i) => (
              <div key={`${node.id}-${i}`} data-reveal-delay={String(i * 120)} className={`reveal reveal-up rounded-2xl glass px-3.5 py-2.5 text-[12.5px] leading-relaxed ${INK}`}>
                {t}
              </div>
            ))}
            {node.ending ? (
              <div className="mt-4 rounded-2xl border-2 border-[oklch(0.75_0.12_85)] bg-[oklch(0.97_0.04_85)]/70 p-4 text-center">
                <p className="text-[10px] tracking-widest text-[oklch(0.55_0.08_80)]">— FIN —</p>
                <p className={`mt-1.5 text-[12.5px] font-medium leading-relaxed ${INK}`}>{node.ending}</p>
                <div className="mt-3 flex justify-center gap-2">
                  <Button size="sm" className="jelly-btn h-8 rounded-xl text-xs" onClick={() => setNodeId(script.start)}>从头再来</Button>
                  <Button size="sm" variant="outline" className="jelly-btn h-8 rounded-xl text-xs" onClick={() => setScriptId(null)}>换个剧本</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 pt-2">
                {node.choices?.map((c, i) => (
                  <button key={i} type="button" onClick={() => setNodeId(c.next)} className={`jelly-btn glass-input block w-full rounded-xl px-3.5 py-2.5 text-left text-[12px] font-medium ${INK} hover:bg-primary/10`}>
                    <span className="mr-1.5 text-primary">◦</span>{c.label}
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <EmptyTip text="剧本走丢了" />
        )}
      </div>
    </div>
  );
}

/* ================= 6. 个人资料 ================= */
export function ProfileApp({ onBack, onOpenChar, onOpenSettings }: AppProps & { onOpenChar?: () => void; onOpenSettings?: () => void }) {
  const [characters] = useCharacters();
  const [profile, setProfile] = useProfile();
  const ch = characters[0];
  const avatarIsImg = ch?.avatar?.startsWith("data:") || ch?.avatar?.startsWith("http");
  return (
    <div className="flex h-full flex-col">
      <ShellHeader title="个人资料" onBack={onBack} />
      <div className="flex-1 space-y-3 overflow-y-auto px-3 pb-6 pt-3">
        <div className="glass rounded-2xl p-4">
          <p className={`mb-1.5 text-[11px] ${SUB}`}>你对 TA 的称呼</p>
          <Input value={profile.nickname} onChange={(e) => setProfile({ nickname: e.target.value })} placeholder="Dreaming" className="h-9 rounded-lg glass-input text-[13px]" />
        </div>
        {ch && (
          <div className="glass flex items-center gap-3 rounded-2xl p-4">
            <span className="flex size-12 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-primary/10 text-2xl shadow-inner">
              {avatarIsImg ? <img src={ch.avatar} alt="" className="size-full object-cover" /> : ch.avatar}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-[13.5px] font-semibold ${INK}`}>{ch.name}</p>
              <p className={`truncate text-[11px] ${SUB}`}>{(ch.persona || "").slice(0, 30)}…</p>
            </div>
            {onOpenChar && (
              <Button size="sm" variant="outline" className="jelly-btn h-8 shrink-0 rounded-xl text-[11px]" onClick={onOpenChar}>
                <Settings2 className="mr-1 size-3" />编辑角色设定
              </Button>
            )}
          </div>
        )}
        {onOpenSettings && (
          <div className="glass rounded-2xl p-1.5">
            {[
              { label: "锁屏密码", icon: <LockKeyhole className="size-4 text-primary" /> },
              { label: "壁纸与聊天背景", icon: <ImageIcon className="size-4 text-primary" /> },
              { label: "生图 / 语音 / 音乐通道", icon: <Sparkles className="size-4 text-primary" /> },
            ].map((row) => (
              <button key={row.label} type="button" onClick={onOpenSettings} className={`jelly-btn flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[12.5px] ${INK} hover:bg-primary/10`}>
                {row.icon}{row.label}
                <ChevronLeft className="ml-auto size-4 rotate-180 opacity-40" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
