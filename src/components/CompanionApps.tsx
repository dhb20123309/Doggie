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
  iconFor,
  useDiaries,
  useBond,
  usePreferences,
  usePhonePeek,
  useProfile,
  makePeek,
  isPeekFresh,
  seedDiaries,
  SCRIPTS,
  loadCharScripts,
  deleteCharScript,
  generateScriptFor,
  fillScriptText,
  type DiaryEntry,
  type SceneNode,
  type Script,
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
  // 可切换哥哥/弟弟：默认第一个角色，切换后各自看各自的日记
  const [whoIdx, setWhoIdx] = useState(0);
  const charId = characters[Math.min(whoIdx, characters.length - 1)]?.id ?? "zhou-chenyan";
  const ch = characters.find((c) => c.id === charId) ?? characters[0];
  const ready = config ? isConfigured(config) : false;

  // 进入或切换角色时补齐该角色的种子日记；同时一次性清理历史重复条目（同标题+正文只留最早一条）
  useEffect(() => {
    setDiaries((prev) => {
      let next = prev.filter(
        (d, i) => prev.findIndex((o) => o.title === d.title && o.content === d.content) === i
      );
      const removed = prev.length - next.length;
      if (removed > 0) console.log(`[diary] dedupe removed=${removed}`);
      if (!next.some((d) => d.charId === charId)) {
        console.log(`[diary] seed char=${charId}`);
        next = [...next, ...seedDiaries(charId)];
      }
      return removed > 0 || next.length !== prev.length ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charId]);

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

  // 只展示当前选中角色的日记；列表里出现重复标题时打日志便于排查
  const list = diaries.filter((d) => d.charId === charId).sort((a, b) => b.at - a.at);
  const dupTitles = list.length - new Set(list.map((d) => `${d.title}|${d.content}`)).size;
  if (dupTitles > 0) console.warn(`[diary] dup-in-view char=${charId} count=${dupTitles}`);
  return (
    <div className="flex h-full flex-col">
      <ShellHeader title="TA 的日记" onBack={onBack} action={
        <button type="button" onClick={() => void write()} disabled={!ready || busy} className="jelly-btn flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-medium text-primary disabled:opacity-40">
          {busy ? <LoaderCircle className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
          让 TA 写新的
        </button>
      } />
      {/* 哥哥/弟弟切换：多角色时显示分段选择器 */}
      {characters.length > 1 && (
        <div className="glass mx-3 mt-2.5 flex gap-1 rounded-full p-1">
          {characters.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setWhoIdx(i)}
              className={`jelly-btn flex-1 rounded-full py-1.5 text-[12px] font-medium transition-colors ${
                i === Math.min(whoIdx, characters.length - 1) ? "bg-primary text-primary-foreground" : INK
              }`}
            >
              {c.name || "TA"}
            </button>
          ))}
        </div>
      )}
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
  // 可切换查谁的手机：默认第一个角色
  const [whoIdx, setWhoIdx] = useState(0);
  const charId = characters[Math.min(whoIdx, characters.length - 1)]?.id ?? "zhou-chenyan";
  const ch = characters.find((c) => c.id === charId) ?? characters[0];
  // 旧版缓存缺行踪/应用字段时视为失效，重新生成（防止 max(...) 空数组崩溃）
  const data = isPeekFresh(peek, charId) ? peek! : makePeek(charId);
  useEffect(() => {
    if (!isPeekFresh(peek, charId)) setPeek(makePeek(charId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charId]);
  const avatarIsImg = ch?.avatar?.startsWith("data:") || ch?.avatar?.startsWith("http");
  const maxMins = Math.max(...data.appUsage.map((a) => a.mins), 1);
  return (
    <div className="lock-fade flex h-full flex-col">
      <ShellHeader title="查手机" onBack={onBack} action={
        <button type="button" aria-label="刷新" onClick={() => setPeek(makePeek(charId))} className="jelly-icon p-1.5 text-muted-foreground hover:text-primary">
          <RefreshCw className="size-4" />
        </button>
      } />
      {/* 哥哥/弟弟切换 */}
      {characters.length > 1 && (
        <div className="glass mx-3 mt-2.5 flex gap-1 rounded-full p-1">
          {characters.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setWhoIdx(i)}
              className={`jelly-btn flex-1 rounded-full py-1.5 text-[12px] font-medium transition-colors ${
                i === Math.min(whoIdx, characters.length - 1) ? "bg-primary text-primary-foreground" : INK
              }`}
            >
              {c.alias?.trim() || c.name || "TA"} 的手机
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 space-y-3 overflow-y-auto px-3 pb-6 pt-3">
        {/* 模拟锁屏 */}
        <div className={`glass rounded-2xl px-4 py-5 text-center ${INK}`}>
          <p className="font-display text-4xl font-extralight tabular-nums tracking-tight">
            {String(new Date().getHours()).padStart(2, "0")}:{String(new Date().getMinutes()).padStart(2, "0")}
          </p>
          <p className="mt-1 text-2xl font-light">🔋 {data.battery}%</p>
          <p className={`mt-1 text-[10px] ${SUB}`}>密码错误 3 次，已偷偷解锁 🔓（{ch?.name || "TA"} 的手机）</p>
        </div>
        {/* 今日行踪 */}
        <div className="glass rounded-2xl p-3.5">
          <p className={`mb-2 text-[12px] font-semibold ${INK}`}>📍 TA 今天去了哪里</p>
          <ol className="relative space-y-2.5 pl-4">
            <span className="absolute left-[5px] top-1.5 bottom-1.5 w-px bg-primary/25" aria-hidden />
            {data.movements.map((m, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-4 top-1 size-2.5 rounded-full border-2 border-primary bg-white" aria-hidden />
                <p className={`text-[11.5px] font-semibold ${INK}`}>{m.place} <span className={`ml-1 font-normal ${SUB}`}>{m.time}</span></p>
                <p className={`text-[10.5px] leading-relaxed ${SUB}`}>{m.note}</p>
              </li>
            ))}
          </ol>
        </div>
        {/* 应用使用记录 */}
        <div className="glass rounded-2xl p-3.5">
          <p className={`mb-2 text-[12px] font-semibold ${INK}`}>⏱️ 今日屏幕使用 {Math.round(data.appUsage.reduce((s, a) => s + a.mins, 0) / 6) / 10} 小时</p>
          <ul className="space-y-2">
            {data.appUsage.map((a) => (
              <li key={a.name} className={`text-[11.5px] ${INK}`}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">{a.icon} {a.name}</span>
                  <span className={`text-[10.5px] ${SUB}`}>{a.mins >= 60 ? `${Math.floor(a.mins / 60)} 时 ${a.mins % 60} 分` : `${a.mins} 分钟`}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/50">
                  <div className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary" style={{ width: `${Math.round((a.mins / maxMins) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
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
export function TheaterApp({ config, onBack }: AppProps) {
  const [characters] = useCharacters();
  const [whoIdx, setWhoIdx] = useState(0);
  const who = characters[Math.min(whoIdx, Math.max(0, characters.length - 1))];
  const [scriptId, setScriptId] = useState<string | null>(null);
  const [nodeId, setNodeId] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [genMsg, setGenMsg] = useState("");
  // 每次进页/切角色重读该角色的 AI 剧本
  const [charScripts, setCharScripts] = useState(() => (who ? loadCharScripts(who.id) : []));
  useEffect(() => {
    if (who) setCharScripts(loadCharScripts(who.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [who?.id]);

  const allScripts: Script[] = [...charScripts, ...SCRIPTS.filter((s) => !s.charIds || s.charIds.includes(who?.id ?? ""))];
  const script = allScripts.find((s) => s.id === scriptId);
  const node: SceneNode | undefined = script?.nodes[nodeId];
  const ready = Boolean(config && isConfigured(config));

  const flash = (t: string) => {
    setGenMsg(t);
    setTimeout(() => setGenMsg(""), 3000);
  };

  const genScript = async () => {
    if (!config || !who || genBusy) return;
    if (!ready) {
      flash("先在设置里接入 AI 接口，TA 才能写剧本");
      return;
    }
    setGenBusy(true);
    try {
      const priv = readLastEntries(who.id, 12).map((e) => `${e.role === "user" ? "我" : who.name}：${(e.content || "").replace(/\n/g, " ").slice(0, 50)}`).join("\n");
      const ok = await generateScriptFor(config, who, priv);
      if (ok) {
        setCharScripts(loadCharScripts(who.id));
        flash(`已为「${who.name || "TA"}」写好一篇新剧场`);
        console.log(`[theater] script generated char=${who.id}`);
      } else {
        flash("TA 今天卡文了，稍后再试一次");
      }
    } finally {
      setGenBusy(false);
    }
  };

  const removeScript = (id: string) => {
    if (!who) return;
    deleteCharScript(who.id, id);
    setCharScripts(loadCharScripts(who.id));
    console.log(`[theater] deleted id=${id}`);
  };

  if (!script) {
    return (
      <div className="flex h-full flex-col">
        <ShellHeader title="小剧场" onBack={onBack} />
        {/* 角色分段器：谁的剧场一目了然，自定义角色同样可选 */}
        {characters.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto px-3 pb-1 pt-2">
            {characters.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setWhoIdx(i)}
                className={`jelly-btn shrink-0 rounded-full px-3 py-1 text-[11px] font-medium ${i === whoIdx ? "bg-primary text-primary-foreground shadow-sm" : "glass text-muted-foreground"}`}
              >
                {c.name || "未命名"}的剧场
              </button>
            ))}
          </div>
        )}
        <div className="flex-1 space-y-3 overflow-y-auto px-3 pb-6 pt-2">
          <button
            type="button"
            onClick={() => void genScript()}
            disabled={genBusy}
            className="jelly-btn glass flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/40 bg-primary/5 py-3 text-[12px] font-semibold text-primary disabled:opacity-50"
          >
            {genBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {genBusy ? "TA 正在写剧本…" : `让 ${who?.name || "TA"} 写一篇新剧场`}
          </button>
          {genMsg && <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[10.5px] leading-relaxed text-amber-700 ring-1 ring-amber-200/60">{genMsg}</p>}
          {allScripts.length === 0 && <EmptyTip text="还没有剧场，点上面让 TA 写一篇吧" />}
          {allScripts.map((s) => {
            const ownerIds = s.charIds ?? [];
            const owners = ownerIds.length ? characters.filter((c) => ownerIds.includes(c.id)).map((c) => c.name || "TA") : ["双子"];
            const isAi = s.id.startsWith("ai-");
            return (
              <div key={s.id} className="relative">
                <button type="button" onClick={() => { setScriptId(s.id); setNodeId(s.start); }} className="glass flex w-full items-center gap-3 rounded-2xl p-3.5 text-left">
                  <img src={iconFor("theater")} alt="" className="size-14 shrink-0 object-contain drop-shadow-sm" />
                  <span className="min-w-0">
                    <span className={`block text-[13.5px] font-semibold ${INK}`}>{fillScriptText(s.title, who?.name || "TA", characters)}</span>
                    <span className={`mt-0.5 block text-[11px] ${SUB}`}>{fillScriptText(s.sub, who?.name || "TA", characters)} · 分支剧情</span>
                    <span className="mt-1 inline-flex items-center gap-1">
                      {owners.map((o) => (
                        <span key={o} className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">{o}的剧场</span>
                      ))}
                      {isAi && <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-medium text-violet-600">AI 新作</span>}
                    </span>
                  </span>
                </button>
                {isAi && (
                  <button type="button" onClick={() => removeScript(s.id)} aria-label="删除剧本" className="jelly-icon absolute right-2.5 top-2.5 rounded-full bg-white/70 p-1.5 text-muted-foreground hover:text-destructive">
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ShellHeader title={fillScriptText(script.title, who?.name || "TA", characters)} onBack={() => setScriptId(null)} />
      <div className="flex-1 space-y-2.5 overflow-y-auto px-3 pb-6 pt-4">
        {node ? (
          <>
            {node.text.map((t, i) => (
              <div key={`${node.id}-${i}`} data-reveal-delay={String(i * 120)} className={`reveal reveal-up rounded-2xl glass px-3.5 py-2.5 text-[12.5px] leading-relaxed ${INK}`}>
                {fillScriptText(t, who?.name || "TA", characters)}
              </div>
            ))}
            {node.ending ? (
              <div className="mt-4 rounded-2xl border-2 border-[oklch(0.75_0.12_85)] bg-[oklch(0.97_0.04_85)]/70 p-4 text-center">
                <p className="text-[10px] tracking-widest text-[oklch(0.55_0.08_80)]">— FIN —</p>
                <p className={`mt-1.5 text-[12.5px] font-medium leading-relaxed ${INK}`}>{fillScriptText(node.ending, who?.name || "TA", characters)}</p>
                <div className="mt-3 flex justify-center gap-2">
                  <Button size="sm" className="jelly-btn h-8 rounded-xl text-xs" onClick={() => setNodeId(script.start)}>从头再来</Button>
                  <Button size="sm" variant="outline" className="jelly-btn h-8 rounded-xl text-xs" onClick={() => setScriptId(null)}>换个剧本</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 pt-2">
                {node.choices?.map((c, i) => (
                  <button key={i} type="button" onClick={() => setNodeId(c.next)} className={`jelly-btn glass-input block w-full rounded-xl px-3.5 py-2.5 text-left text-[12px] font-medium ${INK} hover:bg-primary/10`}>
                    <span className="mr-1.5 text-primary">◦</span>{fillScriptText(c.label, who?.name || "TA", characters)}
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
