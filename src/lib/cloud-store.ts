// 云存档数据层：把本机全部 vp-phone:* localStorage 数据打包成快照存云端（vp_snapshots 表），
// 其中 base64 图片自动抽取上传到私有桶 vp-assets（users/<uid>/ 命名空间），原位替换为签名 URL。
// 恢复时反向写回 localStorage，并给每个被改写的 key 留一份本机保险副本（vp-phone:pre-restore:*）。
import { supabase } from "@/supabase/client";

const BUCKET = "a1b2c3d4-0000-4000-8000-000000000001"; // storage.buckets.id（name=vp-assets，查询确认）
const PREFIX = "vp-phone:";
const LAST_BACKUP_KEY = "vp-phone:cloud:last-backup:v1";
const AUTO_BACKUP_KEY = "vp-phone:cloud:auto:v1";
const DIRTY_KEY = "vp-phone:cloud:dirty:v1";
const SIGNED_TTL = 60 * 60 * 24 * 365; // 签名 URL 一年；恢复时会整体重签

export interface SnapshotMeta {
  updatedAt: number;
  sizeBytes: number;
  entries: number;
}

export interface BackupProgress {
  stage: "scan" | "upload" | "save";
  done: number;
  total: number;
}

export interface BackupResult {
  ok: boolean;
  images: number;
  bytes: number;
  error?: string;
}

export interface RestoreResult {
  ok: boolean;
  entries: number;
  error?: string;
}

/** data URL 判定：只抽 base64 图片；http(s) CDN 地址原样保留 */
const DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,/i;

function extOf(mime: string): string {
  if (/jpeg|jpg/i.test(mime)) return "jpg";
  if (/webp/i.test(mime)) return "webp";
  if (/gif/i.test(mime)) return "gif";
  return "png";
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(",");
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? "image/png";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** FNV-1a 内容哈希：同一张图重复备份不重新上传（配合 upsert 覆盖同名路径） */
function hashStr(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0") + "_" + s.length.toString(16);
}

/** 枚举本机全部业务数据 key（排除云存档自身的控制位） */
export function localDataKeys(): string[] {
  const skip = new Set([LAST_BACKUP_KEY, AUTO_BACKUP_KEY, DIRTY_KEY]);
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX) && !skip.has(k)) out.push(k);
  }
  return out;
}

export function readLastBackupAt(): number {
  return Number(localStorage.getItem(LAST_BACKUP_KEY) || 0);
}

export function isAutoBackupOn(): boolean {
  return localStorage.getItem(AUTO_BACKUP_KEY) !== "0"; // 默认开
}

export function setAutoBackup(on: boolean): void {
  localStorage.setItem(AUTO_BACKUP_KEY, on ? "1" : "0");
}

/** 本地数据是否有新改动（任意 vp-phone: 写入都会打脏标记） */
export function isDirty(): boolean {
  return localStorage.getItem(DIRTY_KEY) === "1";
}

/** 安装一次全局写入监听：任何 vp-phone: 键变化都标记为未备份（幂等，可重复调用） */
let dirtyHookInstalled = false;
export function installDirtyTracker(): void {
  if (dirtyHookInstalled) return;
  dirtyHookInstalled = true;
  const proto = Storage.prototype;
  const origSet = proto.setItem;
  const origRemove = proto.removeItem;
  proto.setItem = function (key: string, value: unknown) {
    if (typeof key === "string" && key.startsWith(PREFIX) && key !== DIRTY_KEY) {
      try {
        origSet.call(this, DIRTY_KEY, "1");
      } catch {
        /* ignore */
      }
    }
    return origSet.call(this, key, value as string);
  };
  proto.removeItem = function (key: string) {
    if (typeof key === "string" && key.startsWith(PREFIX) && key !== DIRTY_KEY) {
      try {
        origSet.call(this, DIRTY_KEY, "1");
      } catch {
        /* ignore */
      }
    }
    return origRemove.call(this, key);
  };
}

/** 深度遍历 JSON：把 data URL 收进池子并用占位符替换（占位符带扩展名，恢复时无需试探） */
function extractImages(node: unknown, pool: Map<string, string>): unknown {
  if (typeof node === "string") {
    if (DATA_URL_RE.test(node)) {
      const mime = /data:([^;]+)/.exec(node)?.[1] ?? "image/png";
      const ext = extOf(mime);
      const id = `${hashStr(node)}.${ext}`;
      if (!pool.has(id)) pool.set(id, node);
      return `__vpimg_${id}__`;
    }
    return node;
  }
  if (Array.isArray(node)) return node.map((v) => extractImages(v, pool));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = extractImages(v, pool);
    return out;
  }
  return node;
}

/** 反向替换：把 __vpimg_xxx.ext__ 换成新的签名 URL；查不到给空串（文字记录不受影响） */
function injectUrls(node: unknown, urls: Map<string, string>): unknown {
  if (typeof node === "string") {
    const m = /^__vpimg_(.+?)__$/.exec(node);
    return m ? urls.get(m[1]) ?? "" : node;
  }
  if (Array.isArray(node)) return node.map((v) => injectUrls(v, urls));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) out[k] = injectUrls(v, urls);
    return out;
  }
  return node;
}

/** 立即备份：捕获 → 抽图上传统桶 → upsert 快照行 */
export async function backupNow(onProgress?: (p: BackupProgress) => void): Promise<BackupResult> {
  const { data: sess, error: sessErr } = await supabase.auth.getSession();
  const uid = sess.session?.user.id;
  if (sessErr || !uid) return { ok: false, images: 0, bytes: 0, error: "请先登录账号" };

  onProgress?.({ stage: "scan", done: 0, total: 0 });
  const keys = localDataKeys();
  const raw: Record<string, unknown> = {};
  for (const k of keys) {
    const v = localStorage.getItem(k);
    if (v === null) continue;
    try {
      raw[k] = JSON.parse(v);
    } catch {
      raw[k] = v; // 非 JSON 的裸字符串（如密码、开关）
    }
  }

  const pool = new Map<string, string>();
  const cleaned = extractImages(raw, pool);
  const json = JSON.stringify(cleaned);
  const bytes = new Blob([json]).size;

  // 上传抽出的图片（按内容哈希命名，upsert 覆盖即幂等）
  let done = 0;
  for (const [id, dataUrl] of pool) {
    onProgress?.({ stage: "upload", done, total: pool.size });
    const blob = dataUrlToBlob(dataUrl);
    const path = `users/${uid}/${id}.${extOf(blob.type)}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: blob.type });
    if (error) {
      console.warn(`[cloud] image upload fail ${id}: ${error.message}`);
      // 单图失败不阻断整体：保留占位符，恢复后该图为空串（文字记录不受影响）
    }
    done++;
  }

  onProgress?.({ stage: "save", done: 0, total: 0 });
  const now = Date.now();
  const { error } = await supabase.from("vp_snapshots").upsert({
    user_id: uid,
    data: json as never,
    size_bytes: bytes,
    entries: keys.length,
    updated_at: now,
  });
  if (error) {
    console.warn(`[cloud] backup fail: ${error.message}`);
    return { ok: false, images: pool.size, bytes, error: error.message };
  }
  localStorage.setItem(LAST_BACKUP_KEY, String(now));
  localStorage.setItem(DIRTY_KEY, "0");
  console.log(`[cloud] backup ok keys=${keys.length} imgs=${pool.size} bytes=${bytes}`);
  return { ok: true, images: pool.size, bytes };
}

/** 云端快照元信息（不存在返回 null） */
export async function fetchSnapshotMeta(): Promise<SnapshotMeta | null> {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from("vp_snapshots")
    .select("updated_at,size_bytes,entries")
    .eq("user_id", uid)
    .maybeSingle();
  if (error || !data) return null;
  return { updatedAt: Number(data.updated_at), sizeBytes: Number(data.size_bytes), entries: Number(data.entries) };
}

/** 从云端恢复：拉快照 → 图片重签 URL → 覆盖写回 localStorage（旧值先留底） */
export async function restoreNow(): Promise<RestoreResult> {
  const { data: sess } = await supabase.auth.getSession();
  const uid = sess.session?.user.id;
  if (!uid) return { ok: false, entries: 0, error: "请先登录账号" };
  const { data: row, error } = await supabase.from("vp_snapshots").select("data").eq("user_id", uid).maybeSingle();
  if (error) return { ok: false, entries: 0, error: error.message };
  if (!row) return { ok: false, entries: 0, error: "云端还没有存档" };

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(String(row.data)) as Record<string, unknown>;
  } catch {
    return { ok: false, entries: 0, error: "存档数据已损坏" };
  }

  // 收集全部占位符 id（含扩展名）→ 批量重签新鲜 URL（私有桶签名会过期）
  const ids = new Set<string>();
  JSON.stringify(parsed).replace(/__vpimg_(.+?)__/g, (_m, id: string) => {
    ids.add(id);
    return _m;
  });
  const idList = [...ids];
  const urls = new Map<string, string>();
  if (idList.length) {
    const paths = idList.map((id) => `users/${uid}/${id}`);
    const { data: signed, error: signErr } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_TTL);
    if (signErr) console.warn(`[cloud] resign fail: ${signErr.message}`);
    signed?.forEach((s, i) => {
      if (s.signedUrl) urls.set(idList[i], s.signedUrl);
    });
  }

  const restored = injectUrls(parsed, urls);

  let count = 0;
  for (const [k, v] of Object.entries(restored as Record<string, unknown>)) {
    if (!k.startsWith(PREFIX)) continue;
    const prevVal = localStorage.getItem(k);
    if (prevVal !== null) {
      try {
        localStorage.setItem(`${PREFIX}pre-restore:${k.slice(PREFIX.length)}`, prevVal);
      } catch {
        /* 留底失败不阻断 */
      }
    }
    localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
    count++;
  }
  localStorage.setItem(DIRTY_KEY, "0");
  console.log(`[cloud] restore ok keys=${count} imgs=${urls.size}`);
  return { ok: true, entries: count };
}

/** 广播刷新：恢复后各 usePersisted 组件实例需要重新读取存储——整页重载最可靠 */
export function reloadApp(): void {
  window.location.reload();
}
