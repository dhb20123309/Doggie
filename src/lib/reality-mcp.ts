// Reality MCP · 手机能力：开关持久化 + 浏览器 API 探测/执行器 + AI 协议与标记解析
// 原则：能用真实 Web API 就真做（震动/通知/播报/提醒/状态），拿不到的（系统通知栏、其他App时长）如实降级为应用内数据版，不假装可用。
import { useEffect, useState } from "react";
import { loadVoiceConfig, synthesizeSpeech, voiceReady, type VoiceConfig } from "./tts";
import type { McpToolMeta, RemoteMcpMark, RemoteMcpServer } from "./remote-mcp";

/* ---------- 能力清单与开关 ---------- */

export type McpCapabilityId =
  | "device_status"
  | "app_notifications"
  | "app_usage"
  | "send_music"
  | "system_notify"
  | "speak"
  | "vibrate"
  | "set_reminder"
  | "list_reminders";

export interface McpCardMeta {
  id: McpCapabilityId;
  title: string;
  desc: string;
  /** 权限标签：只读查询 / 会执行操作 */
  tag: "readonly" | "action";
}

/** UI 文案单一来源（顺序即页面卡片顺序，对齐截图） */
export const MCP_CARDS: McpCardMeta[] = [
  { id: "device_status", title: "读取手机状态", desc: "读取当前手机或浏览器的设备、系统、网络、屏幕和可用权限状态；电量仅 Android 浏览器支持。", tag: "readonly" },
  { id: "app_notifications", title: "读取最近通知", desc: "读取最近 24 小时内 TA 在本应用里发给你的消息记录；系统通知栏原始数据需要原生 App 权限，网页读不到。", tag: "readonly" },
  { id: "app_usage", title: "读取使用时长", desc: "统计本应用的前台使用时长、今日时长与上次打开时间；其他 App 的使用时长属于系统隐私，网页无法获取。", tag: "readonly" },
  { id: "send_music", title: "发送到本机音乐 App", desc: "把歌单里的试听音频交给系统分享面板或浏览器播放器播放；不会写入任何外部平台歌单。", tag: "action" },
  { id: "system_notify", title: "发送手机通知", desc: "在你当前设备上显示一条真实系统通知（需授权）。iOS Safari 标签页不支持系统通知，将自动以内置横幅代替。", tag: "action" },
  { id: "speak", title: "对用户说话", desc: "使用已配置的外部 TTS，或回退到设备浏览器语音合成朗读文本。", tag: "action" },
  { id: "vibrate", title: "震动手持", desc: "让当前手机执行一次轻微、标准或强烈的触觉反馈。iOS Safari 不支持振动接口，将降级为机身抖动动画。", tag: "action" },
  { id: "set_reminder", title: "设置提醒", desc: "创建未来系统提醒：生成日历提醒文件（.ics）交由系统日历确认写入；网页无法静默写入日历，需要你点一下确认。", tag: "action" },
  { id: "list_reminders", title: "查看提醒", desc: "查看你在本应用创建过的提醒清单与剩余时间；第三方备忘录和系统日历里已有的事项网页读不到。", tag: "readonly" },
];

const PREFS_KEY = "vp-phone:mcp-prefs:v1";

export interface McpPrefs {
  enabled: Record<McpCapabilityId, boolean>;
}

/** 默认开关态对齐截图：除「对用户说话」「震动手持」外全部开启 */
export const DEFAULT_MCP_PREFS: McpPrefs = {
  enabled: {
    device_status: true,
    app_notifications: true,
    app_usage: true,
    send_music: true,
    system_notify: true,
    speak: false,
    vibrate: false,
    set_reminder: true,
    list_reminders: true,
  },
};

export function loadMcpPrefs(): McpPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_MCP_PREFS;
    const parsed = JSON.parse(raw) as Partial<McpPrefs>;
    return { enabled: { ...DEFAULT_MCP_PREFS.enabled, ...(parsed.enabled || {}) } };
  } catch {
    return DEFAULT_MCP_PREFS;
  }
}

export function saveMcpPrefs(p: McpPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* 隐私模式忽略 */
  }
}

export function useMcpPrefs(): [McpPrefs, (next: McpPrefs | ((p: McpPrefs) => McpPrefs)) => void] {
  const [prefs, setPrefs] = useState<McpPrefs>(loadMcpPrefs);
  const update = (next: McpPrefs | ((p: McpPrefs) => McpPrefs)) => {
    setPrefs((prev) => {
      const resolved = next instanceof Function ? next(prev) : next;
      saveMcpPrefs(resolved);
      return resolved;
    });
  };
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREFS_KEY) setPrefs(loadMcpPrefs());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return [prefs, update];
}

/* ---------- 运行时支持探测 ---------- */

export type SupportLevel = "full" | "fallback" | "unavailable";
export interface SupportInfo {
  level: SupportLevel;
  note: string;
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function detectSupport(id: McpCapabilityId): SupportInfo {
  switch (id) {
    case "vibrate":
      return typeof navigator.vibrate === "function"
        ? { level: "full", note: "本机浏览器支持真实振动" }
        : { level: "fallback", note: isIOS() ? "iOS Safari 无振动接口，将降级为机身抖动动画" : "该浏览器不支持振动接口，将降级为视觉反馈" };
    case "system_notify": {
      if (typeof Notification === "undefined") return { level: "fallback", note: "该浏览器无通知接口，将以内置横幅代替" };
      if (isIOS()) return { level: "fallback", note: "iOS Safari 标签页不支持系统通知，将以内置横幅代替（添加到主屏幕后可用）" };
      return { level: "full", note: `通知权限：${Notification.permission === "granted" ? "已授权" : Notification.permission === "denied" ? "已被拒绝" : "未申请（首次开启时弹窗）"}` };
    }
    case "speak": {
      const vc = loadVoiceConfig();
      if (voiceReady(vc, { baseUrl: "", apiKey: "" })) return { level: "full", note: "外部 TTS 已配置" };
      return typeof speechSynthesis !== "undefined"
        ? { level: "fallback", note: "未配置外部 TTS，将使用浏览器内置语音合成" }
        : { level: "unavailable", note: "该浏览器没有可用的语音合成能力" };
    }
    case "set_reminder":
      return { level: "full", note: "生成 .ics 提醒文件，点击后由系统日历确认写入" };
    case "list_reminders":
      return { level: "full", note: "展示本应用创建过的提醒（系统日历中已有事项无法回读）" };
    case "device_status":
      return { level: "full", note: "电量仅 Android Chrome 支持，其余字段全平台可读" };
    case "app_notifications":
      return { level: "fallback", note: "仅应用内消息记录，系统通知栏需原生 App" };
    case "app_usage":
      return { level: "fallback", note: "仅统计本应用前台时长，其他 App 需原生 App" };
    case "send_music":
      return typeof navigator.canShare === "function" && typeof navigator.share === "function"
        ? { level: "full", note: "支持系统分享面板，可直达本机播放器" }
        : { level: "fallback", note: "该浏览器无分享接口，将以新窗口打开音频交给系统播放" };
  }
}

/* ---------- 执行器（全部特性检测 + try-catch，返回人话结果） ---------- */

export interface ExecResult {
  ok: boolean;
  /** 给聊天流执行记录/页面反馈用的一句话结果 */
  text: string;
}

/** 1. 读取手机状态 */
export async function readDeviceStatus(): Promise<string[]> {
  const lines: string[] = [];
  const ua = navigator.userAgent;
  const platform =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigator as any).userAgentData?.platform ||
    (/Android/i.test(ua) ? "Android" : isIOS() ? "iOS" : /Windows/i.test(ua) ? "Windows" : /Mac/i.test(ua) ? "macOS" : "未知系统");
  lines.push(`设备：${platform} · ${screen.width}x${screen.height} @${window.devicePixelRatio}x`);
  lines.push(`浏览器：${(ua.match(/(Chrome|Firefox|Safari|Edg)\/[\d.]+/g) || ["未知"]).join(" / ")}`);
  lines.push(`语言：${navigator.language} · 在线：${navigator.onLine ? "是" : "否"} · 深色模式：${matchMedia("(prefers-color-scheme: dark)").matches ? "开" : "关"}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conn = (navigator as any).connection;
  if (conn) lines.push(`网络：${conn.effectiveType?.toUpperCase() || "未知"}${conn.downlink ? ` · 约 ${conn.downlink}Mbps` : ""}`);
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage != null) lines.push(`存储占用：约 ${(est.usage / 1024 / 1024).toFixed(1)}MB`);
  } catch {
    /* ignore */
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const battery = (navigator as any).getBattery ? await (navigator as any).getBattery() : null;
    lines.push(battery ? `电量：${Math.round(battery.level * 100)}%${battery.charging ? "（充电中）" : ""}` : "电量：该浏览器不提供电池信息（iOS 不支持）");
  } catch {
    lines.push("电量：读取失败");
  }
  return lines;
}

/** 2. 系统通知（iOS/不支持时回落应用内横幅，由调用方 emitNotify） */
export async function fireSystemNotification(title: string, body: string): Promise<ExecResult> {
  if (typeof Notification === "undefined" || isIOS()) {
    return { ok: false, text: "该系统通知不可用（iOS Safari 限制），请改用内置横幅" };
  }
  try {
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, text: "通知权限未授予，请在浏览器设置里允许通知" };
    new Notification(title, { body, tag: "vp-mcp" });
    return { ok: true, text: "已发送系统通知" };
  } catch (e) {
    return { ok: false, text: `通知发送失败：${e instanceof Error ? e.message : "未知错误"}` };
  }
}

/** 3. 震动：轻/标准/强三档；不支持返回 fallback 让 UI 播抖动动画 */
export function vibrate(level: "light" | "standard" | "strong"): ExecResult & { fallbackShake?: boolean } {
  const ms = level === "light" ? 20 : level === "standard" ? 60 : 200;
  const label = level === "light" ? "轻微" : level === "standard" ? "标准" : "强烈";
  try {
    if (typeof navigator.vibrate === "function" && navigator.vibrate(ms)) {
      return { ok: true, text: `已震动·${label}` };
    }
  } catch {
    /* ignore */
  }
  return { ok: false, fallbackShake: true, text: `振动接口不可用，已降级为视觉反馈·${label}` };
}

/** 4. 对用户说话：优先外部 TTS，回落浏览器 speechSynthesis */
export async function speakToUser(text: string, fallback: { baseUrl: string; apiKey: string }): Promise<ExecResult> {
  const clean = text.slice(0, 300);
  const vc: VoiceConfig = loadVoiceConfig();
  if (voiceReady(vc, fallback)) {
    try {
      const url = await synthesizeSpeech(vc, fallback, clean);
      const audio = new Audio(url);
      await audio.play();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return { ok: true, text: "已用外部语音播报" };
    } catch {
      /* 继续回落浏览器合成 */
    }
  }
  if (typeof speechSynthesis === "undefined") return { ok: false, text: "该浏览器没有语音合成能力" };
  try {
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = "zh-CN";
    u.rate = 0.95;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    return { ok: true, text: "已用浏览器语音播报" };
  } catch (e) {
    return { ok: false, text: `播报失败：${e instanceof Error ? e.message : "未知错误"}` };
  }
}

/* ---------- 提醒（.ics + 本地清单） ---------- */

const REMINDERS_KEY = "vp-phone:mcp-reminders:v1";

export interface McpReminder {
  id: string;
  title: string;
  /** 触发时刻（epoch ms） */
  at: number;
  createdAt: number;
}

export function listReminders(): McpReminder[] {
  try {
    const arr = JSON.parse(localStorage.getItem(REMINDERS_KEY) || "[]") as McpReminder[];
    return arr.filter((r) => r.at > Date.now()).sort((a, b) => a.at - b.at);
  } catch {
    return [];
  }
}

export function removeReminder(id: string) {
  try {
    const arr = (JSON.parse(localStorage.getItem(REMINDERS_KEY) || "[]") as McpReminder[]).filter((r) => r.id !== id);
    localStorage.setItem(REMINDERS_KEY, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
}

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
}

/** 创建提醒：落本地清单 + 下载 .ics 交系统日历确认 */
export function createReminder(title: string, minutes: number): ExecResult {
  const safeTitle = title.trim().slice(0, 40) || "TA 的提醒";
  const mins = Math.max(1, Math.min(1440, Math.round(minutes)));
  const at = Date.now() + mins * 60_000;
  const r: McpReminder = { id: `r${Date.now()}`, title: safeTitle, at, createdAt: Date.now() };
  try {
    const arr = JSON.parse(localStorage.getItem(REMINDERS_KEY) || "[]") as McpReminder[];
    localStorage.setItem(REMINDERS_KEY, JSON.stringify([...arr.slice(-29), r]));
  } catch {
    /* ignore */
  }
  const start = new Date(at);
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//virtual-phone//MCP//CN",
    "BEGIN:VEVENT",
    `UID:${r.id}@vp-phone`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `SUMMARY:${safeTitle}`,
    "DESCRIPTION:来自 TA 的手机提醒",
    "BEGIN:VALARM",
    "TRIGGER:-PT0M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${safeTitle}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  try {
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `提醒-${safeTitle}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return { ok: true, text: `已创建提醒「${safeTitle}」（${mins}分钟后），点开下载的日历文件即可写入系统提醒` };
  } catch {
    return { ok: true, text: `已记录提醒「${safeTitle}」（${mins}分钟后），但日历文件生成失败` };
  }
}

/* ---------- 应用内消息记录 / 使用时长 ---------- */

/** 最近 N 小时 TA 在各会话发来的消息（rolechat-log:* 汇总） */
export function readRecentAppMessages(hours = 24): string[] {
  const since = Date.now() - hours * 3_600_000;
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith("vp-phone:rolechat-log:")) continue;
      const entries = JSON.parse(localStorage.getItem(key) || "[]") as { role: string; content: string; at: number; failed?: boolean }[];
      for (const e of entries) {
        if (e.role === "assistant" && !e.failed && e.at >= since) {
          out.push(`${new Date(e.at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} ${e.content.split(/\r?\n/)[0].slice(0, 40)}`);
        }
      }
    }
  } catch {
    /* ignore */
  }
  return out.sort().slice(-20);
}

const USAGE_KEY = "vp-phone:mcp-usage:v1";

interface UsageState {
  totalSec: number;
  today: string;
  todaySec: number;
  lastOpenAt: number;
}

function readUsage(): UsageState {
  try {
    const u = JSON.parse(localStorage.getItem(USAGE_KEY) || "") as UsageState;
    if (u && u.today === new Date().toISOString().slice(0, 10)) return u;
    const prev = u || { totalSec: 0, today: "", todaySec: 0, lastOpenAt: 0 };
    return { ...prev, today: new Date().toISOString().slice(0, 10), todaySec: 0 };
  } catch {
    return { totalSec: 0, today: new Date().toISOString().slice(0, 10), todaySec: 0, lastOpenAt: 0 };
  }
}

function writeUsage(u: UsageState) {
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(u));
  } catch {
    /* ignore */
  }
}

/** 前台计时：visibilitychange 累计（PhoneShell 挂载一次即可） */
export function startUsageTracker(): () => void {
  let visibleSince = document.visibilityState === "visible" ? Date.now() : 0;
  if (visibleSince) {
    const u = readUsage();
    writeUsage({ ...u, lastOpenAt: Date.now() });
  }
  const flush = () => {
    if (visibleSince) {
      const delta = Math.floor((Date.now() - visibleSince) / 1000);
      const u = readUsage();
      writeUsage({ ...u, totalSec: u.totalSec + delta, todaySec: u.todaySec + delta });
      visibleSince = 0;
    }
  };
  const onVis = () => {
    if (document.visibilityState === "visible") visibleSince = Date.now();
    else flush();
  };
  document.addEventListener("visibilitychange", onVis);
  const timer = window.setInterval(() => {
    if (visibleSince) {
      const now = Date.now();
      const delta = Math.floor((now - visibleSince) / 1000);
      if (delta >= 10) {
        const u = readUsage();
        writeUsage({ ...u, totalSec: u.totalSec + delta, todaySec: u.todaySec + delta });
        visibleSince = now;
      }
    }
  }, 10_000);
  return () => {
    flush();
    document.removeEventListener("visibilitychange", onVis);
    clearInterval(timer);
  };
}

export function usageStatsText(): string[] {
  const u = readUsage();
  const fmt = (s: number) => (s >= 3600 ? `${(s / 3600).toFixed(1)} 小时` : s >= 60 ? `${Math.round(s / 60)} 分钟` : `${s} 秒`);
  return [
    `今日前台：${fmt(u.todaySec)}`,
    `累计前台：${fmt(u.totalSec)}`,
    u.lastOpenAt ? `上次打开：${new Date(u.lastOpenAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : "上次打开：本次是第一次",
  ];
}

/* ---------- 发送到本机音乐 App ---------- */

export async function shareTrackToMusicApp(url: string, title: string): Promise<ExecResult> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`音频拉取失败（${res.status}）`);
    const blob = await res.blob();
    const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : blob.type.includes("wav") ? "wav" : "mp3";
    const file = new File([blob], `${title.slice(0, 24) || "歌曲"}.${ext}`, { type: blob.type || "audio/mpeg" });
    if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
      await navigator.share({ title, files: [file] });
      return { ok: true, text: `已调起系统分享「${title}」，选本机播放器即可` };
    }
    if (typeof navigator.share === "function") {
      await navigator.share({ title, text: title, url });
      return { ok: true, text: `已调起系统分享「${title}」链接` };
    }
    window.open(url, "_blank", "noopener");
    return { ok: true, text: `已在新窗口打开「${title}」交给系统播放` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "分享失败";
    if (msg.includes("abort") || msg.includes("Abort")) return { ok: false, text: "已取消分享" };
    return { ok: false, text: msg };
  }
}

/* ---------- AI 协议与标记解析 ---------- */

/** 远程 MCP 高危调用确认：内存 Promise 表，UI 弹卡 resolve；60 秒无操作视为拒绝 */
const pendingConfirms = new Map<string, { resolve: (v: boolean) => void; timer: number }>();

export function requestRemoteConfirm(req: { serverName: string; tool: string; argsPreview: string }): Promise<boolean> {
  const id = `c${Date.now()}${Math.random().toString(36).slice(2, 5)}`;
  return new Promise<boolean>((resolve) => {
    const timer = window.setTimeout(() => {
      pendingConfirms.delete(id);
      window.dispatchEvent(new CustomEvent("vp-mcp:confirm", { detail: null }));
      resolve(false);
    }, 60_000);
    pendingConfirms.set(id, { resolve, timer });
    window.dispatchEvent(new CustomEvent("vp-mcp:confirm", { detail: { id, ...req } }));
  });
}

export function answerRemoteConfirm(id: string, accept: boolean) {
  const p = pendingConfirms.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pendingConfirms.delete(id);
  window.dispatchEvent(new CustomEvent("vp-mcp:confirm", { detail: null }));
  p.resolve(accept);
}

/** 从回复行里拆出远程 MCP 标记（只认独立成行的），返回剩余干净文本与标记列表 */
export function extractRemoteMarks(reply: string): { clean: string; marks: RemoteMcpMark[] } {
  const kept: string[] = [];
  const marks: RemoteMcpMark[] = [];
  for (const line of reply.split(/\r?\n/)) {
    const m = line.trim().match(REMOTE_MCP_RE);
    if (m) {
      let args: Record<string, unknown> = {};
      if (m[3]) {
        try {
          const parsed = JSON.parse(m[3]) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
        } catch {
          /* 参数非法按空参数处理 */
        }
      }
      marks.push({ serverName: m[1].trim(), toolName: m[2].trim(), args });
      continue;
    }
    kept.push(line);
  }
  return { clean: kept.join("\n").trim(), marks };
}

const REMOTE_MCP_RE = /^\[远程MCP[:：]\s*([^:\]]{1,30})\s*[:：]\s*([^:\]]{1,48})\s*(?:[:：]\s*(\{[\s\S]*\}))?\]$/;

export interface RemoteMcpBridge {
  servers: () => RemoteMcpServer[];
  toolCache: () => Record<string, McpToolMeta[]>;
  call: (server: RemoteMcpServer, tool: McpToolMeta, args: Record<string, unknown>, confirmed: boolean) => Promise<{ ok: boolean; text: string; content: string }>;
}

/** 执行 AI 输出的远程 MCP 标记（由 RoleChatApp 注入桥接实现），返回执行记录串 */
export async function execRemoteMarks(marks: RemoteMcpMark[], bridge: RemoteMcpBridge): Promise<string> {
  if (!marks.length) return "";
  const parts: string[] = [];
  for (const m of marks.slice(0, 2)) {
    const server = bridge.servers().find((s) => s.name === m.serverName || s.id === m.serverName);
    if (!server) {
      parts.push(`✗ ${m.serverName}/${m.toolName}（未安装该服务）`);
      continue;
    }
    const tools = bridge.toolCache()[server.id] ?? [];
    const tool = tools.find((t) => t.name === m.toolName);
    if (!tool) {
      parts.push(`✗ ${server.name}/${m.toolName}（不在授权工具清单内，已拒绝）`);
      console.warn(`[mcp-remote] denied unlisted tool ${server.name}/${m.toolName}`);
      continue;
    }
    let confirmed = false;
    if (tool.risk === "high") {
      const preview = JSON.stringify(m.args).slice(0, 80);
      confirmed = await requestRemoteConfirm({ serverName: server.name, tool: m.toolName, argsPreview: preview });
      if (!confirmed) {
        const r = await bridge.call(server, tool, m.args, false);
        parts.push(`✗ ${r.text}`);
        continue;
      }
    }
    const r = await bridge.call(server, tool, m.args, true);
    parts.push(`${r.ok ? "✓" : "✗"} ${r.text}${r.content ? `\n返回摘要：${r.content.slice(0, 120)}` : ""}`);
  }
  return parts.join(" ｜ ");
}

export const REALITY_MCP_PROTOCOL =
  "\n【手机能力】你可以通过在回复里单独一行输出下列标记，真实操作对方的手机（系统会替你执行并在聊天里留下执行记录）：" +
  "[震动:轻|标准|强烈] 让对方手机震一下；[播报:要念出来的短句] 用语音对用户说话；[提醒:分钟数:内容] 给对方设一个几分钟后响的提醒（如 [提醒:30:喝水]）。" +
  "克制使用：只在对方明确要求（\"震我一下\"\"提醒我十分钟后拿快递\"\"念给我听\"）、或情绪时刻值得一点小动作时才用，一轮最多一个标记，绝不滥用。" +
  "对方问设备/电量/网络/时长/提醒等待遇类问题时，依据系统给你的【手机能力】状态清单如实回答，读不到的就坦白说网页做不到。" +
  "标记必须独占一行、不要解释标记本身，标记外的正文照常写。";

export type McpAction =
  | { kind: "vibrate"; level: "light" | "standard" | "strong" }
  | { kind: "speak"; text: string }
  | { kind: "reminder"; minutes: number; title: string };

const VIBRATE_RE = /^\[震动[:：]\s*(轻|轻微|标准|强烈|强)\s*\]$/;
const SPEAK_RE = /^\[播报[:：]\s*(.+)\]$/;
const REMIND_RE = /^\[提醒[:：]\s*(\d{1,4})\s*分钟?[:：]\s*([^\]]{1,30})\]$/;

/** 从回复行里拆出能力标记（只认独立成行的），返回剩余干净文本与动作列表 */
export function extractMcpMarks(reply: string): { clean: string; actions: McpAction[] } {
  const actions: McpAction[] = [];
  const kept: string[] = [];
  for (const line of reply.split(/\r?\n/)) {
    const t = line.trim();
    const vm = t.match(VIBRATE_RE);
    if (vm) {
      const lvl = vm[1];
      actions.push({ kind: "vibrate", level: lvl === "标准" ? "standard" : lvl === "强烈" || lvl === "强" ? "strong" : "light" });
      continue;
    }
    const sm = t.match(SPEAK_RE);
    if (sm) {
      actions.push({ kind: "speak", text: sm[1].trim().slice(0, 200) });
      continue;
    }
    const rm = t.match(REMIND_RE);
    if (rm) {
      actions.push({ kind: "reminder", minutes: Number(rm[1]), title: rm[2].trim() });
      continue;
    }
    kept.push(line);
  }
  return { clean: kept.join("\n").trim(), actions };
}

/** 按开关执行动作列表，返回执行记录串（写进聊天流 mcpNote）；未开启的能力标注原因 */
export async function execMcpActions(actions: McpAction[], prefs: McpPrefs, fallback: { baseUrl: string; apiKey: string }): Promise<string> {
  if (!actions.length) return "";
  const parts: string[] = [];
  for (const a of actions.slice(0, 2)) {
    if (a.kind === "vibrate") {
      if (!prefs.enabled.vibrate) {
        parts.push("✗ 震动（该能力已被你关闭）");
        continue;
      }
      const r = vibrate(a.level);
      parts.push(`${r.ok ? "✓" : "△"} ${r.text}`);
      if (!r.ok && r.fallbackShake) {
        try {
          window.dispatchEvent(new CustomEvent("vp-mcp:shake"));
        } catch {
          /* ignore */
        }
      }
    } else if (a.kind === "speak") {
      if (!prefs.enabled.speak) {
        parts.push("✗ 播报（该能力已被你关闭）");
        continue;
      }
      const r = await speakToUser(a.text, fallback);
      parts.push(`${r.ok ? "✓" : "✗"} ${r.text}`);
    } else if (a.kind === "reminder") {
      if (!prefs.enabled.set_reminder) {
        parts.push("✗ 提醒（该能力已被你关闭）");
        continue;
      }
      const r = createReminder(a.title, a.minutes);
      parts.push(`${r.ok ? "✓" : "✗"} ${r.text}`);
    }
  }
  return parts.join(" ｜ ");
}

/** 拼进 system 的能力状态清单（requestReply 的 mcpCtx 用） */
export function buildMcpContext(prefs: McpPrefs): string {
  const on = (id: McpCapabilityId) => (prefs.enabled[id] ? "已开启" : "已关闭");
  const rems = listReminders();
  const lines = [
    "\n【手机能力状态】",
    `- 震动：${on("vibrate")}；语音播报：${on("speak")}；设置提醒：${on("set_reminder")}${rems.length ? `（待触发提醒 ${rems.length} 个：${rems.map((r) => `${r.title}·${Math.max(1, Math.round((r.at - Date.now()) / 60000))}分钟后`).join("、")}）` : ""}`,
    `- 系统通知：${on("system_notify")}；读取手机状态：${on("device_status")}；应用内消息记录：${on("app_notifications")}；使用时长：${on("app_usage")}；发送到音乐App：${on("send_music")}`,
    "- 只有标\"已开启\"的能力对应标记才会被执行；关闭的能力不要输出标记。",
  ];
  if (prefs.enabled.device_status) {
    lines.push(`- 设备速览：${(/Android/i.test(navigator.userAgent) ? "Android" : isIOS() ? "iOS" : "桌面/其他")} · ${navigator.language} · ${navigator.onLine ? "在线" : "离线"}${typeof navigator.vibrate === "function" ? " · 支持振动" : " · 不支持振动接口"}`);
  }
  if (prefs.enabled.app_usage) lines.push(...usageStatsText().map((s) => `- ${s}`));
  return lines.join("\n");
}
