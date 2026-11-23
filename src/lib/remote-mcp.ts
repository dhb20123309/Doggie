// 远程 MCP 安全导入：只读取明确约定的配置清单，绝不执行仓库代码。
// 原则：安装前展示域名/工具/权限/认证 → 拦截 localhost/内网/file:/重定向 →
// 每次高危调用二次确认 → 调用日志遮盖 token 与私人内容 → 支持移除服务与清除授权。
import { useEffect, useState } from "react";

const SERVERS_KEY = "vp-phone:mcp-servers:v1";
const LOG_KEY = "vp-phone:mcp-log:v1";
const MAX_LOG = 60;

/* ---------- 类型契约 ---------- */

export interface RemoteMcpServer {
  id: string;
  name: string;
  /** https 端点（安装时已去 query/hash） */
  url: string;
  host: string;
  auth: AuthKind;
  addedAt: number;
}

export type AuthKind = "none" | "bearer" | "apikey";

export interface McpToolMeta {
  name: string;
  description: string;
  risk: "low" | "high";
  /** 是否涉及私人内容（消息、文件、账号数据等） */
  private: boolean;
}

/** 约定配置清单（GitHub 仓库或服务器根路径下的 mcp.json） */
export interface McpManifest {
  name?: string;
  endpoint?: string;
  transport?: string;
  auth?: { type?: string; header?: string };
  tools?: { name?: string; description?: string; sideEffect?: boolean; isPrivate?: boolean }[];
}

export interface McpCallLog {
  id: string;
  serverId: string;
  serverName: string;
  tool: string;
  at: number;
  ok: boolean;
  note: string;
}

/* ---------- URL 安全校验 ---------- */

function ipToInt(p: string): number | null {
  const parts = p.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const seg of parts) {
    if (!/^\d{1,3}$/.test(seg)) return null;
    const v = Number(seg);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/** 压缩记法展开为完整 8 段；非法格式返回 null（按可疑地址拒绝） */
function expandIpv6(body: string): string[] | null {
  const b = body.replace(/^\[|\]$/g, "").toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(b)) return null;
  let head = b, tailSegs: string[] = [];
  if (b.includes(".")) {
    const i = b.lastIndexOf(":");
    const v4 = ipToInt(b.slice(i + 1));
    if (v4 === null) return null;
    head = b.slice(0, i);
    tailSegs = [(v4 >>> 16).toString(16), (v4 & 0xffff).toString(16)];
  }
  const fill = (s: string) => (s ? s.split(":") : []);
  if (head.includes("::")) {
    const parts = head.split("::");
    if (parts.length !== 2) return null;
    const left = fill(parts[0]);
    const right = [...fill(parts[1]), ...tailSegs];
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    return [...left, ...Array(missing).fill("0"), ...right];
  }
  const segs = [...fill(head), ...tailSegs];
  return segs.length === 8 ? segs : null;
}

/** 逐段判定：ULA fc00::/7、link-local fe80::/10、组播 ff00::/8、未指定/回环及保留低段一律拦截 */
function isPrivateIpv6(host: string): boolean {
  const segs = expandIpv6(host);
  if (!segs) return true;
  const first = parseInt(segs[0], 16);
  if (segs.every((s) => /^0+$/.test(s))) return true; // :: 与 ::ffff:0:0 等全零尾
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 组播
  if (first === 0 && parseInt(segs[1], 16) === 0 && parseInt(segs[2], 16) === 0 && parseInt(segs[3], 16) === 0 && parseInt(segs[4], 16) === 0) {
    const sixth = parseInt(segs[5], 16);
    // ::/96 与 IPv4 兼容/映射地址：看尾部 v4 是否内网
    if (sixth === 0 || sixth === 0xffff) {
      const v4 = (parseInt(segs[6], 16) << 16) + parseInt(segs[7], 16);
      return isPrivateV4(v4);
    }
    return true;
  }
  return false;
}

function isPrivateV4(n: number): boolean {
  const a = Math.floor(n / 2 ** 24);
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10/8
    a === 127 || // loopback
    a === 169 || // 169.254 link-local
    a === 172 || // 172.16/12
    a === 192 || // 192.0.0.0/24、192.0.2.0/24、192.168/16
    a === 198 // 198.18/15、198.51.100/24
  );
}

export function validateMcpUrl(raw: string): { ok: boolean; reason?: string; host?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "地址为空" };
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, reason: "无法识别的地址格式" };
  }
  if (u.protocol === "file:") return { ok: false, reason: "禁止 file:// 本地文件地址" };
  if (u.protocol !== "https:") {
    return { ok: false, reason: u.protocol === "http:" ? "禁止 http 明文连接，必须使用 https" : `不支持 ${u.protocol} 协议，仅允许 https` };
  }
  // 用户名/密码内嵌与 query token 均属危险写法，先剥掉再校验主机
  if (u.username || u.password) return { ok: false, reason: "已拦截地址内嵌的用户名/密码写法，请勿在 URL 里携带凭据" };
  let host = u.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (!host) return { ok: false, reason: "缺少主机名" };
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return { ok: false, reason: `已拦截本地地址「${host}」：远程 MCP 不允许指向本机` };
  }
  const v4 = ipToInt(host);
  if (v4 !== null) {
    if (isPrivateV4(v4)) return { ok: false, reason: `已拦截内网/保留地址「${host}」，防止访问你的局域网` };
    return { ok: true, host };
  }
  if (host.includes(":")) {
    if (isPrivateIpv6(host)) return { ok: false, reason: `已拦截内网 IPv6 地址「${host}」` };
    return { ok: true, host };
  }
  // 纯数字主机名是十进制编码 IP（SSRF 常见绕过手法），一律拒绝
  if (/^\d+$/.test(host)) return { ok: false, reason: "已拦截编码形式的 IP 地址，请直接填写标准域名" };
  if (!host.includes(".")) return { ok: false, reason: "域名不完整，请使用带点的公网域名" };
  return { ok: true, host };
}

/** 去掉 query/hash——token 严禁留在持久化地址里 */
export function stripUrlSecrets(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return raw.trim();
  }
}

/* ---------- GitHub 仓库链接 → 约定配置文件直读 ---------- */

interface RepoRef {
  owner: string;
  repo: string;
}

function parseRepo(input: string): RepoRef | null {
  const t = input.trim();
  const m =
    t.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/) ??
    t.match(/^@?([\w.-]+)\/([\w.-]+)$/); // git@github.com:a/b 简写或 owner/repo
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, "") };
}

/** 返回候选的 mcp.json 原始链接（只读明确约定的配置文件，不碰源码） */
export function manifestCandidatesFor(input: string): { kind: "github" | "url"; label: string; urls: string[] } | null {
  const repo = parseRepo(input);
  if (repo) {
    const base = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}`;
    return {
      kind: "github",
      label: `${repo.owner}/${repo.repo}`,
      urls: [`${base}/HEAD/mcp.json`, `${base}/main/mcp.json`, `${base}/master/mcp.json`],
    };
  }
  const v = validateMcpUrl(input);
  if (v.ok) {
    const u = new URL(stripUrlSecrets(input));
    const dir = u.pathname.endsWith("/") ? u.pathname : u.pathname.replace(/[^/]*$/, "");
    return {
      kind: "url",
      label: v.host as string,
      urls: [`${u.origin}${dir}mcp.json`.replace(/\/{2,}(?=[^:])/, "/")],
    };
  }
  return null;
}

/** 跟随重定向并逐跳复检安全策略；任何一跳违规即拦截 */
async function safeFetch(url: string, signal?: AbortSignal): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= 5; hop++) {
    const check = validateMcpUrl(current);
    if (!check.ok) throw new Error(`重定向被安全策略拦截：${check.reason}（跳转至 ${current}）`);
    const res = await fetch(current, { redirect: "manual", signal });
    if (res.status >= 301 && res.status <= 308) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error("重定向次数过多，已按危险重定向处理");
}

export function parseManifest(text: string): { ok: boolean; manifest?: McpManifest; reason?: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: "配置文件不是合法 JSON，无法读取工具约定" };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return { ok: false, reason: "配置清单格式不正确" };
  const mf = json as McpManifest;
  if (!mf.endpoint || typeof mf.endpoint !== "string") return { ok: false, reason: "配置清单缺少 endpoint 服务地址" };
  return { ok: true, manifest: mf };
}

/* ---------- 安装预览（步骤 3：域名/工具/权限/认证） ---------- */

export interface InstallPreview {
  sourceLabel: string;
  kind: "github" | "url";
  name: string;
  endpoint: string;
  host: string;
  auth: AuthKind;
  tools: McpToolMeta[];
  warnings: string[];
}

const AUTH_LABELS: Record<string, AuthKind> = { none: "none", noauth: "none", bearer: "bearer", oauth: "bearer", apikey: "apikey", api_key: "apikey", key: "apikey" };

export async function inspectSource(input: string, signal?: AbortSignal): Promise<{ ok: boolean; preview?: InstallPreview; reason?: string }> {
  const cand = manifestCandidatesFor(input);
  if (!cand) {
    const v = validateMcpUrl(input);
    return { ok: false, reason: v.ok ? "仅支持 https 服务地址或 GitHub 仓库链接" : v.reason ?? "地址无效" };
  }
  let lastErr = "未找到约定的 mcp.json 配置清单";
  for (const url of cand.urls) {
    try {
      const res = await safeFetch(url, signal);
      if (!res.ok) {
        lastErr = `读取配置失败（HTTP ${res.status}）`;
        continue;
      }
      const parsed = parseManifest(await res.text());
      if (!parsed.ok || !parsed.manifest) return { ok: false, reason: parsed.reason ?? "无法读取配置清单" };
      const mf = parsed.manifest;
      if (!mf.endpoint) return { ok: false, reason: "配置清单缺少 endpoint 服务地址" };
      const epCheck = validateMcpUrl(mf.endpoint);
      if (!epCheck.ok) return { ok: false, reason: `服务地址不安全：${epCheck.reason}` };
      const endpoint = stripUrlSecrets(mf.endpoint);
      const auth: AuthKind = AUTH_LABELS[(mf.auth?.type ?? "").toLowerCase()] ?? (mf.auth?.type ? "apikey" : "none");
      const tools: McpToolMeta[] = (mf.tools ?? []).slice(0, 40).map((t) => ({
        name: String(t?.name ?? "未命名工具").slice(0, 48),
        description: String(t?.description ?? "").slice(0, 120),
        risk: t?.sideEffect ? "high" : "low",
        private: Boolean(t?.isPrivate),
      }));
      const warnings: string[] = [];
      if (!tools.length) warnings.push("该服务没有声明工具清单，安装后不会向 AI 开放任何能力");
      if (cand.kind === "url" && new URL(endpoint).origin !== new URL(cand.urls[0]).origin) warnings.push(`注意：配置声明的服务域名（${epCheck.host}）与仓库不同源`);
      if (auth !== "none") warnings.push("该服务需要认证密钥，保存后仅存在本机浏览器，不会上传；请确认你信任该服务提供方");
      return {
        ok: true,
        preview: { sourceLabel: cand.label, kind: cand.kind, name: (mf.name ?? cand.label).slice(0, 30), endpoint, host: epCheck.host as string, auth, tools, warnings },
      };
    } catch (e) {
      if (signal?.aborted) return { ok: false, reason: "已取消" };
      lastErr = e instanceof Error ? e.message : "网络读取失败";
    }
  }
  return { ok: false, reason: lastErr };
}

/* ---------- 服务持久化（用户确认后才落库） ---------- */

export function loadServers(): RemoteMcpServer[] {
  try {
    const arr = JSON.parse(localStorage.getItem(SERVERS_KEY) || "[]") as RemoteMcpServer[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveServers(list: RemoteMcpServer[]) {
  try {
    localStorage.setItem(SERVERS_KEY, JSON.stringify(list.slice(0, 8)));
  } catch {
    /* 隐私模式忽略 */
  }
}

export function addServer(preview: InstallPreview, auth: AuthKind): RemoteMcpServer {
  const s: RemoteMcpServer = {
    id: `rs${Date.now()}`,
    name: preview.name,
    url: preview.endpoint,
    host: preview.host,
    auth,
    addedAt: Date.now(),
  };
  saveServers([...loadServers(), s]);
  console.log(`[mcp-remote] installed ${s.name} host=${s.host} auth=${auth}`);
  return s;
}

export function removeServer(id: string) {
  saveServers(loadServers().filter((s) => s.id !== id));
  writeLogEntries(loadLog().filter((l) => l.serverId !== id));
  console.log(`[mcp-remote] removed server=${id}`);
}

/** 清除授权：抹掉密钥引用并停用全部工具授权 */
export function revokeAuth(id: string) {
  try {
    localStorage.removeItem(`vp-phone:mcp-key:${id}`);
  } catch {
    /* ignore */
  }
  const list = loadServers().map((s) => (s.id === id ? { ...s, auth: "none" as AuthKind } : s));
  saveServers(list);
  console.log(`[mcp-remote] auth revoked server=${id}`);
}

export function setServerKey(id: string, key: string) {
  try {
    if (key.trim()) localStorage.setItem(`vp-phone:mcp-key:${id}`, key.trim());
    else localStorage.removeItem(`vp-phone:mcp-key:${id}`);
  } catch {
    /* ignore */
  }
}

export function hasServerKey(id: string): boolean {
  try {
    return Boolean(localStorage.getItem(`vp-phone:mcp-key:${id}`));
  } catch {
    return false;
  }
}

/* ---------- 调用日志（遮盖 token 与私人内容） ---------- */

export function loadLog(): McpCallLog[] {
  try {
    const arr = JSON.parse(localStorage.getItem(LOG_KEY) || "[]") as McpCallLog[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeLogEntries(entries: McpCallLog[]) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(entries.slice(-MAX_LOG)));
  } catch {
    /* ignore */
  }
}

const SECRET_RES = [
  /(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi,
  /(api[_-]?key["'\s:=]+)[^\s"',}]+/gi,
  /(sk-|pk-|rk-)[A-Za-z0-9_-]{8,}/g,
  /([?&](?:key|token|access_token)=)[^&\s"]+/gi,
];

export function maskSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_RES) out = out.replace(re, (_m, p1) => `${p1}••••`);
  return out;
}

function appendLog(server: RemoteMcpServer, tool: string, ok: boolean, note: string) {
  const entry: McpCallLog = { id: `l${Date.now()}${Math.random().toString(36).slice(2, 5)}`, serverId: server.id, serverName: server.name, tool, at: Date.now(), ok, note: maskSecrets(note).slice(0, 140) };
  writeLogEntries([...loadLog(), entry]);
  console.log(`[mcp-remote] call log ${server.name}/${tool} ${ok ? "ok" : "fail"}`);
}

export function clearLog() {
  writeLogEntries([]);
}

/* ---------- 运行时调用（每次高危再次确认由 UI 层完成后再调这里） ---------- */

export interface CallResult {
  ok: boolean;
  text: string;
  /** 返回给模型的正文（已截断遮罩） */
  content: string;
}

export async function callTool(server: RemoteMcpServer, tool: McpToolMeta, args: Record<string, unknown>, confirmed: boolean): Promise<CallResult> {
  if (tool.risk === "high" && !confirmed) {
    appendLog(server, tool.name, false, "高危调用未经用户确认，已拒绝");
    return { ok: false, text: "该操作需要你确认后才会执行", content: "" };
  }
  const check = validateMcpUrl(server.url);
  if (!check.ok) return { ok: false, text: `服务地址已被安全策略拒绝：${check.reason}`, content: "" };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = (() => {
    try {
      return localStorage.getItem(`vp-phone:mcp-key:${server.id}`) || "";
    } catch {
      return "";
    }
  })();
  if (server.auth === "bearer" && key) headers.Authorization = `Bearer ${key}`;
  if (server.auth === "apikey" && key) headers["X-API-Key"] = key;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(server.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: tool.name, arguments: args } }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      appendLog(server, tool.name, false, `HTTP ${res.status}`);
      return { ok: false, text: `调用失败（HTTP ${res.status}）`, content: "" };
    }
    let summary = "已完成";
    let content = "";
    try {
      const j = JSON.parse(text) as { result?: { content?: { text?: string }[] }; error?: { message?: string } };
      if (j.error?.message) {
        appendLog(server, tool.name, false, j.error.message);
        return { ok: false, text: `服务返回错误：${maskSecrets(j.error.message).slice(0, 60)}`, content: "" };
      }
      content = (j.result?.content ?? []).map((c) => c.text ?? "").join("\n").slice(0, 2000);
      summary = content ? `返回 ${content.length} 字` : "无正文返回";
    } catch {
      content = text.slice(0, 800);
      summary = "非 JSON 响应";
    }
    appendLog(server, tool.name, true, `${summary}${tool.private ? " · 结果含私人内容，仅本次会话可见" : ""}`);
    return { ok: true, text: `已调用 ${server.name}·${tool.name}（${summary}）`, content: maskSecrets(content) };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "请求超时（15 秒）" : e.message) : "网络错误";
    appendLog(server, tool.name, false, msg);
    return { ok: false, text: `调用失败：${msg}`, content: "" };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- AI 侧协议与标记解析 ---------- */

/** 拼进 system 的远程能力清单（无服务时返回空串） */
export function buildRemoteMcpContext(servers: RemoteMcpServer[], toolCache: Record<string, McpToolMeta[]>): string {
  if (!servers.length) return "";
  const lines = ["\n【远程 MCP 服务】以下是你已获授权连接的第三方服务，可在对方要求时使用："];
  for (const s of servers) {
    const tools = toolCache[s.id] ?? [];
    lines.push(`- ${s.name}（${s.host}）：${tools.length ? tools.map((t) => `${t.name}${t.risk === "high" ? "〔高危〕" : ""}${t.private ? "〔涉私〕" : ""}`).join("、") : "未声明工具"}`);
  }
  lines.push(
    "使用方式：单独一行输出 [远程MCP:服务名:工具名:参数JSON]（参数为 JSON 对象，可省略则写 {}）。",
    "规则：只在对方明确要求或明显需要时调用；标注〔高危〕的工具系统会先向对方二次确认；〔涉私〕工具的返回只做摘要转述，不得整段复述原文；绝不调用未在清单中的工具。",
  );
  return lines.join("\n");
}

const REMOTE_RE = /^\[远程MCP[:：]\s*([^:\]]{1,30})\s*[:：]\s*([^:\]]{1,48})\s*(?:[:：]\s*(\{[\s\S]*\}))?\]$/;

export interface RemoteMcpMark {
  serverName: string;
  toolName: string;
  args: Record<string, unknown>;
}

export function extractRemoteMarks(reply: string): { clean: string; marks: RemoteMcpMark[] } {
  const marks: RemoteMcpMark[] = [];
  const kept: string[] = [];
  for (const line of reply.split(/\r?\n/)) {
    const m = line.trim().match(REMOTE_RE);
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

/* ---------- 工具清单缓存（安装时抓一次，供上下文拼接） ---------- */

const TOOLS_CACHE_KEY = "vp-phone:mcp-tools-cache:v1";

export function loadToolCache(): Record<string, McpToolMeta[]> {
  try {
    return JSON.parse(localStorage.getItem(TOOLS_CACHE_KEY) || "{}") as Record<string, McpToolMeta[]>;
  } catch {
    return {};
  }
}

export function saveToolCache(cache: Record<string, McpToolMeta[]>) {
  try {
    localStorage.setItem(TOOLS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

export function useRemoteServers(): { servers: RemoteMcpServer[]; reload: () => void } {
  const [servers, setServers] = useState<RemoteMcpServer[]>(loadServers);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SERVERS_KEY) setServers(loadServers());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return { servers, reload: () => setServers(loadServers()) };
}
