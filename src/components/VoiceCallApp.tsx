// 语音通话 App（步骤A）：按键启停录音 + 时长/波形 + 试听与下载；B/C/D 后续在此链路上叠加
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Download, Mic, PhoneOff, Play, Square } from "lucide-react";
import type { AiConfig, ScreenId } from "@/lib/types";
import { displayName, type Character } from "@/lib/chat-types";
import { useActiveCharId, useCharacters } from "@/lib/chat-store";
import { createRecorder, MAX_RECORD_SEC, micErrorMessage, type RecordedAudio } from "@/lib/recorder";

interface Props {
  config: AiConfig;
  onBack: () => void;
}

export function VoiceCallApp({ onBack }: Props) {
  const characters = useCharacters()[0];
  const [activeId, setActiveId] = useActiveCharId(characters.map((c) => c.id));
  const ch: Character | undefined = characters.find((c) => c.id === activeId) ?? characters[0];

  const recRef = useRef<ReturnType<typeof createRecorder> | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState("");
  const [take, setTake] = useState<RecordedAudio | null>(null);
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 秒表（仅录音中走字）
  useEffect(() => {
    if (!recording) return;
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  // 离开页面释放麦克风
  useEffect(() => {
    return () => {
      recRef.current?.cancel();
      if (playingUrl) URL.revokeObjectURL(playingUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingUrl]);

  const startRec = async () => {
    setError("");
    stopPlayback();
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
  };
  const autoFinish = () => void finishRec();

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

      {/* 错误提示 */}
      {error && (
        <div className="mx-4 mt-3 rounded-xl bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-600 ring-1 ring-rose-200/70">{error}</div>
      )}

      {/* 本段录音结果 */}
      {take && !recording && (
        <div className="glass mx-4 mt-3 rounded-2xl p-3 shadow-sm">
          <div className="flex items-center gap-2 text-[11.5px] font-semibold text-[oklch(0.34_0.04_80)]">
            <Mic className="size-3.5 text-primary" />
            录音 {take.durationSec} 秒 · WAV 16kHz 单声道（{(take.blob.size / 1024).toFixed(0)} KB）
            <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-medium text-emerald-600">格式合规</span>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-[oklch(0.5_0.03_80)]">下一步将把这段音频送去 MiniMax 语音转文字（STT），当前版本先支持试听与下载核对。</p>
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
