// 语音通话 App：按键启停录音 → STT → 角色流式回复（首句先行合成）→ 队列化 TTS 播报。
// 实时性设计：松手即进"正在听…/在想…/开口了…"状态机；TA 说话时按麦克风 = 一键打断抢话；
// 失败自动重试一次，仍失败用兜底语音接话不冷场。通话内容只存独立 calllog，不进私聊对话框。
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronLeft, Download, Eye, Loader2, Mic, PhoneOff, Play, RotateCcw, Square, Volume2, VolumeX } from "lucide-react";
import type { AiConfig } from "@/lib/types";
import { isConfigured } from "@/lib/types";
import { displayName, splitBubbles, type Character } from "@/lib/chat-types";
import { useActiveCharId, useCharacters, useWorldBooks, usePersisted } from "@/lib/chat-store";
import { createRecorder, MAX_RECORD_SEC, micErrorMessage, type RecordedAudio } from "@/lib/recorder";
import { transcribeRecording, type SttResult } from "@/lib/stt";
import { streamCallReply, commitCallExchange } from "@/lib/call-reply";
import { analyzeTake, summarizeObservation, detectEmotion, cacheTake, listCachedTakes, EMOTION_INJECT_MIN, type TakeMetrics, type EmotionGuess } from "@/lib/call-observe";
import { loadVoiceConfig, synthesizeSpeech, voiceReady } from "@/lib/tts";

interface Props {
  config: AiConfig;
  onBack: () => void;
}

/** 通话阶段状态机：空闲 / 录音 / 正在听(STT) / 在想(LLM) / 开口了(TTS合成) / 说话中(播放) */
type Phase = "idle" | "recording" | "hearing" | "thinking" | "opening" | "speaking";

const FALLBACK_STT_LINES = ["喂？好像没听清，你再说一遍嘛。", "信号晃了一下，刚才那句没收到，重说一次好不好？"];
const FALLBACK_REPLY_LINES = ["信号好像不太好…我这边断断续续的，等下再说哈。", "哎呀突然听不清你了…你先别挂，我缓一下。"];
const pickLine = (pool: string[]) => pool[Math.floor(Math.random() * pool.length)];

export function VoiceCallApp({ config, onBack }: Props) {
  const characters = useCharacters()[0];
  const [activeId, setActiveId] = useActiveCharId(characters.map((c) => c.id));
  const ch: Character | undefined = characters.find((c) => c.id === activeId) ?? characters[0];
  const books = useWorldBooks()[0];

  const recRef = useRef<ReturnType<typeof createRecorder> | null>(null);
  const sessionStartRef = useRef(0);
  const [recording, setRecording] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const [take, setTake] = useState<RecordedAudio | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // ===== STT 转写状态机 =====
  const [sttState, setSttState] = useState<"idle" | "running" | "ok" | "fail">("idle");
  const [sttResult, setSttResult] = useState<SttResult | null>(null);
  const [sttError, setSttError] = useState("");
  // ===== 通话往来（你说 + TA 回），仅内存展示；记忆落独立 calllog，不进私聊对话框 =====
  const [callTurns, setCallTurns] = useState<{ you: string; reply: string[] | null; pending: boolean }[]>([]);
  const apiRetryRef = useRef(false);
  // ===== 队列化播报：LLM 每凑满一句立即入队合成，播完一句取下一句（300ms 平滑间隔）=====
  const [ttsError, setTtsError] = useState("");
  const [autoSpeak, setAutoSpeak] = usePersisted<boolean>("vp-phone:call-autospeak:v1", true);
  const speakUrlRef = useRef<string | null>(null);
  const speakAudioRef = useRef<HTMLAudioElement | null>(null);
  const queueRef = useRef<string[]>([]); // 待合成句子
  const playingRef = useRef(false); // 播放器占用标记
  const genRef = useRef(0); // 本轮代际号：打断/新轮次作废旧队列
  // ===== 观察层 =====
  const [observeOn] = usePersisted<boolean>("vp-phone:call-observe:v1", true);
  const [emotionOn] = usePersisted<boolean>("vp-phone:call-emotion:v1", false);
  const [takeMetrics, setTakeMetrics] = useState<TakeMetrics | null>(null);
  const [sessionMetrics, setSessionMetrics] = useState<TakeMetrics[]>([]);
  const [emotionGuess, setEmotionGuess] = useState<EmotionGuess | null>(null);
  const [emotionState, setEmotionState] = useState<"off" | "running" | "ok" | "fail">("off");
  const [obsOpen, setObsOpen] = useState(false);
  const [keepAudio, setKeepAudio] = useState(false);
  const [cacheMsg, setCacheMsg] = useState("");

  // 秒表（仅录音中走字）
  useEffect(() => {
    if (!recording) return;
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  // 离开页面释放麦克风与播报音频
  useEffect(() => {
    return () => {
      recRef.current?.cancel();
      speakAudioRef.current?.pause();
      if (speakUrlRef.current) URL.revokeObjectURL(speakUrlRef.current);
      if (playingUrl) URL.revokeObjectURL(playingUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingUrl]);

  /* ---------- 队列播放器（ref 持有，供 startRec/runReply 等更早声明处安全引用，规避 TDZ） ---------- */
  const stopAllSpeakRef = useRef<() => void>(() => {});
  const enqueueSentenceRef = useRef<(text: string) => void>(() => {});
  const markStreamEndRef = useRef<() => void>(() => {});
  const speakOneRef = useRef<(text: string, gen: number) => void>(() => {});

  /** 停止一切播报与排队：代际号作废 + 清空队列 + 停播释放 URL */
  stopAllSpeakRef.current = () => {
    genRef.current++;
    queueRef.current = [];
    playingRef.current = false;
    speakAudioRef.current?.pause();
    speakAudioRef.current = null;
    if (speakUrlRef.current) {
      URL.revokeObjectURL(speakUrlRef.current);
      speakUrlRef.current = null;
    }
  };

  /** 播放器核心：合成一句话并播放，onended 后间隔 300ms 取下一句 */
  speakOneRef.current = (text: string, gen: number) => {
    const vc = loadVoiceConfig();
    if (!voiceReady(vc, { baseUrl: config.baseUrl, apiKey: config.apiKey })) {
      setTtsError("语音通道还没配置好：去设置页 → 语音服务填好 Key 或聊天接口，TA 才能开口说话");
      setPhase("idle");
      playingRef.current = false;
      queueRef.current = [];
      return;
    }
    const voiceId = vc.provider === "minimax" ? ch?.minimaxVoiceId?.trim() || undefined : ch?.voiceId?.trim() || undefined;
    setPhase("opening");
    void (async () => {
      try {
        const url = await synthesizeSpeech(vc, { baseUrl: config.baseUrl, apiKey: config.apiKey }, text, voiceId);
        if (gen !== genRef.current) {
          URL.revokeObjectURL(url);
          return;
        }
        speakUrlRef.current = url;
        const a = new Audio(url);
        speakAudioRef.current = a;
        a.onended = () => {
          if (gen !== genRef.current) return;
          speakUrlRef.current = null;
          // 还有排队句子：300ms 平滑间隔后继续
          if (queueRef.current.length) {
            window.setTimeout(() => {
              if (gen !== genRef.current) return;
              const next = queueRef.current.shift();
              if (next) speakOneRef.current(next, gen);
              else { playingRef.current = false; setPhase("idle"); }
            }, 300);
          } else {
            playingRef.current = false;
            setPhase("idle");
          }
        };
        setPhase("speaking");
        await a.play();
        console.log(`[call-tts] play provider=${vc.provider} voice=${voiceId ?? "(默认)"} chars=${text.length}`);
      } catch (e) {
        if (gen !== genRef.current) return;
        playingRef.current = false;
        queueRef.current = [];
        setPhase("idle");
        setTtsError(e instanceof Error ? e.message : String(e));
        console.log(`[call-tts] fail ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  };

  /** LLM 吐出一句完整口语：autoSpeak 开启时立即入队/开播（首句先行，不等全文） */
  enqueueSentenceRef.current = (sentence: string) => {
    if (!autoSpeak || !sentence.trim()) return;
    const gen = genRef.current;
    if (playingRef.current) {
      queueRef.current.push(sentence);
    } else {
      playingRef.current = true;
      speakOneRef.current(sentence, gen);
    }
  };

  /** 全文流结束：若一句都没播过（极短回复无边界符），整段补一波；标记生成完毕 */
  markStreamEndRef.current = () => {
    // no-op 占位由 runReply 内部处理尾句，这里只负责收尾态
  };

  /** 兜底语音：STT/回复彻底失败时让 TA 口头接一句，电话不冷场（不入记忆） */
  const speakFallback = (line: string) => {
    if (!autoSpeak) return;
    if (playingRef.current) return;
    const gen = ++genRef.current;
    playingRef.current = true;
    speakOneRef.current(line, gen);
  };

  /* ---------- 录音链路 ---------- */

  const startRec = async () => {
    setError("");
    stopPlayback();
    // 一键打断：TA 正在说/正在合成/排队中 → 全部作废，立刻可插话
    if (playingRef.current || phase === "hearing" || phase === "thinking" || phase === "opening") {
      stopAllSpeakRef.current();
      console.log("[call-realtime] barge-in: 打断当前回应");
    }
    setTake(null);
    const rec = createRecorder();
    recRef.current = rec;
    try {
      await rec.start(
        (v) => setLevel(v),
        () => void autoFinish(),
      );
      setRecording(true);
      setPhase("recording");
      setElapsed(0);
      if (!sessionStartRef.current) sessionStartRef.current = Date.now();
    } catch (e) {
      rec.cancel();
      recRef.current = null;
      setPhase("idle");
      setError(micErrorMessage(e));
      console.log(`[call-rec] start fail ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** 手动或 60s 上限自动结束，统一走这里 */
  const finishRec = async () => {
    const rec = recRef.current;
    recRef.current = null;
    setRecording(false);
    setLevel(0);
    if (!rec) return;
    const result = await rec.stop();
    if (!result) {
      setPhase("idle");
      setError("没听到声音：请按住说话后再点结束，或检查麦克风是否被占用");
      return;
    }
    setTake(result);
    setPhase("hearing"); // 松手瞬间就有反馈："正在听…"
    console.log(`[call-rec] take ready ${result.durationSec}s ${(result.blob.size / 1024).toFixed(0)}KB`);
    // 观察层：本地声学指标（纯本机计算，不发任何请求）
    if (observeOn) {
      const m = analyzeTake(result.samples, result.durationSec);
      setTakeMetrics(m);
      setSessionMetrics((prev) => [...prev.slice(-9), m]);
      setObsOpen(false);
    } else {
      setTakeMetrics(null);
    }
    // 手动保留本段录音到本机 IndexedDB（默认不存，退出页面内存即失）
    if (keepAudio && ch) {
      void cacheTake({ id: `t${Date.now()}`, charId: ch.id, at: Date.now(), durationSec: result.durationSec, blob: result.blob })
        .then(() => setCacheMsg("已保留到本机浏览器"))
        .catch(() => setCacheMsg("本机存储不可用（隐私模式？），这段没存下"));
    }
    // 可选情绪接口：并行发起，绝不阻断转写/回复链路
    if (observeOn && emotionOn) {
      setEmotionState("running");
      setEmotionGuess(null);
      void detectEmotion(loadVoiceConfig(), result.blob).then((g) => {
        if (g) {
          setEmotionGuess(g);
          setEmotionState("ok");
        } else {
          setEmotionState("fail");
        }
      });
    }
    void runStt(result);
  };
  const autoFinish = () => void finishRec();

  /** STT 转写：失败自动重试一次，仍失败 → 兜底语音接话 */
  const runStt = async (audio: RecordedAudio, retried = false) => {
    setSttState("running");
    setSttResult(null);
    setSttError("");
    try {
      const r = await transcribeRecording(loadVoiceConfig(), audio, audio.samples);
      setSttResult(r);
      setSttState("ok");
      void runReply(r.text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!retried) {
        console.log(`[call-stt] fail(${msg})，自动重试一次`);
        void runStt(audio, true);
        return;
      }
      setSttError(msg);
      setSttState("fail");
      setPhase("idle");
      speakFallback(pickLine(FALLBACK_STT_LINES));
    }
  };

  /** 角色流式回复：首句就绪立即送 TTS；失败自动重试一次，仍失败 → 兜底语音 */
  const runReply = async (text: string, retried = false) => {
    if (!ch) return;
    if (!isConfigured(config)) {
      setPhase("idle");
      setError("AI 接口还没配置好：先去设置页填接口地址、API Key 和模型名，TA 才能接电话");
      return;
    }
    const turn = { you: text, reply: null as string[] | null, pending: true };
    setCallTurns((prev) => [...prev.slice(-4), turn]);
    apiRetryRef.current = false;
    setPhase("thinking");
    // 观察文本注入：本轮全部会话指标 + 最新情绪猜测；低置信度情绪不会出现在文本里
    const obsText = observeOn ? summarizeObservation(sessionMetrics.length ? sessionMetrics : takeMetrics ? [takeMetrics] : [], emotionState === "ok" ? emotionGuess : null) : "";
    const gen = ++genRef.current;
    let spokenAny = false;
    try {
      const reply = await streamCallReply(
        config,
        ch,
        books,
        text,
        obsText,
        (sentence) => {
          if (gen !== genRef.current) return; // 已被打断，迟到的句子丢弃
          spokenAny = true;
          enqueueSentenceRef.current(sentence);
        },
        () => undefined,
      );
      if (gen !== genRef.current) {
        // 用户中途抢话：这半句话不进记忆
        setCallTurns((prev) => prev.map((t) => (t === turn ? { ...t, pending: false } : t)));
        console.log("[call-realtime] interrupted，本轮不落库");
        return;
      }
      commitCallExchange(ch.id, text, reply);
      setCallTurns((prev) => prev.map((t) => (t === turn ? { ...t, reply: splitBubbles(reply), pending: false } : t)));
      // 首句都没来得及播（无标点短回复/关了自动播报后又开）：整段补播
      if (autoSpeak && !spokenAny) enqueueSentenceRef.current(reply.replace(/\r?\n/g, "，").trim());
      markStreamEndRef.current();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!retried && gen === genRef.current) {
        console.log(`[call-reply] fail(${msg})，自动重试一次`);
        void runReply(text, true);
        return;
      }
      commitCallExchange(ch.id, text, null);
      setCallTurns((prev) => prev.map((t) => (t === turn ? { ...t, pending: false } : t)));
      if (gen === genRef.current) {
        setPhase("idle");
        setError(`TA 没听清（回复生成失败）：${msg}`);
        speakFallback(pickLine(FALLBACK_REPLY_LINES));
      }
      console.log(`[call-reply] fail ${msg}`);
    }
  };

  /** 失败重试：拿上次的转写文本重新请求角色回复 */
  const retryReply = () => {
    if (!sttResult || apiRetryRef.current) return;
    apiRetryRef.current = true;
    setError("");
    void runReply(sttResult.text);
  };

  /** 手动"播一次"：整段一次性合成播放 */
  const startSpeakRef = useRef<(text: string) => void>(() => {});
  startSpeakRef.current = (text: string) => {
    stopAllSpeakRef.current();
    const gen = ++genRef.current;
    playingRef.current = true;
    speakOneRef.current(text, gen);
  };

  const playTake = () => {
    if (!take) return;
    stopPlayback();
    const url = URL.createObjectURL(take.blob);
    setPlayingUrl(url);
    const a = new Audio(url);
    audioRef.current = a;
    a.onended = () => {
      setPlayingUrl(null);
      URL.revokeObjectURL(url);
    };
    void a.play().catch(() => setError("本机播放器不允许自动播放，请再点一次试听"));
  };
  const stopPlayback = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingUrl((u) => {
      if (u) URL.revokeObjectURL(u);
      return null;
    });
  };
  const downloadTake = () => {
    if (!take) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(take.blob);
    a.download = `通话录音_${take.durationSec}s.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  /** 挂断：释放资源；若本通保留过录音，日志提示可在设置删除 */
  const hangup = () => {
    recRef.current?.cancel();
    stopAllSpeakRef.current();
    if (keepAudio) {
      void listCachedTakes().then((l) => {
        if (l.length) console.log(`[call-observe] hangup with ${l.length} cached takes（可在设置→通话观察删除）`);
      }).catch(() => undefined);
    }
    onBack();
  };

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  const busy = phase === "hearing" || phase === "thinking" || phase === "opening";
  const phaseText =
    phase === "recording" ? `录音中 ${fmt(elapsed)}`
    : phase === "hearing" ? "正在听…"
    : phase === "thinking" ? "在想怎么回你…"
    : phase === "opening" ? "开口了…"
    : phase === "speaking" ? "TA 正在说"
    : ch ? "等待拨打" : "还没有角色";

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-[oklch(0.96_0.025_85)] via-[oklch(0.94_0.035_78)] to-[oklch(0.91_0.045_70)]">
      {/* 顶栏 */}
      <header className="glass-nav flex items-center gap-2 px-3 pb-2 pt-10">
        <button type="button" onClick={onBack} aria-label="返回" className="jelly-icon -m-1 p-1 text-[oklch(0.4_0.04_80)]">
          <ChevronLeft className="size-5" />
        </button>
        <span className="text-[13px] font-semibold text-[oklch(0.34_0.04_80)]">语音通话</span>
        <span className={`ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] ${recording ? "bg-rose-100 text-rose-600" : phase === "speaking" ? "bg-violet-100 text-violet-600" : busy ? "bg-amber-100 text-amber-600" : "bg-white/60 text-[oklch(0.45_0.04_80)]"}`}>
          <span className={`size-1.5 rounded-full ${recording ? "animate-pulse bg-rose-500" : phase === "speaking" ? "animate-pulse bg-violet-500" : busy ? "animate-pulse bg-amber-500" : "bg-emerald-500"}`} />
          {phaseText}
        </span>
      </header>

      {/* 角色切换条 */}
      <div className="flex gap-2 overflow-x-auto px-3 py-2">
        {characters.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => !recording && setActiveId(c.id)}
            disabled={recording}
            className={`jelly-btn shrink-0 rounded-full border px-3 py-1.5 text-[11px] transition-colors ${c.id === activeId ? "border-[oklch(0.6_0.1_75)] bg-white/90 font-semibold text-[oklch(0.32_0.05_80)] shadow-sm" : "border-white/60 bg-white/50 text-[oklch(0.45_0.04_80)]"} ${recording ? "opacity-40" : ""}`}
          >
            {displayName(c)}
          </button>
        ))}
      </div>

      {/* 头像 + 名称 + 实时状态 */}
      <section className="flex flex-col items-center px-4 pt-4">
        <div className="relative">
          {recording && (
            <span className="absolute inset-0 animate-ping rounded-full bg-rose-300/40" style={{ animationDuration: "1.6s" }} />
          )}
          {phase === "speaking" && (
            <span className="absolute inset-0 animate-ping rounded-full bg-violet-300/40" style={{ animationDuration: "1.2s" }} />
          )}
          <span className="relative flex size-24 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-gradient-to-br from-[oklch(0.95_0.04_85)] to-[oklch(0.88_0.06_75)] shadow-[0_8px_24px_-8px_rgba(180,150,90,0.5)]">
            {ch?.avatar?.startsWith("data:") || ch?.avatar?.startsWith("http") ? (
              <img src={ch.avatar} alt="" className="size-full object-cover" />
            ) : (
              <span className="text-[36px]">{ch?.avatar || "💛"}</span>
            )}
          </span>
        </div>
        <p className="mt-3 text-[15px] font-bold tracking-wide text-[oklch(0.3_0.04_80)]">{ch ? displayName(ch) : "暂无可通话角色"}</p>
        <p className="mt-0.5 min-h-[14px] text-[10.5px] text-[oklch(0.45_0.04_80)]">
          {recording
            ? `最长 ${MAX_RECORD_SEC} 秒，说完点一下，TA 会马上回你`
            : phase === "speaking"
              ? "想插话？直接按麦克风就能打断"
              : busy
                ? phaseText
                : "按键开始 / 结束录音，全程自动应答"}
        </p>

        {/* 波形电平条：录音显示真实电平，TA 说话显示律动 */}
        <div className="mt-5 flex h-10 w-full max-w-[240px] items-center justify-center gap-[3px]">
          {Array.from({ length: 21 }).map((_, i) => {
            const centerBias = 1 - Math.abs(i - 10) / 14;
            const h = recording
              ? Math.max(4, level * 38 * centerBias * (0.6 + Math.random() * 0.7))
              : phase === "speaking"
                ? Math.max(4, 20 * centerBias * (0.5 + Math.random() * 0.8))
                : 4;
            return <span key={i} className={`w-[3px] rounded-full transition-[height] duration-75 ${recording ? "bg-rose-400/80" : phase === "speaking" ? "bg-violet-400/80" : "bg-[oklch(0.6_0.05_80/0.35)]"}`} style={{ height: `${h}px` }} />;
          })}
        </div>
      </section>

      {/* 错误提示（回复失败时带重试按钮） */}
      {error && (
        <div className="mx-4 mt-3 rounded-xl bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-600 ring-1 ring-rose-200/70">
          {error}
          {sttState === "ok" && sttResult && !callTurns[callTurns.length - 1]?.pending && (
            <button type="button" onClick={retryReply} className="jelly-btn ml-2 inline-flex items-center gap-1 rounded-full bg-white/85 px-2.5 py-0.5 text-[10.5px] font-medium text-rose-600 shadow-sm">
              <RotateCcw className="size-3" />
              重试回复
            </button>
          )}
        </div>
      )}

      {/* 转写结果区 */}
      {take && !recording && (
        <div className="mx-4 mt-3">
          {sttState === "running" && (
            <div className="glass flex items-center gap-2.5 rounded-2xl px-3.5 py-3 shadow-sm">
              <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
              <p className="text-[11.5px] text-[oklch(0.38_0.04_80)]">正在听这段 {take.durationSec} 秒的话…</p>
            </div>
          )}
          {sttState === "ok" && sttResult && (
            <div className="glass rounded-2xl p-3.5 shadow-sm">
              <div className="flex items-center gap-2 text-[10px] font-semibold tracking-wide text-[oklch(0.45_0.05_80)]">
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-600">转写成功</span>
                <span className="ml-auto tabular-nums">置信度 {sttResult.confidence}% · 本地估算</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-[oklch(0.28_0.04_80)]">“{sttResult.text}”</p>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/70">
                <div className="h-full rounded-full bg-gradient-to-r from-[oklch(0.72_0.14_75)] to-[oklch(0.6_0.13_70)] transition-all duration-700" style={{ width: `${sttResult.confidence}%` }} />
              </div>
              <p className="mt-1.5 text-[9.5px] leading-snug text-[oklch(0.55_0.03_80)]">置信度由本地音量与有效语音占比估算（MiniMax 接口本身不返回模型置信度）· 音频 {sttResult.durationSec}s{sttResult.traceId ? ` · trace ${sttResult.traceId.slice(0, 12)}` : ""}</p>
              {/* TA 的通话回复（pending → 逐句气泡；文字随流式增长） */}
              {(() => {
                const turn = callTurns[callTurns.length - 1];
                if (!turn || turn.you !== sttResult.text) return null;
                if (turn.pending) {
                  return (
                    <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-white/70 px-3 py-2 text-[11px] text-[oklch(0.42_0.04_80)]">
                      <Loader2 className="size-3.5 animate-spin text-primary" />
                      {displayName(ch!)}{phase === "opening" ? "正在开口…" : phase === "speaking" ? "正在说…" : "在想怎么回你…"}
                    </div>
                  );
                }
                if (!turn.reply) return null;
                return (
                  <div className="mt-2.5 space-y-1.5 border-t border-white/60 pt-2.5">
                    <div className="flex items-center gap-2">
                      <p className="text-[9.5px] font-semibold tracking-wide text-[oklch(0.5_0.04_80)]">{displayName(ch!)}说</p>
                      <button
                        type="button"
                        onClick={() => setAutoSpeak((v) => !v)}
                        className={`jelly-btn ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] ${autoSpeak ? "bg-emerald-100 text-emerald-600" : "bg-white/60 text-[oklch(0.5_0.03_80)]"}`}
                      >
                        {autoSpeak ? <Volume2 className="size-3" /> : <VolumeX className="size-3" />}
                        自动播报{autoSpeak ? "开" : "关"}
                      </button>
                      {phase === "opening" && (
                        <span className="flex items-center gap-1 text-[9.5px] text-[oklch(0.5_0.04_80)]">
                          <Loader2 className="size-3 animate-spin text-primary" />
                          正在合成语音…
                        </span>
                      )}
                      {phase === "speaking" && (
                        <button type="button" onClick={() => { stopAllSpeakRef.current(); setPhase("idle"); }} className="jelly-btn flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[9.5px] text-rose-600">
                          <Square className="size-2.5" />
                          停止播报
                        </button>
                      )}
                      {!autoSpeak && phase === "idle" && (
                        <button
                          type="button"
                          onClick={() => startSpeakRef.current(turn.reply!.join("，"))}
                          className="jelly-btn flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[9.5px] text-[oklch(0.4_0.04_80)]"
                        >
                          <Volume2 className="size-3" />
                          播一次
                        </button>
                      )}
                    </div>
                    {turn.reply.map((b, i) => (
                      <div key={i} className="bubble-cream w-fit max-w-[92%] px-3 py-1.5 text-[12.5px] leading-relaxed text-[oklch(0.28_0.04_80)]">
                        {b}
                      </div>
                    ))}
                    {ttsError && (
                      <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-[10px] leading-relaxed text-amber-700 ring-1 ring-amber-200/60">语音没放出来：{ttsError}</p>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
          {sttState === "fail" && (
            <div className="rounded-2xl bg-rose-50 p-3.5 ring-1 ring-rose-200/70">
              <p className="text-[11.5px] font-semibold text-rose-600">转写失败（已自动重试过一次）</p>
              <p className="mt-1 text-[11px] leading-relaxed text-rose-500">{sttError}</p>
              <button type="button" onClick={() => take && runStt(take)} className="jelly-btn mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-white/85 px-3.5 py-1.5 text-[11px] font-medium text-rose-600 shadow-sm">
                <RotateCcw className="size-3.5" />
                再试一次
              </button>
            </div>
          )}
        </div>
      )}

      {/* 本段录音结果 */}
      {take && !recording && (
        <div className="glass mx-4 mt-3 rounded-2xl p-3 shadow-sm">
          <div className="flex items-center gap-2 text-[11.5px] font-semibold text-[oklch(0.34_0.04_80)]">
            <Mic className="size-3.5 text-primary" />
            录音 {take.durationSec} 秒 · WAV 16kHz 单声道（{(take.blob.size / 1024).toFixed(0)} KB）
            <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-medium text-emerald-600">格式合规</span>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-[oklch(0.5_0.03_80)]">实时链路：说完松手 → 自动转写 → 首句一成型就合成语音，边生成边播；TA 说话时按麦克风可直接打断。</p>
          {/* 观察层折叠条 */}
          {observeOn && takeMetrics && (
            <div className="mt-2 rounded-xl bg-white/60">
              <button type="button" onClick={() => setObsOpen((v) => !v)} className="jelly-btn flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left">
                <Eye className="size-3.5 shrink-0 text-[oklch(0.5_0.05_75)]" />
                <span className="text-[10.5px] font-medium text-[oklch(0.38_0.04_80)]">
                  通话观察：{takeMetrics.pauseCount ? `${takeMetrics.pauseCount} 次停顿` : "无明显停顿"} · {takeMetrics.volumeTrend === "falling" ? "声音渐轻" : takeMetrics.volumeTrend === "rising" ? "声音渐强" : "音量平稳"}
                  {emotionState === "running" && " · 情绪分析中…"}
                  {emotionState === "ok" && emotionGuess && ` · 接口粗判「${emotionGuess.label}」${emotionGuess.confidence}%`}
                </span>
                <ChevronDown className={`ml-auto size-3.5 shrink-0 text-[oklch(0.55_0.03_80)] transition-transform ${obsOpen ? "rotate-180" : ""}`} />
              </button>
              {obsOpen && (
                <div className="border-t border-white/70 px-2.5 py-2 text-[10px] leading-relaxed text-[oklch(0.4_0.04_80)]">
                  <ul className="space-y-0.5">
                    <li>本通累计说话 {(sessionMetrics.reduce((n, m) => n + m.durationSec, 0)).toFixed(1)} 秒 · 共 {sessionMetrics.reduce((n, m) => n + m.pauseCount, 0)} 次停顿 · 最长停顿 {Math.max(0, ...sessionMetrics.map((m) => m.longestPauseSec))} 秒</li>
                    <li>本段：语音占比 {(takeMetrics.speechRatio * 100).toFixed(0)}% · 平均响度 {(takeMetrics.meanVolume * 100).toFixed(1)}</li>
                    {emotionState === "ok" && emotionGuess && (
                      <li className={emotionGuess.confidence >= EMOTION_INJECT_MIN ? "text-violet-600" : "text-[oklch(0.55_0.03_80)]"}>
                        情绪猜测「{emotionGuess.label}」置信度 {emotionGuess.confidence}%{emotionGuess.confidence < EMOTION_INJECT_MIN ? "（低于 55%，不会告诉 TA）" : "（已以推测口吻给到 TA）"}
                      </li>
                    )}
                    {emotionState === "fail" && <li className="text-amber-600">情绪接口没返回结果——已静默跳过，只保留本地指标，通话不受影响</li>}
                    {emotionState === "off" && <li className="text-[oklch(0.55_0.03_80)]">情绪分析未开启（设置→通话观察），当前只有 100% 本地计算的声学指标</li>}
                  </ul>
                  <p className="mt-1.5 border-t border-dashed border-[oklch(0.85_0.02_80)] pt-1.5 text-[9px] text-[oklch(0.55_0.03_80)]">
                    隐私说明：停顿/时长/音量全部在本机计算、从不上传；录音默认只在内存，退出页面即消失。会离开设备的只有两样——送 MiniMax 转写的音频（B 步既有行为）和开启后的情绪接口请求。观察只是粗略推测，不准是常态。
                  </p>
                </div>
              )}
            </div>
          )}
          <div className="mt-2.5 flex gap-2">
            <button type="button" onClick={playingUrl ? stopPlayback : playTake} className="jelly-btn flex flex-1 items-center justify-center gap-1.5 rounded-full bg-white/85 py-2 text-[11.5px] font-medium text-[oklch(0.34_0.05_80)] shadow-sm">
              {playingUrl ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
              {playingUrl ? "停止试听" : "试听本段"}
            </button>
            <button type="button" onClick={downloadTake} className="jelly-btn flex items-center justify-center gap-1.5 rounded-full bg-white/60 px-4 py-2 text-[11.5px] text-[oklch(0.4_0.04_80)]">
              <Download className="size-3.5" />
              下载 .wav
            </button>
          </div>
          {/* 保留录音开关 */}
          {observeOn && (
            <div className="mt-2 flex items-center gap-2 border-t border-white/60 pt-2">
              <button
                type="button"
                onClick={() => setKeepAudio((v) => !v)}
                className={`jelly-btn flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-medium ${keepAudio ? "bg-violet-100 text-violet-600" : "bg-white/70 text-[oklch(0.45_0.04_80)]"}`}
              >
                {keepAudio ? "✓ 每段录音保留到本机" : "保留本通电话的录音"}
              </button>
              <span className="text-[9px] leading-snug text-[oklch(0.55_0.03_80)]">{keepAudio ? "存在这台手机的浏览器里，设置→通话观察可删" : "默认不保存，挂断退出后内存即清空"}</span>
              {cacheMsg && <span className="ml-auto shrink-0 text-[9.5px] text-emerald-600">{cacheMsg}</span>}
            </div>
          )}
        </div>
      )}

      {/* 主操作按钮 */}
      <footer className="mt-auto flex items-end justify-center gap-8 pb-14">
        <button
          type="button"
          onClick={hangup}
          className="jelly-btn flex size-14 flex-col items-center justify-center gap-0.5 rounded-full bg-[oklch(0.9_0.02_80/0.8)] text-[oklch(0.4_0.05_80)] shadow-md"
          aria-label="挂断返回"
        >
          <PhoneOff className="size-5" />
          <span className="text-[8px]">挂断</span>
        </button>
        <button
          type="button"
          onClick={recording ? finishRec : startRec}
          disabled={!ch}
          className={`jelly-btn relative flex size-[76px] items-center justify-center rounded-full text-white shadow-lg transition-transform ${recording ? "bg-gradient-to-br from-rose-500 to-rose-600 shadow-rose-300/60" : "bg-gradient-to-br from-[oklch(0.72_0.14_75)] to-[oklch(0.6_0.13_70)] shadow-[0_10px_28px_-8px_rgba(190,150,80,0.7)]"} ${!ch ? "opacity-40" : ""}`}
          aria-label={recording ? "结束录音" : phase === "speaking" ? "打断并开始说话" : "开始录音"}
        >
          {recording && <span className="absolute inset-0 animate-ping rounded-full bg-rose-400/40" style={{ animationDuration: "1.2s" }} />}
          <Mic className={`relative size-8 ${recording ? "animate-pulse" : ""}`} />
        </button>
        <span className="flex size-14 items-center justify-center text-[10px] leading-tight text-[oklch(0.5_0.04_80)]">
          {recording ? "点击结束" : phase === "speaking" ? "按我打断" : busy ? "按我可取消" : "点击开始"}
        </span>
      </footer>
    </div>
  );
}
