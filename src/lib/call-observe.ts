// 语音通话第4步「观察层」：本地声学观察（停顿/语速/音量趋势）+ 可选情绪接口 + 本机录音缓存
// ⚠️ 设计原则：情绪判断永远不是事实——低置信度不注入、措辞一律"可能/推测"、不做医疗诊断。
import type { VoiceConfig } from "./tts";

/** 单段录音的本地声学指标（100% 本机计算，从不上传） */
export interface TakeMetrics {
  durationSec: number;
  /** 停顿次数（连续静音 ≥350ms 记一次，句首句尾不计） */
  pauseCount: number;
  /** 最长停顿（秒） */
  longestPauseSec: number;
  /** 有效语音帧占比 0~1 */
  speechRatio: number;
  /** 平均响度（有效帧 RMS 均值，0~1） */
  meanVolume: number;
  /** 音量趋势：rising 渐强 / falling 渐弱 / flat 平稳 */
  volumeTrend: "rising" | "falling" | "flat";
}

/** 情绪猜测（来自可选外部接口，可能没有） */
export interface EmotionGuess {
  label: string;
  /** 0~100，接口没给就按 0 处理（宁缺毋滥） */
  confidence: number;
  source: string;
}

/** 情绪标签注入阈值：低于此值只保留声学描述，不带情绪词 */
export const EMOTION_INJECT_MIN = 55;

const FRAME = 320; // 20ms @16k
const SILENCE_RMS = 0.012;
const PAUSE_FRAMES = Math.round(350 / 20); // 0.35s

/** 分析一段 16k PCM：停顿次数/最长停顿/语音占比/音量趋势（纯函数，可单测） */
export function analyzeTake(samples: Float32Array, durationSec: number): TakeMetrics {
  const frames = Math.floor(samples.length / FRAME);
  if (frames < 5) {
    return { durationSec, pauseCount: 0, longestPauseSec: 0, speechRatio: 0, meanVolume: 0, volumeTrend: "flat" };
  }
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const base = f * FRAME;
    for (let i = 0; i < FRAME; i++) {
      const v = samples[base + i];
      sum += v * v;
    }
    rms[f] = Math.sqrt(sum / FRAME);
  }
  const voiced: boolean[] = Array.from(rms, (r) => r > SILENCE_RMS);
  // 首尾静音不算停顿：定位第一/最后一个有效帧
  let first = 0;
  while (first < frames && !voiced[first]) first++;
  let last = frames - 1;
  while (last >= 0 && !voiced[last]) last--;
  let pauseCount = 0;
  let longestPauseSec = 0;
  if (first < last) {
    let gap = 0;
    for (let f = first + 1; f <= last; f++) {
      if (!voiced[f]) {
        gap++;
      } else {
        if (gap >= PAUSE_FRAMES) {
          pauseCount++;
          longestPauseSec = Math.max(longestPauseSec, (gap * 20) / 1000);
        }
        gap = 0;
      }
    }
  }
  let voiceFrames = 0;
  let volSum = 0;
  for (let f = 0; f < frames; f++) {
    if (voiced[f]) {
      voiceFrames++;
      volSum += rms[f];
    }
  }
  const meanVolume = voiceFrames ? volSum / voiceFrames : 0;
  // 音量趋势：有效帧按时间前后两半取均响对比
  const half = Math.floor(frames / 2);
  let a = 0, an = 0, b = 0, bn = 0;
  for (let f = 0; f < frames; f++) {
    if (!voiced[f]) continue;
    if (f < half) { a += rms[f]; an++; } else { b += rms[f]; bn++; }
  }
  let volumeTrend: TakeMetrics["volumeTrend"] = "flat";
  if (an >= 3 && bn >= 3 && a > 0) {
    const ratio = b / bn / (a / an);
    volumeTrend = ratio > 1.15 ? "rising" : ratio < 0.87 ? "falling" : "flat";
  }
  return {
    durationSec,
    pauseCount,
    longestPauseSec: Math.round(longestPauseSec * 10) / 10,
    speechRatio: voiceFrames / frames,
    meanVolume: Math.round(meanVolume * 1000) / 1000,
    volumeTrend,
  };
}

const TREND_TEXT: Record<TakeMetrics["volumeTrend"], string> = {
  rising: "后半段声音逐渐变大",
  falling: "后半段声音越来越轻",
  flat: "音量整体比较平稳",
};

/** 把多段指标汇总成注入用的中文观察文本；全部"可能/推测"措辞，末尾固定免责锚点。
 *  emotion 为 null/低置信度时不出现任何情绪词。 */
export function summarizeObservation(takes: TakeMetrics[], emotion: EmotionGuess | null): string {
  if (!takes.length) return "";
  const total = takes.reduce((n, t) => n + t.durationSec, 0);
  const pauses = takes.reduce((n, t) => n + t.pauseCount, 0);
  const longest = Math.max(...takes.map((t) => t.longestPauseSec));
  const quiet = takes.every((t) => t.meanVolume < 0.06);
  const trend = takes[takes.length - 1]?.volumeTrend ?? "flat";
  const lines: string[] = [];
  lines.push(`【通话观察（仅供参考，不是事实）】这通电话 TA 一共说了约 ${total.toFixed(1)} 秒`);
  if (pauses > 0) lines.push(`中间出现 ${pauses} 次明显停顿${longest >= 0.5 ? `（最长约 ${longest.toFixed(1)} 秒没出声）` : ""}`);
  if (quiet) lines.push("说话声音一直比较轻");
  lines.push(TREND_TEXT[trend]);
  const facts = lines.join("；");
  const guesses: string[] = [];
  if (pauses >= 2 && longest >= 1) guesses.push("可能在斟酌措辞、有点犹豫，也可能只是在想事情或信号不好");
  else if (pauses === 1) guesses.push("中间停了一下，可能是在犹豫要不要说");
  if (quiet) guesses.push("也可能是累了、或者身边不方便大声说话");
  if (trend === "falling" && !quiet) guesses.push("越说越小声，可能情绪有点低落，也可能只是困了");
  if (emotion && emotion.confidence >= EMOTION_INJECT_MIN) {
    guesses.push(`一个音频情绪接口的粗判是「${emotion.label}」（置信度仅 ${emotion.confidence}%，很可能不准）`);
  }
  const guessText = guesses.length ? `——综合起来${guesses.join("；")}。` : "。";
  return (
    "\n" + facts + guessText +
    "\n使用规则：这些只是声学信号的粗略推测，不准是常态。你可以被它触动、用关心的口吻试探（如“你好像有点累？”），" +
    "但绝对禁止断言对方“一定/肯定”处于某种情绪，禁止任何心理或医疗诊断式说法，也不要把停顿次数、置信度这些数字念出来。对方听起来像什么，以 TA 说的话为准。\n"
  );
}

/* ---------- 可选情绪接口：失败静默回退，绝不阻断通话 ---------- */

/** 从任意形态响应里挖 label/confidence（各家网关字段名五花八门，最多下钻两层，挖不到即视为失败） */
export function parseEmotionJson(raw: unknown): EmotionGuess | null {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
  if (!isObj(raw)) return null;
  const pick = (src: Record<string, unknown>): EmotionGuess | null => {
    const label = typeof src.emotion === "string" ? src.emotion : typeof src.label === "string" ? src.label : "";
    const confRaw = Number(src.confidence ?? src.score ?? NaN);
    if (!label || !Number.isFinite(confRaw)) return null;
    // 兼容 0~1 与 0~100 两种口径
    const confidence = Math.round(confRaw <= 1 ? confRaw * 100 : confRaw);
    return { label: label.slice(0, 12), confidence: Math.max(0, Math.min(100, confidence)), source: "外部接口" };
  };
  const direct = pick(raw);
  if (direct) return direct;
  for (const key of ["data", "result"]) {
    const inner = raw[key];
    if (isObj(inner)) {
      const hit = pick(inner);
      if (hit) return hit;
      for (const k2 of ["data", "result"]) {
        if (isObj(inner[k2])) {
          const deep = pick(inner[k2]);
          if (deep) return deep;
        }
      }
    }
  }
  return null;
}

/** 调用配置的情绪分析接口（multipart 音频）。未配置/超时/格式错一律返回 null（静默降级为纯本地观察）。 */
export async function detectEmotion(vc: VoiceConfig, wavBlob: Blob, signal?: AbortSignal): Promise<EmotionGuess | null> {
  const url = vc.emotionUrl?.trim();
  if (!url) return null;
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 8_000);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const form = new FormData();
    form.append("file", wavBlob, "voice.wav");
    const headers: Record<string, string> = {};
    if (vc.emotionKey?.trim()) headers.Authorization = `Bearer ${vc.emotionKey.trim()}`;
    const res = await fetch(url, { method: "POST", headers, body: form, signal: ctrl.signal });
    if (!res.ok) {
      console.log(`[call-observe] emotion http=${res.status}（静默跳过）`);
      return null;
    }
    const guess = parseEmotionJson(await res.json().catch(() => null));
    if (!guess) console.log("[call-observe] emotion 字段无法解析（静默跳过）");
    else console.log(`[call-observe] emotion ok label=${guess.label} conf=${guess.confidence}`);
    return guess;
  } catch (e) {
    console.log(`[call-observe] emotion fail ${(e as Error)?.name === "AbortError" ? "超时/取消" : String(e)}（静默跳过）`);
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/* ---------- 本机录音缓存（IndexedDB；默认不用，用户手动"保留本通电话的录音"才写） ---------- */

const DB_NAME = "vp-call-audio";
const STORE = "takes";
const CACHE_MAX = 10;

export interface CachedTake {
  id: string;
  charId: string;
  at: number;
  durationSec: number;
  blob: Blob;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB 不可用"));
  });
}

/** 存一段录音（超额自动滚最旧）。隐私模式等异常向上抛，由界面提示。 */
export async function cacheTake(take: CachedTake): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(take);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const all = await listCachedTakes();
  if (all.length > CACHE_MAX) {
    const stale = all.sort((a, b) => a.at - b.at).slice(0, all.length - CACHE_MAX);
    await deleteCachedTakes(stale.map((t) => t.id));
  }
  db.close();
}

/** 列出全部缓存（不含 blob 本体，省内存） */
export async function listCachedTakes(): Promise<Omit<CachedTake, "blob">[]> {
  const db = await openDb();
  const items = await new Promise<CachedTake[]>((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as CachedTake[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return items.map(({ blob: _b, ...meta }) => meta);
}

export async function getCachedTake(id: string): Promise<CachedTake | null> {
  const db = await openDb();
  const item = await new Promise<CachedTake | null>((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as CachedTake) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return item;
}

/** 删除指定缓存，返回删除段数 */
export async function deleteCachedTakes(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    ids.forEach((id) => tx.objectStore(STORE).delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return ids.length;
}

/** 清空全部音频缓存（设置页「删除音频缓存」用） */
export async function clearAllCachedAudio(): Promise<number> {
  const all = await listCachedTakes();
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return all.length;
}
