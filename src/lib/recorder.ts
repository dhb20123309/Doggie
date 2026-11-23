// 语音通话录音层（步骤A）：按键启停 + getUserMedia 权限 + WAV(16kHz/单声道) 编码，符合 MiniMax STT 接口要求
// 不做自动 VAD、不做后台连续监听——只有点「开始」到点「结束」之间才采集音频。

export interface RecordedAudio {
  /** 完整 WAV Blob（RIFF header + PCM16），可直接作为 multipart file 上传 STT */
  blob: Blob;
  /** base64（不含 data: 前缀）的 WAV，供 JSON body 的 audio 字段使用 */
  base64: string;
  /** MIME 类型（audio/wav） */
  mimeType: string;
  /** 录音时长（秒，保留一位小数） */
  durationSec: number;
  /** 采样率（固定 16000，MiniMax STT 推荐值） */
  sampleRate: number;
}

/** 单段录音上限：60 秒，超时自动结束 */
export const MAX_RECORD_SEC = 60;

/** 把 getUserMedia 错误翻译成人话 */
export function micErrorMessage(e: unknown): string {
  if (typeof DOMException !== "undefined" && e instanceof DOMException) {
    switch (e.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return "麦克风权限被拒绝：请在浏览器地址栏/系统设置里允许本站使用麦克风后，再点一次开始录音";
      case "NotFoundError":
      case "DevicesNotFoundError":
        return "没有检测到麦克风设备：请确认已连接麦克风或耳机后再试";
      case "NotReadableError":
        return "麦克风被其他程序占用：关掉正在录音的应用（会议/录屏等）再试";
      case "SecurityError":
        return "当前页面不是安全环境（需 HTTPS），浏览器禁止调用麦克风";
      default:
        return `无法开启麦克风：${e.message || e.name}`;
    }
  }
  return "无法开启麦克风：未知错误，请检查浏览器权限设置";
}

/**
 * 创建一段按键式录音器。生命周期：start() → （onLevel 回调实时电平）→ stop() 得到合规 WAV。
 * 同一时刻只允许一段录音；stop 后实例作废，重新录音需再建。
 */
export function createRecorder() {
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let node: ScriptProcessorNode | null = null;
  let chunks: Float32Array[] = [];
  let sourceSampleRate = 0;
  let startedAt = 0;
  let timer: number | null = null;
  let analyser: AnalyserNode | null = null;
  let rafId: number | null = null;
  let levelBuf: Uint8Array<ArrayBuffer> | null = null;
  let stopped = false;

  /** 请求权限并开始采集；失败抛出人话错误（由调用方 catch 展示）。onAutoStop：达到 60s 上限自动结束 */
  async function start(onLevel?: (v: number) => void, onAutoStop?: () => void): Promise<void> {
    if (stream) throw new Error("已在录音中");
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前浏览器不支持麦克风录音（需在 HTTPS 环境的现代浏览器中使用）");
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    sourceSampleRate = ctx.sampleRate;
    const src = ctx.createMediaStreamSource(stream);

    // 采集：ScriptProcessor 逐块缓存原始 Float32（停止时统一重采样为 16k，兼容性最好且无需 OfflineContext）
    node = ctx.createScriptProcessor(4096, 1, 1);
    node.onaudioprocess = (e) => {
      if (stopped) return;
      const inp = e.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(inp));
    };
    src.connect(node);
    node.connect(ctx.destination);

    // 电平表（波形条用）
    if (onLevel) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      levelBuf = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (stopped || !analyser || !levelBuf) return;
        analyser.getByteTimeDomainData(levelBuf);
        let peak = 0;
        for (let i = 0; i < levelBuf.length; i++) peak = Math.max(peak, Math.abs(levelBuf[i] - 128));
        onLevel(Math.min(1, peak / 96));
        rafId = requestAnimationFrame(tick);
      };
      tick();
    }

    startedAt = Date.now();
    timer = window.setTimeout(() => {
      // 60 秒硬上限自动结束：先取走结果再通知界面
      void finish().then((r) => {
        if (r) onAutoStop?.();
      });
    }, MAX_RECORD_SEC * 1000);
    console.log(`[call-rec] start mic ok sampleRate=${sourceSampleRate}`);
  }

  /** 是否处于录音中 */
  function isRecording(): boolean {
    return Boolean(stream) && !stopped;
  }

  function release(): void {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    if (rafId != null) cancelAnimationFrame(rafId);
    rafId = null;
    node?.disconnect();
    analyser?.disconnect();
    node = null;
    analyser = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    void ctx?.close().catch(() => undefined);
    ctx = null;
  }

  /** 结束录音并输出合规 WAV；没录到声音返回 null（调用方提示"没听到声音"） */
  async function finish(): Promise<RecordedAudio | null> {
    if (!ctx || stopped) {
      release();
      return null;
    }
    const durationSec = Math.round(((Date.now() - startedAt) / 1000) * 10) / 10;
    const raw = mergeChunks(chunks);
    release();
    if (!raw || raw.length < sourceSampleRate * 0.2) {
      console.log(`[call-rec] stop too short duration=${durationSec}s`);
      return null;
    }
    const pcm16k = downmixTo16k(raw, sourceSampleRate);
    const wav = encodeWav(pcm16k, 16000);
    const base64 = await blobToBase64(wav);
    console.log(`[call-rec] stop ok duration=${durationSec}s bytes=${wav.size} sr=16000 mono=1`);
    return { blob: wav, base64, mimeType: "audio/wav", durationSec, sampleRate: 16000 };
  }

  /** 放弃本段录音（取消/退出通话时释放设备） */
  function cancel(): void {
    release();
    chunks = [];
  }

  return { start, stop: finish, cancel, isRecording };
}

/* ---------- 纯函数：合并 / 重采样 / WAV 编码（可单测） ---------- */

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** 线性插值重采样到目标采样率（语音场景足够，且天然把任意输入统一到 16k 单声道） */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = input[i0] + (input[i1] - input[i0]) * (pos - i0);
  }
  return out;
}

function downmixTo16k(input: Float32Array, fromRate: number): Float32Array {
  return resampleLinear(input, fromRate, 16000);
}

/** PCM16 小端 + RIFF/WAVE 头（mono） */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)));
  }
  return btoa(bin);
}
