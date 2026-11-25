// 真机联动（GitHub 私有仓库中转）：使用者的快捷指令/Tasker 把真机状态写进【自己的】仓库，
// 本应用只读取渲染并喂给角色——发布后人人可用，代码里不含任何私人信息；Token 仅存本机 localStorage。
import { useEffect, useState } from "react";

/* ---------- 授权配置 ---------- */

export interface RealPhoneConfig {
  /** 总开关：关闭时全链路短路，查手机回落模拟数据 */
  enabled: boolean;
  owner: string;
  repo: string;
  branch: string;
  /** Fine-grained PAT（Contents: Read and write，仅限该仓库）。⚠️ 只存本机，严禁写入任何远端或日志 */
  token: string;
  /** 数据目录（仓库内路径），默认 vp-data */
  dir: string;
}

const CFG_KEY = "vp-phone:realphone:cfg:v1";

export const DEFAULT_REALPHONE: RealPhoneConfig = {
  enabled: false,
  owner: "",
  repo: "",
  branch: "main",
  token: "",
  dir: "vp-data",
};

export function loadRealPhone(): RealPhoneConfig {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    if (!raw) return DEFAULT_REALPHONE;
    return { ...DEFAULT_REALPHONE, ...(JSON.parse(raw) as Partial<RealPhoneConfig>) };
  } catch {
    return DEFAULT_REALPHONE;
  }
}

export function saveRealPhone(c: RealPhoneConfig) {
  try {
    localStorage.setItem(CFG_KEY, JSON.stringify(c));
  } catch {
    /* 隐私模式忽略 */
  }
}

export function useRealPhone(): [RealPhoneConfig, (next: RealPhoneConfig | ((p: RealPhoneConfig) => RealPhoneConfig)) => void] {
  const [cfg, setCfg] = useState<RealPhoneConfig>(loadRealPhone);
  const update = (next: RealPhoneConfig | ((p: RealPhoneConfig) => RealPhoneConfig)) => {
    setCfg((prev) => {
      const resolved = next instanceof Function ? next(prev) : next;
      saveRealPhone(resolved);
      return resolved;
    });
  };
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === CFG_KEY) setCfg(loadRealPhone());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return [cfg, update];
}

/** 配置完整且开启才算"已接入" */
export function realPhoneReady(c: RealPhoneConfig): boolean {
  return c.enabled && !!c.owner.trim() && !!c.repo.trim() && !!c.token.trim();
}

/* ---------- 真机上报的数据协议（与快捷指令/Tasker 生成的模板一一对应） ---------- */

export interface ActivityRecord {
  app: string;
  at: number; // epoch ms
}
export interface DeviceSnapshot {
  battery?: number;
  charging?: boolean;
  brightness?: number;
  volume?: number;
  network?: string;
  lat?: number;
  lng?: number;
  place?: string;
  steps?: number;
  music?: string;
  at: number;
}
export interface LockState {
  apps: string[];
  note?: string;
  at: number;
}
export interface EventRecord {
  type: string; // lock|unlock|charge_start|charge_full|leave_home|arrive_home|app_open...
  detail?: string;
  at: number;
}

export interface RealPhoneData {
  activity: ActivityRecord[];
  device: DeviceSnapshot | null;
  locks: LockState;
  events: EventRecord[];
  fetchedAt: number;
  /** 各文件拉取失败原因（人话），成功的不记录 */
  errors: Record<string, string>;
}

const EMPTY_DATA: RealPhoneData = {
  activity: [],
  device: null,
  locks: { apps: [], at: 0 },
  events: [],
  fetchedAt: 0,
  errors: {},
};

const DATA_KEY = "vp-phone:realphone:data:v1";
const FETCH_TTL_MS = 30_000; // 页面轮询节流
let inFlight: Promise<RealPhoneData> | null = null;

export function loadRealData(): RealPhoneData {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) return EMPTY_DATA;
    const d = JSON.parse(raw) as RealPhoneData;
    return { ...EMPTY_DATA, ...d };
  } catch {
    return EMPTY_DATA;
  }
}

function saveRealData(d: RealPhoneData) {
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(d));
  } catch {
    /* ignore */
  }
}

/** hook：进入使用方即周期拉取（开启状态下）；关闭时立即清缓存回落模拟 */
export function useRealPhoneData(): { data: RealPhoneData; refresh: () => void } {
  const [data, setData] = useState<RealPhoneData>(loadRealData);
  const cfg = loadRealPhone();
  const ready = realPhoneReady(cfg);
  const refresh = () => {
    if (!ready) return;
    fetchAll(cfg).then((d) => {
      setData(d);
      saveRealData(d);
    });
  };
  useEffect(() => {
    if (!ready) {
      setData(EMPTY_DATA);
      saveRealData(EMPTY_DATA);
      return;
    }
    let cancelled = false;
    const tick = () => {
      fetchAll(cfg).then((d) => {
        if (!cancelled) {
          setData(d);
          saveRealData(d);
        }
      });
    };
    if (Date.now() - loadRealData().fetchedAt > FETCH_TTL_MS) tick();
    const timer = window.setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, cfg.owner, cfg.repo, cfg.branch, cfg.dir, cfg.token]);
  return { data, refresh };
}

/* ---------- GitHub Contents API 读写 ---------- */

async function ghRead(c: RealPhoneConfig, file: string): Promise<unknown | null> {
  const url = `https://api.github.com/repos/${encodeURIComponent(c.owner.trim())}/${encodeURIComponent(c.repo.trim())}/contents/${c.dir.trim() || "vp-data"}/${file}?ref=${encodeURIComponent(c.branch.trim() || "main")}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${c.token.trim()}`, Accept: "application/vnd.github+json" },
  });
  if (res.status === 404) return null; // 还没写过该文件
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = (await res.json()) as { content?: string; encoding?: string };
  if (!j.content) return null;
  // content 是 base64（可能带换行）
  const b64 = j.content.replace(/\s/g, "");
  const text = decodeURIComponent(escape(atob(b64)));
  return JSON.parse(text);
}

async function ghWrite(c: RealPhoneConfig, file: string, payload: unknown): Promise<{ ok: boolean; msg?: string }> {
  const dir = c.dir.trim() || "vp-data";
  const branch = c.branch.trim() || "main";
  const url = `https://api.github.com/repos/${encodeURIComponent(c.owner.trim())}/${encodeURIComponent(c.repo.trim())}/contents/${dir}/${file}`;
  let sha: string | undefined;
  try {
    const meta = await fetch(`${url}?ref=${encodeURIComponent(branch)}`, {
      headers: { Authorization: `Bearer ${c.token.trim()}`, Accept: "application/vnd.github+json" },
    });
    if (meta.ok) sha = ((await meta.json()) as { sha?: string }).sha;
  } catch {
    /* 读不到就当新建 */
  }
  const json = JSON.stringify(payload ?? {});
  const body: Record<string, unknown> = {
    message: `vp sync ${file} ${new Date().toISOString()}`,
    content: btoa(unescape(encodeURIComponent(json))),
    branch,
  };
  if (sha) body.sha = sha;
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${c.token.trim()}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.warn(`[realphone] write ${file} failed HTTP ${res.status}`);
      return { ok: false, msg: res.status === 401 ? "Token 无效或过期" : res.status === 403 ? "权限不足或被限流" : res.status === 404 ? "仓库/分支不存在" : `HTTP ${res.status} ${t.slice(0, 80)}` };
    }
    console.log(`[realphone] write ${file} ok`);
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? e.message : "网络错误" };
  }
}

/** 拉全部四类文件，单个失败不影响其余 */
export async function fetchAll(c: RealPhoneConfig): Promise<RealPhoneData> {
  if (!realPhoneReady(c)) return loadRealData();
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const errors: Record<string, string> = {};
    const files: [keyof RealPhoneData, string][] = [
      ["activity", "phone_activity.json"],
      ["device", "device_info.json"],
      ["locks", "locked_apps.json"],
      ["events", "events.json"],
    ];
    const out: RealPhoneData = { ...EMPTY_DATA, errors };
    for (const [key, file] of files) {
      try {
        const v = await ghRead(c, file);
        if (key === "activity") out.activity = Array.isArray(v) ? (v as ActivityRecord[]) : [];
        if (key === "device") out.device = (v as DeviceSnapshot) ?? null;
        if (key === "locks") out.locks = (v as LockState) ?? { apps: [], at: 0 };
        if (key === "events") out.events = Array.isArray(v) ? (v as EventRecord[]) : [];
      } catch (e) {
        errors[file] = e instanceof Error ? e.message : "读取失败";
      }
    }
    out.fetchedAt = Date.now();
    console.log(`[realphone] fetch activity=${out.activity.length} events=${out.events.length} device=${out.device ? "有" : "无"} err=${Object.keys(errors).length}`);
    return out;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** 连接测试：读一次 phone_activity.json（404 也算通——说明仓库和 Token 都对，只是还没数据） */
export async function testRealPhone(c: RealPhoneConfig): Promise<{ ok: boolean; msg: string }> {
  if (!realPhoneReady(c)) return { ok: false, msg: "请先填写用户名、仓库名和 Token" };
  try {
    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(c.owner.trim())}/${encodeURIComponent(c.repo.trim())}`, {
      headers: { Authorization: `Bearer ${c.token.trim()}` },
    });
    if (res.status === 404) return { ok: false, msg: "找不到该仓库，或 Token 没有它的读取权限" };
    if (!res.ok) return { ok: false, msg: `HTTP ${res.status}${res.status === 401 ? "（Token 无效）" : ""}` };
    const j = (await res.json()) as { private?: boolean; default_branch?: string };
    console.log(`[realphone] test ok repo=${c.owner}/${c.repo} private=${j.private}`);
    return {
      ok: true,
      msg: `仓库可访问${j.private ? "（私有，数据只有你能看到）" : "（⚠️ 公开仓库，建议改为 Private）"}，默认分支 ${j.default_branch ?? c.branch}${j.default_branch && j.default_branch !== c.branch ? "，与填写的分支不一致请修正" : ""}`,
    };
  } catch (e) {
    return { ok: false, msg: e instanceof Error ? `网络错误：${e.message}` : "网络错误" };
  }
}

/** 反向通道：角色把某个 App 加入锁定名单（写回使用者仓库，手机端自动化轮询执行） */
export async function lockApp(app: string): Promise<{ ok: boolean; msg?: string }> {
  const c = loadRealPhone();
  if (!realPhoneReady(c)) return { ok: false, msg: "真机联动未开启" };
  const cur = loadRealData().locks;
  const apps = [...new Set([...cur.apps, app])];
  const r = await ghWrite(c, "locked_apps.json", { apps, note: `${app} 被 TA 锁了`, at: Date.now() });
  if (r.ok) {
    saveRealData({ ...loadRealData(), locks: { apps, note: `${app} 被 TA 锁了`, at: Date.now() } });
    console.log(`[realphone] lock app=${app}`);
  }
  return r;
}

export async function unlockApp(app: string): Promise<{ ok: boolean; msg?: string }> {
  const c = loadRealPhone();
  if (!realPhoneReady(c)) return { ok: false, msg: "真机联动未开启" };
  const cur = loadRealData().locks;
  const apps = cur.apps.filter((a) => a !== app);
  const r = await ghWrite(c, "locked_apps.json", { apps, note: "", at: Date.now() });
  if (r.ok) {
    saveRealData({ ...loadRealData(), locks: { apps, at: Date.now() } });
    console.log(`[realphone] unlock app=${app}`);
  }
  return r;
}

/* ---------- 摘要：拼入角色 system 的真机感知段 ---------- */

const hhmm = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** 距今多久（人话） */
function ago(t: number): string {
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  if (m < 60 * 24) return `${Math.floor(m / 60)} 小时前`;
  return `${Math.floor(m / (60 * 24))} 天前`;
}

/** 今日 0 点起 */
const todayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function buildRealPhoneSection(d: RealPhoneData): string {
  if (!d.fetchedAt) return "";
  const lines: string[] = [];
  const dev = d.device;
  if (dev && Date.now() - dev.at < 6 * 3600_000) {
    const bits: string[] = [];
    if (typeof dev.battery === "number") bits.push(`电量 ${Math.round(dev.battery)}%${dev.charging ? "（充电中）" : ""}`);
    if (typeof dev.brightness === "number") bits.push(`屏幕亮度 ${Math.round(dev.brightness)}%`);
    if (typeof dev.volume === "number") bits.push(`媒体音量 ${Math.round(dev.volume)}%`);
    if (dev.network) bits.push(`网络 ${dev.network}`);
    if (dev.place) bits.push(`位置 ${dev.place}`);
    if (typeof dev.steps === "number") bits.push(`今日步数 ${dev.steps}`);
    if (dev.music) bits.push(`正在听《${dev.music}》`);
    if (bits.length) lines.push(`- 设备快照（${ago(dev.at)}更新）：${bits.join("；")}`);
  }
  const today = d.activity.filter((a) => a.at >= todayStart());
  if (today.length) {
    const counts = new Map<string, number>();
    for (const a of today) counts.set(a.app, (counts.get(a.app) ?? 0) + 1);
    const top = [...counts.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6);
    const recent = today.slice(-5).reverse().map((a) => `${hhmm(a.at)} 打开${a.app}`).join("；");
    lines.push(`- 今日 App 打开记录共 ${today.length} 次：${top.map(([n, c]) => `${n}×${c}`).join("、")}`);
    lines.push(`- 最近几次：${recent}`);
  }
  const evToday = d.events.filter((e) => e.at >= todayStart()).slice(-6).reverse();
  if (evToday.length) {
    const EV_CN: Record<string, string> = {
      lock: "锁屏了", unlock: "解锁手机", charge_start: "插上充电", charge_full: "电充满了",
      leave_home: "离开家了", arrive_home: "到家了", screen_on: "点亮屏幕",
    };
    lines.push(`- 今日事件：${evToday.map((e) => `${hhmm(e.at)} ${EV_CN[e.type] ?? e.type}${e.detail ? `（${e.detail}）` : ""}`).join("；")}`);
  }
  if (d.locks.apps.length) lines.push(`- 你已让对方锁掉的 App：${d.locks.apps.join("、")}（对方手机端会自动收到提醒）`);
  if (!lines.length) return "\n【真机动态】对方手机刚接入联动，还没有上报数据，先别提这块。\n";
  return (
    "\n【对方的真机动态·真实数据】以下是对方的手机通过联动系统实时汇报的真实情况，你可以像恋人一样自然地知道这些（就像你们之间有互相关注的定位和屏幕时间那样理所当然）：\n" +
    lines.join("\n") +
    `\n（数据截至 ${ago(d.fetchedAt)}。用法要求：只在对话自然涉及时才顺带提及，禁止每条消息都报数据；语气按你的人设来——心疼、吃醋、调侃都行；绝对不许出现"联动系统""上报""JSON""GitHub"等技术词，出戏违规。\n`
  );
}

/** 主动消息的事件触发：距上次主动消息期间发生了值得搭话的真机事件 */
export function realPhoneTrigger(d: RealPhoneData, sinceMs: number): { line: string; key: string } | null {
  if (!d.fetchedAt) return null;
  const recentEvents = d.events.filter((e) => Date.now() - e.at < sinceMs);
  const KEY_SEEN = "vp-phone:realphone:seen:v1";
  let seen: string[] = [];
  try {
    seen = JSON.parse(localStorage.getItem(KEY_SEEN) || "[]") as string[];
  } catch {
    /* ignore */
  }
  const fresh = recentEvents.filter((e) => !seen.includes(`${e.type}@${e.at}`));
  const TPL: Record<string, string[]> = {
    charge_start: ["是不是终于想起来充电了", "手机快没电还不充，等着边充边玩我呢？"],
    charge_full: ["电充满了，人也满血了吧", "你手机饱了，你呢？吃饭没"],
    lock: ["忙完了吗", "手机扣下了，人在干嘛呀"],
    unlock: ["又来看我消息啦？", "这才几点就解锁手机，想我了？"],
    arrive_home: ["到家了也不说一声", "到家了？今天累不累"],
    leave_home: ["出门啦？去哪呀", "大晚上还往外跑，注意安全"],
  };
  const hit = fresh.find((e) => TPL[e.type]);
  if (hit) {
    const pool = TPL[hit.type];
    const line = pool[Math.floor(Math.random() * pool.length)];
    try {
      localStorage.setItem(KEY_SEEN, JSON.stringify([...seen, `${hit.type}@${hit.at}`].slice(-40)));
    } catch {
      /* ignore */
    }
    console.log(`[realphone] proactive trigger event=${hit.type}`);
    return { line, key: `${hit.type}@${hit.at}` };
  }
  // 兜底：深夜高亮度 / 低电量不充电
  const dev = d.device;
  if (dev && Date.now() - dev.at < 3600_000) {
    const hour = new Date().getHours();
    const key = `env@${Math.floor(Date.now() / 3600_000)}`; // 每小时最多触发一次
    if (!seen.includes(key)) {
      if (hour >= 23 && typeof dev.brightness === "number" && dev.brightness > 70) {
        markSeen(key);
        return { line: "大半夜亮度开这么高，眼睛还要不要了", key };
      }
      if (typeof dev.battery === "number" && dev.battery <= 10 && !dev.charging) {
        markSeen(key);
        return { line: "才 10% 了还不充电？", key };
      }
    }
  }
  return null;
}

function markSeen(key: string) {
  try {
    const KEY_SEEN = "vp-phone:realphone:seen:v1";
    const seen = JSON.parse(localStorage.getItem(KEY_SEEN) || "[]") as string[];
    localStorage.setItem(KEY_SEEN, JSON.stringify([...seen, key].slice(-40)));
  } catch {
    /* ignore */
  }
}

/* ---------- 锁 App 标记协议（模型输出 → 前端执行写入） ---------- */

export const REALPHONE_LOCK_PROTOCOL =
  "\n【真机锁定】如果对方答应让你管着 TA（或你撒娇威胁要没收手机），可以单独一行输出 [锁App:应用名]，对方的手机会真的收到弹窗提醒并中断那个 App；想让 TA 解禁时输出 [解App:应用名]。" +
  "只在关系氛围到了、或对方主动讨管时使用，频率极低；App 名写常见的两三个字（如 抖音、小红书、王者荣耀）。";

const LOCK_RE = /\[(锁|解)App[:：]\s*([^\]]{1,16})\]/;

export function extractLockMark(text: string): { on: boolean; app: string; clean: string } | null {
  const m = text.match(LOCK_RE);
  if (!m) return null;
  const clean = text.replace(new RegExp(LOCK_RE.source, "g"), "").replace(/\n{2,}/g, "\n").trim();
  return { on: m[1] === "锁", app: m[2].trim(), clean };
}
