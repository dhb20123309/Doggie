// 远程 MCP 安全导入：只读取明确约定的配置清单，绝不执行仓库代码。
// 原则：安装前展示域名/工具/权限/认证 → 拦截 localhost/内网/file:/重定向 →
// 每次高危调用二次确认 → 调用日志遮盖 token 与私人内容 → 支持移除服务与清除授权。
import { useEffect, useState } from "react";

const SERVERS_KEY = "vp-phone:mcp-servers:v1";
const LOG_KEY = "vp-phone:mcp-log:v1";
const MAX_LOG = 60;

/* ---------- 类型契约 ---------- */

export type AuthKind = "none" | "bearer" | "apikey" | "oauth";

/** OAuth 公开客户端参数（严禁 client secret） */
export interface OAuthParams {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  scope?: string;
  revokeUrl?: string;
}

export interface RemoteMcpServer {
  id: string;
  name: string;
  /** https 端点（安装时已去 query/hash） */
  url: string;
  host: string;
  auth: AuthKind;
  addedAt: number;
  oauth?: OAuthParams;
  /** 中风险工具首次授权记录（toolName → 授权时间） */
  mediumConsents?: Record<string, number>;
}

export interface McpToolMeta {
  name: string;
  description: string;
  /** 低=可自动调用并显示来源；中=涉私读取，首次授权并明确范围；高=写操作，每次展示参数确认 */
  risk: "low" | "medium" | "high";
  /** 是否涉及私人内容（消息、文件、账号数据等） */
  private: boolean;
}

/** 约定配置清单（GitHub 仓库或服务器根路径下的 mcp.json） */
export interface McpManifest {
  name?: string;
  endpoint?: string;
  transport?: string;
  auth?: { type?: string; header?: string };
  oauth?: Partial<OAuthParams>;
  tools?: { name?: string; description?: string; sideEffect?: boolean; isPrivate?: boolean; risk?: string }[];
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

/* ---------- MCP 标准握手（Streamable HTTP：initialize → tools/list） ---------- */

const PROTOCOL_VERSION = "2025-03-26";

/** 从端点推导 OAuth issuer（RFC 8414：https://host/.well-known/oauth-authorization-server） */
function oauthIssuerFromEndpoint(endpoint: string): string | null {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "https:") return null;
    return `${u.origin}/.well-known/oauth-authorization-server`;
  } catch {
    return null;
  }
}

/** 按 RFC 8414 依次探测授权服务器元数据（含 MCP 路径后缀变体），命中即返回 */
async function discoverOAuthMeta(endpoint: string, signal?: AbortSignal): Promise<Partial<OAuthParams> | null> {
  const candidates: string[] = [];
  const derived = oauthIssuerFromEndpoint(endpoint);
  if (derived) {
    candidates.push(derived);
    try {
      const u = new URL(endpoint);
      const path = u.pathname.replace(/\/+$/, "");
      if (path && path !== "/") {
        candidates.push(`${u.origin}${path}/.well-known/oauth-authorization-server`);
        // issuer 只到第一段路径（如 https://host/galatea）
        const firstSeg = path.split("/")[1];
        if (firstSeg) candidates.push(`${u.origin}/${firstSeg}/.well-known/oauth-authorization-server`);
      }
    } catch {
      /* ignore */
    }
  }
  for (const url of candidates) {
    if (!validateMcpUrl(url).ok) continue;
    try {
      const res = await fetch(url, { redirect: "manual", signal });
      if (!res.ok) continue;
      const j = (await res.json().catch(() => null)) as { authorization_endpoint?: string; token_endpoint?: string; registration_endpoint?: string; scopes_supported?: string[] } | null;
      if (!j?.authorization_endpoint || !j?.token_endpoint) continue;
      console.log(`[mcp-remote] oauth meta discovered via ${new URL(url).pathname}`);
      return { authorizeUrl: j.authorization_endpoint, tokenUrl: j.token_endpoint };
    } catch {
      /* 下一候选 */
    }
  }
  return null;
}

interface RpcInit {
  protocolVersion?: string;
  serverInfo?: { name?: string; title?: string };
  instructions?: string;
}

/**
 * 直连 MCP 端点完成 initialize + tools/list。
 * 兼容 JSON 响应与 SSE（text/event-stream）帧；401 时自动探测 OAuth 元数据供 UI 引导授权。
 */
async function rpcDirectProbe(endpoint: string, bearer?: string, signal?: AbortSignal): Promise<{ ok: boolean; reason?: string; init?: RpcInit; tools?: unknown[]; unauthorized?: boolean; oauthHint?: Partial<OAuthParams> }> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const post = async (method: string, params: unknown, id: number) => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      signal,
    });
    return res;
  };
  /** 响应体可能是 JSON，也可能是 SSE 帧（data: {...}），统一解析出 JSON-RPC message */
  const parseBody = async (res: Response): Promise<{ result?: unknown; error?: { message?: string; code?: number } } | null> => {
    const text = await res.text();
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/event-stream")) {
      let last: unknown = null;
      for (const line of text.split(/\r?\n/)) {
        if (!line.startsWith("data:")) continue;
        try {
          last = JSON.parse(line.slice(5).trim());
        } catch {
          /* 忽略非 JSON 帧 */
        }
      }
      return (last as { result?: unknown; error?: { message?: string } }) ?? null;
    }
    try {
      return JSON.parse(text) as { result?: unknown; error?: { message?: string } };
    } catch {
      return null;
    }
  };
  try {
    let res = await post("initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "vp-phone", version: "1.0" } }, 1);
    if (res.status === 401 || res.status === 403) {
      const unauthorized = res.status === 401;
      const oauthHint = unauthorized ? (await discoverOAuthMeta(endpoint, signal)) ?? undefined : undefined;
      return { ok: false, unauthorized, oauthHint, reason: unauthorized ? "该服务需要 OAuth 登录授权后才能获取工具清单" : `服务端拒绝访问（HTTP ${res.status}）` };
    }
    const initMsg = await parseBody(res);
    if (!res.ok || !initMsg || initMsg.error) {
      return { ok: false, reason: `握手失败：${initMsg?.error?.message ?? `HTTP ${res.status}`}` };
    }
    const init = initMsg.result as RpcInit;
    // notifications/initialized 尽力通知（失败不阻断）
    await post("notifications/initialized", {}, 2).catch(() => undefined);
    const listRes = await post("tools/list", {}, 3);
    if (listRes.status === 401 || listRes.status === 403) {
      const oauthHint = listRes.status === 401 ? (await discoverOAuthMeta(endpoint, signal)) ?? undefined : undefined;
      return { ok: true, init, tools: [], unauthorized: listRes.status === 401, oauthHint, reason: "已连接但工具清单需授权后可见" };
    }
    const listMsg = await parseBody(listRes);
    if (!listRes.ok || !listMsg || listMsg.error) {
      return { ok: true, init, tools: [], reason: `工具清单读取失败：${listMsg?.error?.message ?? `HTTP ${listRes.status}`}` };
    }
    const tools = ((listMsg.result as { tools?: unknown[] })?.tools ?? []) as unknown[];
    return { ok: true, init, tools };
  } catch (e) {
    if (signal?.aborted) return { ok: false, reason: "已取消" };
    return { ok: false, reason: e instanceof Error ? `网络握手失败：${e.message}` : "网络握手失败" };
  }
}

/** tools/list 原始项 → McpToolMeta（风险分级启发式：写操作=高危、涉私读取=中危、其余低风险） */
function normalizeRpcTools(raw: unknown[]): McpToolMeta[] {
  return raw.slice(0, 40).map((t0) => {
    const t = t0 as { name?: string; description?: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean } };
    const desc = String(t?.description ?? "").slice(0, 120);
    const name = String(t?.name ?? "未命名工具").slice(0, 48);
    const destructive = Boolean(t?.annotations?.destructiveHint) || /(发送|写入|删除|转账|下单|创建|修改|send|write|delete|create|update|post)/i.test(name);
    const isPrivate = /私人|私信|消息|文件|邮箱|通讯录|private|message|email|inbox|file/i.test(desc + name);
    const risk: McpToolMeta["risk"] = destructive ? "high" : isPrivate ? "medium" : "low";
    return { name, description: desc, risk, private: isPrivate };
  });
}

/**
 * 标准 MCP 端点直连安装预览：initialize → tools/list。
 * 服务端 401 时自动探测 OAuth 授权服务器元数据；找不到 clientId 则留空由用户在面板补填后发起授权。
 */
export async function inspectByRpc(endpointRaw: string, signal?: AbortSignal): Promise<{ ok: boolean; preview?: InstallPreview; reason?: string }> {
  const v = validateMcpUrl(endpointRaw);
  if (!v.ok) return { ok: false, reason: v.reason ?? "地址无效" };
  const endpoint = stripUrlSecrets(endpointRaw);
  const probe = await rpcDirectProbe(endpoint, undefined, signal);
  const host = v.host as string;
  const name = (probe.init?.serverInfo?.title || probe.init?.serverInfo?.name || host.split(".")[0]).slice(0, 30);
  if (probe.ok) {
    const tools = normalizeRpcTools(probe.tools ?? []);
    const warnings: string[] = [];
    let oauth: OAuthParams | undefined;
    let auth: AuthKind = "none";
    if (probe.unauthorized || !tools.length) {
      const hint = probe.oauthHint;
      if (hint?.authorizeUrl && hint?.tokenUrl) {
        // OAuth 服务：clientId 未知，安装后在面板「去授权」处补填（Galatea 类页面会提供 web 连接器 client id）
        oauth = { authorizeUrl: hint.authorizeUrl, tokenUrl: hint.tokenUrl, clientId: "" };
        auth = "oauth";
        warnings.push("该服务使用 OAuth 登录授权：安装后点「去授权」，如平台要求 client id 请在授权表单里填写对应值");
      } else if (probe.unauthorized) {
        warnings.push("该服务需要认证但未能自动发现 OAuth 授权信息，可尝试改用 GitHub 仓库/配置清单方式导入");
      }
    }
    if (!tools.length && !probe.unauthorized) warnings.push("握手成功但该服务暂未返回工具清单，可能需授权后才可见");
    console.log(`[mcp-remote] rpc inspect ${host} tools=${tools.length} auth=${auth}`);
    return {
      ok: true,
      preview: { sourceLabel: host, kind: "url", name, endpoint, host, auth, oauth, tools, warnings },
    };
  }
  // 401 且拿到 OAuth 线索也允许安装（先装后授权）
  if (probe.unauthorized && probe.oauthHint?.authorizeUrl && probe.oauthHint?.tokenUrl) {
    console.log(`[mcp-remote] rpc inspect ${host} unauthorized→oauth install`);
    return {
      ok: true,
      preview: {
        sourceLabel: host,
        kind: "url",
        name,
        endpoint,
        host,
        auth: "oauth",
        oauth: { authorizeUrl: probe.oauthHint.authorizeUrl, tokenUrl: probe.oauthHint.tokenUrl, clientId: "" },
        tools: [],
        warnings: ["该服务需 OAuth 登录后才能列出工具：已按授权模式安装，请在服务列表点「去授权」（如需 client id 请填平台提供的值）"],
      },
    };
  }
  return { ok: false, reason: probe.reason ?? "标准 MCP 握手失败" };
}

/* ---------- 安装预览（步骤 3：域名/工具/权限/认证） ---------- */

export interface InstallPreview {
  sourceLabel: string;
  kind: "github" | "url";
  name: string;
  endpoint: string;
  host: string;
  auth: AuthKind;
  oauth?: OAuthParams;
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
  // 直接粘贴 MCP 端点（非仓库、非清单 URL）：先走标准 initialize/tools/list 握手，失败再退回 mcp.json
  if (cand.kind === "url") {
    const direct = await inspectByRpc(input, signal);
    if (direct?.ok) return direct;
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
      const authType = (mf.auth?.type ?? "").toLowerCase();
      // OAuth 声明需带齐 authorize/token/clientId 才生效，且各地址过安全校验
      const preWarnings: string[] = [];
      let oauth: OAuthParams | undefined;
      if (authType === "oauth" && mf.oauth?.authorizeUrl && mf.oauth?.tokenUrl && mf.oauth?.clientId) {
        const a = validateMcpUrl(mf.oauth.authorizeUrl);
        const t = validateMcpUrl(mf.oauth.tokenUrl);
        if (a.ok && t.ok) oauth = { authorizeUrl: mf.oauth.authorizeUrl, tokenUrl: mf.oauth.tokenUrl, clientId: mf.oauth.clientId, scope: mf.oauth.scope, revokeUrl: mf.oauth.revokeUrl };
        else preWarnings.push(`OAuth 地址未通过安全校验（${a.ok ? t.reason : a.reason}），已按无认证处理`);
      }
      const auth: AuthKind = oauth ? "oauth" : AUTH_LABELS[authType] ?? (mf.auth?.type ? "apikey" : "none");
      const tools: McpToolMeta[] = (mf.tools ?? []).slice(0, 40).map((t) => ({
        name: String(t?.name ?? "未命名工具").slice(0, 48),
        description: String(t?.description ?? "").slice(0, 120),
        risk: t?.risk === "medium" || (t?.risk === undefined && t?.isPrivate && !t?.sideEffect) ? "medium" : t?.sideEffect || t?.risk === "high" ? "high" : "low",
        private: Boolean(t?.isPrivate),
      }));
      const warnings: string[] = [...preWarnings];
      if (oauth === undefined && authType === "oauth" && !preWarnings.length) warnings.push("配置声明了 OAuth 但缺少 authorize/token/clientId，暂按无认证安装");
      if (!tools.length) warnings.push("该服务没有声明工具清单，安装后不会向 AI 开放任何能力");
      if (cand.kind === "url" && new URL(endpoint).origin !== new URL(cand.urls[0]).origin) warnings.push(`注意：配置声明的服务域名（${epCheck.host}）与仓库不同源`);
      if (auth !== "none" && auth !== "oauth") warnings.push("该服务需要认证密钥，保存后仅存在本机浏览器，不会上传；请确认你信任该服务提供方");
      if (auth === "oauth") warnings.push("该服务使用 OAuth 授权：将跳转系统浏览器授权页（PKCE + state 防伪造），token 只存本机且日志遮盖；安装后可在服务列表点「OAuth 授权」发起");
      return {
        ok: true,
        preview: { sourceLabel: cand.label, kind: cand.kind, name: (mf.name ?? cand.label).slice(0, 30), endpoint, host: epCheck.host as string, auth, oauth, tools, warnings },
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
    ...(preview.oauth && auth === "oauth" ? { oauth: preview.oauth } : {}),
  };
  saveServers([...loadServers(), s]);
  console.log(`[mcp-remote] installed ${s.name} host=${s.host} auth=${auth}`);
  return s;
}

export function removeServer(id: string) {
  saveServers(loadServers().filter((s) => s.id !== id));
  writeLogEntries(loadLog().filter((l) => l.serverId !== id));
  clearToken(id);
  console.log(`[mcp-remote] removed server=${id}`);
}

/** 清除授权：抹掉密钥/token 引用并停用全部工具授权 */
export function revokeAuth(id: string) {
  try {
    localStorage.removeItem(`vp-phone:mcp-key:${id}`);
  } catch {
    /* ignore */
  }
  clearToken(id);
  const list = loadServers().map((s) => (s.id === id ? { ...s, auth: "none" as AuthKind, mediumConsents: undefined } : s));
  saveServers(list);
  console.log(`[mcp-remote] auth revoked server=${id}`);
}

/** 中风险工具的首次授权记录（toolName → 时间） */
export function hasMediumConsent(server: RemoteMcpServer, toolName: string): boolean {
  return Boolean(server.mediumConsents?.[toolName]);
}

export function grantMediumConsent(serverId: string, toolName: string) {
  saveServers(loadServers().map((s) => (s.id === serverId ? { ...s, mediumConsents: { ...(s.mediumConsents ?? {}), [toolName]: Date.now() } } : s)));
  console.log(`[mcp-remote] medium consent granted server=${serverId} tool=${toolName}`);
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

/* ---------- OAuth（PKCE + state，公开客户端不存 client secret） ---------- */

const OAUTH_STATE_KEY = "vp-pho…e:v1";
const OAUTH_VERIFIER_KEY = "vp-phone:mcp-oauth:verifier:v1";
const OAUTH_RETURN_KEY = "vp-phone:mcp-oauth:return:v1";
/** token 安全存储：localStorage 不可用时内存兜底（本会话有效） */
const memoryTokens = new Map<string, string>();

export interface OAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  scope?: string;
}

function randomString(len = 40): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ("0" + b.toString(16)).slice(-2)).join("");
}

async function sha256Base64url(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 发起授权：生成 PKCE verifier 与随机 state，跳系统浏览器授权页。serverId 传入表示对已装服务重新授权 */
export async function startOAuth(target: { name: string; endpoint: string }, cfg: OAuthConfig, serverId?: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    if (!cfg.authorizeUrl || !cfg.tokenUrl || !cfg.clientId.trim()) return { ok: false, reason: "授权地址 / Token 地址 / Client ID 均不能为空" };
    for (const [label, url] of [["authorize", cfg.authorizeUrl], ["token", cfg.tokenUrl]] as const) {
      const v = validateMcpUrl(url);
      if (!v.ok) return { ok: false, reason: `${label} 地址不安全：${v.reason}` };
    }
    const verifier = randomString(32);
    const challenge = await sha256Base64url(verifier);
    const state = randomString(16);
    localStorage.setItem(OAUTH_VERIFIER_KEY, verifier);
    localStorage.setItem(OAUTH_STATE_KEY, JSON.stringify({ state, serverName: target.name, endpoint: target.endpoint, clientId: cfg.clientId.trim(), ...(serverId ? { serverId } : {}) }));
    localStorage.setItem(OAUTH_RETURN_KEY, location.origin + location.pathname);
    const u = new URL(cfg.authorizeUrl);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", cfg.clientId.trim());
    u.searchParams.set("redirect_uri", localStorage.getItem(OAUTH_RETURN_KEY) ?? "");
    u.searchParams.set("code_challenge", challenge);
    u.searchParams.set("code_challenge_method", "S256");
    u.searchParams.set("state", state);
    if (cfg.scope?.trim()) u.searchParams.set("scope", cfg.scope.trim());
    console.log(`[mcp-remote] oauth start host=${u.hostname} state=generated`);
    window.open(u.toString(), "_blank", "noopener");
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "无法发起授权" };
  }
}

/** 回调处理：只认本次发起的 state（伪造回调因 state 不匹配被拒），换 code 用 PKCE verifier */
export async function handleOAuthCallback(search: string): Promise<{ ok: boolean; message: string }> {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const code = params.get("code");
  const state = params.get("state");
  const err = params.get("error");
  const raw = (() => {
    try {
      return localStorage.getItem(OAUTH_STATE_KEY);
    } catch {
      return null;
    }
  })();
  // 先取出 verifier，再一次性消费 state（clearOAuthFlow 会同时抹掉 verifier）
  const verifier = (() => {
    try {
      return localStorage.getItem(OAUTH_VERIFIER_KEY) || "";
    } catch {
      return "";
    }
  })();
  clearOAuthFlow();
  if (err) return { ok: false, message: `授权未完成：${err === "access_denied" ? "你在授权页点了取消" : err}` };
  if (!code || !state) return { ok: false, message: "回调缺少 code/state，已忽略" };
  if (!raw) return { ok: false, message: "已拒绝：收到伪造回调（本机没有等待中的授权流程）" };
  let ctx: { state: string; serverName: string; endpoint: string; serverId?: string; clientId?: string };
  try {
    ctx = JSON.parse(raw) as typeof ctx;
  } catch {
    return { ok: false, message: "已拒绝：授权上下文损坏" };
  }
  if (ctx.state !== state) return { ok: false, message: "已拒绝：state 与本次授权不符（疑似伪造回调或 CSRF）" };
  if (!verifier) return { ok: false, message: "已拒绝：PKCE verifier 丢失，请重新发起授权" };
  const servers = loadServers();
  const server = servers.find((s) => (ctx.serverId ? s.id === ctx.serverId : s.name === ctx.serverName));
  if (!server) return { ok: false, message: `授权成功但服务「${ctx.serverName}」已被移除，token 丢弃` };
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: localStorage.getItem(OAUTH_RETURN_KEY) || location.origin + location.pathname,
      client_id: server.oauth?.clientId ?? ctx.clientId ?? "",
      code_verifier: verifier,
    });
    const res = await fetch(server.oauth?.tokenUrl ?? server.url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(), signal: AbortSignal.timeout(15_000) });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !j.access_token) return { ok: false, message: `换取 token 失败：${j.error ?? `HTTP ${res.status}`}` };
    setToken(server.id, j.access_token, j.refresh_token, j.expires_in);
    saveServers(loadServers().map((s) => (s.id === server.id ? { ...s, auth: "oauth" as AuthKind } : s)));
    appendCallLog(server, "OAuth 授权", true, "access_token 已写入安全存储（日志不落原文）");
    console.log(`[mcp-remote] oauth callback ok server=${server.name}`);
    return { ok: true, message: `「${server.name}」授权成功，token 已保存` };
  } catch (e) {
    return { ok: false, message: `换取 token 失败：${e instanceof Error ? e.message : "网络错误"}` };
  }
}

/** 对已安装服务发起 OAuth 授权（需服务带有 oauth 参数或面板手动填过） */
export async function startOAuthForServer(server: RemoteMcpServer, cfg?: Partial<OAuthConfig>): Promise<{ ok: boolean; reason?: string }> {
  const merged: OAuthConfig = {
    authorizeUrl: cfg?.authorizeUrl ?? server.oauth?.authorizeUrl ?? "",
    tokenUrl: cfg?.tokenUrl ?? server.oauth?.tokenUrl ?? "",
    clientId: cfg?.clientId ?? server.oauth?.clientId ?? "",
    scope: cfg?.scope ?? server.oauth?.scope,
  };
  const r = await startOAuth({ name: server.name, endpoint: server.url }, merged, server.id);
  if (r.ok && cfg && (cfg.authorizeUrl || cfg.tokenUrl || cfg.clientId)) {
    // 手动补全的参数写回服务，下次直接复用
    saveServers(loadServers().map((s) => (s.id === server.id ? { ...s, oauth: { authorizeUrl: merged.authorizeUrl, tokenUrl: merged.tokenUrl, clientId: merged.clientId, scope: merged.scope, revokeUrl: s.oauth?.revokeUrl } } : s)));
  }
  return r;
}

function clearOAuthFlow() {
  try {
    localStorage.removeItem(OAUTH_STATE_KEY);
    localStorage.removeItem(OAUTH_VERIFIER_KEY);
    localStorage.removeItem(OAUTH_RETURN_KEY);
  } catch {
    /* ignore */
  }
}

interface StoredToken {
  access: string;
  refresh?: string;
  /** 过期时刻 epoch ms；无 expires_in 按 1 小时保守处理 */
  expAt: number;
}

function setToken(serverId: string, access: string, refresh?: string, expiresIn?: number) {
  const t: StoredToken = { access, ...(refresh ? { refresh } : {}), expAt: Date.now() + Math.max(60, expiresIn ?? 3600) * 1000 };
  try {
    localStorage.setItem(`vp-phone:mcp-token:${serverId}`, JSON.stringify(t));
  } catch {
    memoryTokens.set(serverId, JSON.stringify(t));
  }
}

function readToken(serverId: string): StoredToken | null {
  try {
    const raw = localStorage.getItem(`vp-phone:mcp-token:${serverId}`) || memoryTokens.get(serverId);
    return raw ? (JSON.parse(raw) as StoredToken) : null;
  } catch {
    return null;
  }
}

/** 过期自动刷新；刷新失败即要求重新授权 */
async function ensureFreshToken(server: RemoteMcpServer): Promise<StoredToken | null> {
  const t = readToken(server.id);
  if (!t) return null;
  if (Date.now() < t.expAt - 30_000) return t;
  if (!t.refresh || !server.oauth?.tokenUrl) {
    clearToken(server.id);
    return null;
  }
  try {
    const res = await fetch(server.oauth.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: t.refresh, client_id: server.oauth.clientId }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!res.ok || !j.access_token) {
      clearToken(server.id);
      return null;
    }
    setToken(server.id, j.access_token, j.refresh_token ?? t.refresh, j.expires_in);
    console.log(`[mcp-remote] token refreshed server=${server.name}`);
    return readToken(server.id);
  } catch {
    clearToken(server.id);
    return null;
  }
}

function clearToken(serverId: string) {
  try {
    localStorage.removeItem(`vp-phone:mcp-token:${serverId}`);
  } catch {
    /* ignore */
  }
  memoryTokens.delete(serverId);
}

export function hasValidToken(serverId: string): boolean {
  const t = readToken(serverId);
  return Boolean(t && Date.now() < t.expAt);
}

/** 撤销授权：先向服务端 revoke（尽力而为），再清本地 token */
export async function revokeOAuth(server: RemoteMcpServer): Promise<void> {
  const t = readToken(server.id);
  if (t && server.oauth?.revokeUrl) {
    try {
      await fetch(server.oauth.revokeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: t.access, token_type_hint: "access_token", client_id: server.oauth.clientId }).toString(),
        signal: AbortSignal.timeout(8000),
      }).catch(() => undefined);
    } catch {
      /* 服务端撤销失败也要清本地 */
    }
  }
  clearToken(server.id);
  saveServers(loadServers().map((s) => (s.id === server.id ? { ...s, auth: "none" as AuthKind } : s)));
  console.log(`[mcp-remote] oauth revoked server=${server.name}`);
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

export function appendCallLog(server: RemoteMcpServer, tool: string, ok: boolean, note: string) {
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
  if ((tool.risk === "high" || tool.risk === "medium") && !confirmed) {
    appendCallLog(server, tool.name, false, `${tool.risk === "high" ? "高危" : "中危"}调用未经用户确认，已拒绝`);
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
  if (server.auth === "oauth") {
    const t = await ensureFreshToken(server);
    if (!t) {
      appendCallLog(server, tool.name, false, "OAuth token 缺失或已过期，需重新授权");
      return { ok: false, text: `「${server.name}」的授权已过期或被撤销，请在远程 MCP 面板重新授权`, content: "" };
    }
    headers.Authorization = `Bearer ${t.access}`;
  }
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
      appendCallLog(server, tool.name, false, `HTTP ${res.status}`);
      return { ok: false, text: `调用失败（HTTP ${res.status}）`, content: "" };
    }
    let summary = "已完成";
    let content = "";
    try {
      const j = JSON.parse(text) as { result?: { content?: { text?: string }[] }; error?: { message?: string } };
      if (j.error?.message) {
        appendCallLog(server, tool.name, false, j.error.message);
        return { ok: false, text: `服务返回错误：${maskSecrets(j.error.message).slice(0, 60)}`, content: "" };
      }
      content = (j.result?.content ?? []).map((c) => c.text ?? "").join("\n").slice(0, 2000);
      summary = content ? `返回 ${content.length} 字` : "无正文返回";
    } catch {
      content = text.slice(0, 800);
      summary = "非 JSON 响应";
    }
    appendCallLog(server, tool.name, true, `${summary}${tool.private ? " · 结果含私人内容，仅本次会话可见" : ""}`);
    return { ok: true, text: `已调用 ${server.name}·${tool.name}（${summary}）`, content: maskSecrets(content) };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "请求超时（15 秒）" : e.message) : "网络错误";
    appendCallLog(server, tool.name, false, msg);
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
    lines.push(`- ${s.name}（${s.host}）：${tools.length ? tools.map((t) => `${t.name}${t.risk === "high" ? "〔高危〕" : t.risk === "medium" ? "〔中危〕" : ""}${t.private ? "〔涉私〕" : ""}`).join("、") : "未声明工具"}${s.auth === "oauth" && !hasValidToken(s.id) ? "〔OAuth 未授权〕" : ""}`);
  }
  lines.push(
    "使用方式：单独一行输出 [远程MCP:服务名:工具名:参数JSON]（参数为 JSON 对象，可省略则写 {}）。",
    "规则：只在对方明确要求或明显需要时调用；标注〔中危〕的工具首次使用时系统会请你确认授权范围、之后自动执行；〔高危〕的工具每次都会先请你确认并展示参数；〔涉私〕工具的返回只做摘要转述，不得整段复述原文；低风险工具调用后要在回复里说明信息来源；绝不调用未在清单中的工具。",
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
