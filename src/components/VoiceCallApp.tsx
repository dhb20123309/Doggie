// 语音通话 App（步骤A+B+C+D）：按键启停录音 → MiniMax STT 转文字 → 角色生成通话回复 → MiniMax TTS 播放（角色绑定音色）
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Download, Loader2, Mic, PhoneOff, Play, RotateCcw, Square, Volume2, VolumeX } from "lucide-react";
import type { AiConfig, ScreenId } from "@/lib/types";
import { isConfigured } from "@/lib/types";
import { displayName, splitBubbles, type Character } from "@/lib/chat-types";
import { useActiveCharId, useCharacters, useWorldBooks, usePersisted } from "@/lib/chat-store";
import { createRecorder, MAX_RECORD_SEC, micErrorMessage, type RecordedAudio } from "@/lib/recorder";
import { transcribeRecording, type SttResult } from "@/lib/stt";
import { requestCallReply, commitCallExchange } from "@/lib/call-reply";
import { loadVoiceConfig, synthesizeSpeech, voiceReady } from "@/lib/tts";

interface Props {
  config: AiConfig;
  onBack: () => void;
}

export function VoiceCallApp({ config, onBack }: Props) {
  const characters = useCharacters()[0];
  const [activeId, setActiveId] = useActiveCharId(characters.map((c) => c.id));
  const ch: Character | undefined = characters.find((c) => c.id === activeId) ?? characters[0];
  const books = useWorldBooks()[0];

  const recRef = useRef<ReturnType<typeof createRecorder> | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const [take, setTake] = useState<RecordedAudio | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // ===== 步骤B：STT 转写状态机 idle → running → ok / fail =====
  const [sttState, setSttState] = useState<"idle" | "running" | "ok" | "fail">("idle");
  const [sttResult, setSttResult] = useState<SttResult | null>(null);
  const [sttError, setSttError] = useState("");
  // ===== 步骤C：通话往来（你说 + TA 回），仅内存展示，落库走 rolechat-log 与聊天页记忆互通 =====
  const [callTurns, setCallTurns] = useState<{ you: string; reply: string[] | null; pending: boolean }[]>([]);
  const apiRetryRef = useRef(false);
  // ===== 步骤D：TA 的回复自动送 MiniMax TTS 合成播放（角色绑定音色优先）=====
  const [ttsState, setTtsState] = useState<"idle" | "synth" | "playing">("idle");
  const [ttsError, setTtsError] = useState("");
  const [autoSpeak, setAutoSpeak] = usePersisted<boolean>("vp-phone:call-autospeak:v1", true);
  const speakUrlRef = useRef<string | null>(null);
  const speakGenRef = useRef(0);

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

  const startRec = async () => {
    setError("");
    stopPlayback();
    stopSpeakRef.current();
    setTake(null);
    const rec = createRecorder();
    recRef.current = rec;
    try {
      await rec.start(
        (v) => setLevel(v),
        () => void autoFinish(),
      );
      setRecording(true);
      setElapsed(0);
    } catch (e) {
      rec.cancel();
      recRef.current = null;
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
      setError("没听到声音：请按住说话后再点结束，或检查麦克风是否被占用");
      return;
    }
    setTake(result);
    console.log(`[call-rec] take ready ${result.durationSec}s ${(result.blob.size / 1024).toFixed(0)}KB`);
    void runStt(result);
  };
  const autoFinish = () => void finishRec();

  /** 步骤B：把本段录音送去 MiniMax STT 转写 */
  const runStt = async (audio: RecordedAudio) => {
    setSttState("running");
    setSttResult(null);
    setSttError("");
    try {
      const r = await transcribeRecording(loadVoiceConfig(), audio, audio.samples);
      setSttResult(r);
      setSttState("ok");
      void runReply(r.text);
    } catch (e) {
      setSttError(e instanceof Error ? e.message : String(e));
      setSttState("fail");
    }
  };

  /** 步骤C：把转写文本交给当前角色生成通话回复（写入 rolechat-log，聊天页同步可见） */
  const runReply = async (text: string) => {
    if (!ch) return;
    if (!isConfigured(config)) {
      setError("AI 接口还没配置好：先去设置页填接口地址、API Key 和模型名，TA 才能接电话");
      return;
    }
    const turn = { you: text, reply: null as string[] | null, pending: true };
    setCallTurns((prev) => [...prev.slice(-4), turn]);
    apiRetryRef.current = false;
    try {
      const reply = await requestCallReply(config, ch, books, text);
      commitCallExchange(ch.id, text, reply);
      setCallTurns((prev) => prev.map((t) => (t === turn ? { ...t, reply: splitBubbles(reply), pending: false } : t)));
      // 步骤D：自动播报（开关可关）——多条气泡拼成一段连续口语再合成
      if (autoSpeak) startSpeakRef.current(reply.replace(/\r?\n/g, "，"));
    } catch (e) {
      commitCallExchange(ch.id, text, null);
      const msg = e instanceof Error ? e.message : String(e);
      setCallTurns((prev) => prev.map((t) => (t === turn ? { ...t, pending: false } : t)));
      setError(`TA 没听清（回复生成失败）：${msg}`);
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

  /** 步骤D：把 TA 的回复文本送 TTS 合成并播放。音色优先级：
   *  minimax 通道 → ch.minimaxVoiceId（角色绑定）→ vc.minimaxVoice；openai 通道 → ch.voiceId → 默认。
   *  gen 代际号防竞态：新一段播报开始时作废旧的合成/播放结果。 */
  const speakReply = async (text: string) => {
    const vc = loadVoiceConfig();
    if (!voiceReady(vc, { baseUrl: config.baseUrl, apiKey: config.apiKey })) {
      setTtsError("语音通道还没配置好：去设置页 → 语音服务填好 Key 或聊天接口，TA 才能开口说话");
      return;
    }
    const voiceId = vc.provider === "minimax" ? ch?.minimaxVoiceId?.trim() || undefined : ch?.voiceId?.trim() || undefined;
    const gen = ++speakGenRef.current;
    setTtsState("synth");
    setTtsError("");
    stopSpeakRef.current();
    try {
      const url = await synthesizeSpeech(vc, { baseUrl: config.baseUrl, apiKey: config.apiKey }, text, voiceId);
      if (gen !== speakGenRef.current) {
        URL.revokeObjectURL(url);
        return;
      }
      speakUrlRef.current = url;
      const a = new Audio(url);
      speakAudioRef.current = a;
      a.onended = () => {
        if (gen === speakGenRef.current) setTtsState("idle");
      };
      setTtsState("playing");
      await a.play();
      console.log(`[call-tts] play provider=${vc.provider} voice=${voiceId ?? "(默认)"} chars=${text.length}`);
    } catch (e) {
      if (gen !== speakGenRef.current) return;
      setTtsState("idle");
      setTtsError(e instanceof Error ? e.message : String(e));
      console.log(`[call-tts] fail ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const speakAudioRef = useRef<HTMLAudioElement | null>(null);
  // ref 持有 stop/合成启动器，供 startRec / runReply 等更早声明的回调安全引用（规避函数声明顺序 TDZ）
  const stopSpeakRef = useRef<() => void>(() => {});
  const startSpeakRef = useRef<(text: string) => void>(() => {});
  /** 步骤D：停止/释放 TA 播报（不影响自己录音的试听）。只走 ref 调用。 */
  stopSpeakRef.current = () => {
    speakGenRef.current++;
    speakAudioRef.current?.pause();
    speakAudioRef.current = null;
    if (speakUrlRef.current) {
      URL.revokeObjectURL(speakUrlRef.current);
      speakUrlRef.current = null;
    }
    setTtsState("idle");
  };
  /** fire-and-forget 启动一段播报（runReply 自动播与"播一次"按钮共用入口） */
  startSpeakRef.current = (text: string) => {
    void speakReply(text);
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

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="flex h-full flex-col bg-gradient-to-b from-[oklch(0.96_0.025_85)] via-[oklch(0.94_0.035_78)] to-[oklch(0.91_0.045_70)]">
      {/* 顶栏 */}
      <header className="glass-nav flex items-center gap-2 px-3 pb-2 pt-10">
        <button type="button" onClick={onBack} aria-label="返回" className="jelly-icon -m-1 p-1 text-[oklch(0.4_0.04_80)]">
          <ChevronLeft className="size-5" />
        </button>
        <span className="text-[13px] font-semibold text-[oklch(0.34_0.04_80)]">语音通话</span>
        <span className={`ml-auto flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] ${recording ? "bg-rose-100 text-rose-600" : "bg-white/60 text-[oklch(0.45_0.04_80)]"}`}>
          <span className={`size-1.5 rounded-full ${recording ? "animate-pulse bg-rose-500" : "bg-emerald-500"}`} />
          {recording ? `录音中 ${fmt(elapsed)}` : ch ? "等待拨打" : "还没有角色"}
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

      {/* 头像 + 名称 */}
      <section className="flex flex-col items-center px-4 pt-4">
        <div className="relative">
          {recording && (
            <span className="absolute inset-0 animate-ping rounded-full bg-rose-300/40" style={{ animationDuration: "1.6s" }} />
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
        <p className="mt-0.5 text-[10.5px] text-[oklch(0.45_0.04_80)]">{recording ? `最长 ${MAX_RECORD_SEC} 秒，到点自动结束` : "按键开始 / 结束录音，不做后台监听"}</p>

        {/* 波形电平条 */}
        <div className="mt-5 flex h-10 w-full max-w-[240px] items-center justify-center gap-[3px]">
          {Array.from({ length: 21 }).map((_, i) => {
            const centerBias = 1 - Math.abs(i - 10) / 14;
            const h = recording ? Math.max(4, level * 38 * centerBias * (0.6 + Math.random() * 0.7)) : 4;
            return <span key={i} className={`w-[3px] rounded-full transition-[height] duration-75 ${recording ? "bg-rose-400/80" : "bg-[oklch(0.6_0.05_80/0.35)]"}`} style={{ height: `${h}px` }} />;
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

      {/* 步骤B：转写结果区 */}
      {take && !recording && (
        <div className="mx-4 mt-3">
          {sttState === "running" && (
            <div className="glass flex items-center gap-2.5 rounded-2xl px-3.5 py-3 shadow-sm">
              <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
              <p className="text-[11.5px] text-[oklch(0.38_0.04_80)]">正在转写这段 {take.durationSec} 秒的语音…</p>
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
              {/* 步骤C：TA 的通话回复（pending → 气泡 / error 条兜底展示失败原因） */}
              {(() => {
                const turn = callTurns[callTurns.length - 1];
                if (!turn || turn.you !== sttResult.text) return null;
                if (turn.pending) {
                  return (
                    <div className="mt-2.5 flex items-center gap-2 rounded-xl bg-white/70 px-3 py-2 text-[11px] text-[oklch(0.42_0.04_80)]">
                      <Loader2 className="size-3.5 animate-spin text-primary" />
                      {displayName(ch!)}正在思考怎么回你…
                    </div>
                  );
                }
                if (!turn.reply) return null;
                return (
                  <div className="mt-2.5 space-y-1.5 border-t border-white/60 pt-2.5">
                    <div className="flex items-center gap-2">
                      <p className="text-[9.5px] font-semibold tracking-wide text-[oklch(0.5_0.04_80)]">{displayName(ch!)}说</p>
                      {/* 步骤D：自动播报开关 + 合成/播放状态 */}
                      <button
                        type="button"
                        onClick={() => setAutoSpeak((v) => !v)}
                        className={`jelly-btn ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] ${autoSpeak ? "bg-emerald-100 text-emerald-600" : "bg-white/60 text-[oklch(0.5_0.03_80)]"}`}
                      >
                        {autoSpeak ? <Volume2 className="size-3" /> : <VolumeX className="size-3" />}
                        自动播报{autoSpeak ? "开" : "关"}
                      </button>
                      {ttsState === "synth" && (
                        <span className="flex items-center gap-1 text-[9.5px] text-[oklch(0.5_0.04_80)]">
                          <Loader2 className="size-3 animate-spin text-primary" />
                          正在合成语音…
                        </span>
                      )}
                      {ttsState === "playing" && (
                        <button type="button" onClick={() => stopSpeakRef.current()} className="jelly-btn flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[9.5px] text-rose-600">
                          <Square className="size-2.5" />
                          停止播报
                        </button>
                      )}
                      {!autoSpeak && ttsState === "idle" && (
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
              <p className="text-[11.5px] font-semibold text-rose-600">转写失败</p>
              <p className="mt-1 text-[11px] leading-relaxed text-rose-500">{sttError}</p>
              <button type="button" onClick={() => take && runStt(take)} className="jelly-btn mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-white/85 px-3.5 py-1.5 text-[11px] font-medium text-rose-600 shadow-sm">
                <RotateCcw className="size-3.5" />
                重试转写
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
          <p className="mt-1 text-[10px] leading-relaxed text-[oklch(0.5_0.03_80)]">完整链路已接通：录音 → STT 转文字 → TA 生成通话回复 → MiniMax TTS 语音播报（音色跟随角色绑定）。</p>
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
        </div>
      )}

      {/* 主操作按钮 */}
      <footer className="mt-auto flex items-end justify-center gap-8 pb-14">
        <button
          type="button"
          onClick={onBack}
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
          aria-label={recording ? "结束录音" : "开始录音"}
        >
          {recording && <span className="absolute inset-0 animate-ping rounded-full bg-rose-400/40" style={{ animationDuration: "1.2s" }} />}
          <Mic className={`relative size-8 ${recording ? "animate-pulse" : ""}`} />
        </button>
        <span className="flex size-14 items-center justify-center text-[10px] leading-tight text-[oklch(0.5_0.04_80)]">
          {recording ? "点击结束" : "点击开始"}
        </span>
      </footer>
    </div>
  );
}
