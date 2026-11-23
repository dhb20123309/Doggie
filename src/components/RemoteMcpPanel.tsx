// 远程 MCP 安全导入面板：粘贴地址/仓库 → 只读约定配置清单 → 安装前展示域名/工具/权限/认证 →
// 用户确认后才保存；支持 OAuth（PKCE + state，公开客户端无 secret）授权/撤销；
// 已装服务可移除/清除授权；调用日志遮盖 token 与私人内容。
import { useState } from "react";
import { AlertTriangle, Globe2, Plug, ShieldCheck, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addServer,
  clearLog,
  hasMediumConsent,
  hasServerKey,
  hasValidToken,
  inspectSource,
  loadLog,
  loadServers,
  loadToolCache,
  removeServer,
  revokeAuth,
  revokeOAuth,
  saveServers,
  saveToolCache,
  setServerKey,
  startOAuthForServer,
  stripUrlSecrets,
  validateMcpUrl,
  type AuthKind,
  type InstallPreview,
  type McpCallLog,
  type RemoteMcpServer,
} from "@/lib/remote-mcp";

interface Props {
  onClose: () => void;
  onChanged: () => void;
}

const RISK_BADGE: Record<string, string> = {
  high: "bg-rose-500/12 text-rose-600",
  medium: "bg-amber-500/15 text-amber-700",
  low: "bg-emerald-500/12 text-emerald-600",
};

const RISK_LABEL: Record<string, string> = {
  high: "高危·每次确认",
  medium: "涉私·首次授权",
  low: "低风险·自动",
};

export function RemoteMcpPanel({ onClose, onChanged }: Props) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [preview, setPreview] = useState<InstallPreview | null>(null);
  const [authChoice, setAuthChoice] = useState<AuthKind>("none");
  const [keyInput, setKeyInput] = useState("");
  const [oauthForm, setOauthForm] = useState({ authorizeUrl: "", tokenUrl: "", clientId: "", scope: "" });
  const [servers, setServers] = useState<RemoteMcpServer[]>(loadServers);
  const [logs, setLogs] = useState<McpCallLog[]>(loadLog);
  const [confirmRemove, setConfirmRemove] = useState<string>("");
  const [oauthFor, setOauthFor] = useState<string>("");

  const refresh = () => {
    setServers(loadServers());
    setLogs(loadLog());
    onChanged();
  };

  const doInspect = async () => {
    setErr("");
    setNotice("");
    setPreview(null);
    const raw = input.trim();
    if (!raw) return;
    // 本地先拦一次明显违规（file://、http、localhost、内网），省得白跑网络
    const repoLike = /github\.com/i.test(raw) || /^[\w.-]+\/[\w.-]+$/.test(raw);
    if (!repoLike) {
      const v = validateMcpUrl(raw);
      if (!v.ok) {
        setErr(v.reason ?? "地址无效");
        return;
      }
    }
    setBusy(true);
    const r = await inspectSource(raw);
    setBusy(false);
    if (!r.ok || !r.preview) {
      setErr(r.reason ?? "无法读取配置清单");
      return;
    }
    setPreview(r.preview);
    setAuthChoice(r.preview.auth);
    const o = r.preview.oauth;
    setOauthForm({ authorizeUrl: o?.authorizeUrl ?? "", tokenUrl: o?.tokenUrl ?? "", clientId: o?.clientId ?? "", scope: o?.scope ?? "" });
  };

  const doInstall = () => {
    if (!preview) return;
    // OAuth 服务允许安装时未授权：参数齐全即可，稍后在服务列表点「去授权」
    const s = addServer(preview, authChoice);
    if (authChoice !== "none" && authChoice !== "oauth" && keyInput.trim()) setServerKey(s.id, keyInput.trim());
    if (authChoice === "oauth") {
      // 把面板填写的 OAuth 参数写进服务记录
      const list = loadServers().map((x) => (x.id === s.id ? { ...x, oauth: { authorizeUrl: oauthForm.authorizeUrl.trim(), tokenUrl: oauthForm.tokenUrl.trim(), clientId: oauthForm.clientId.trim(), scope: oauthForm.scope.trim() || undefined } } : x));
      saveServers(list);
    }
    // 工具清单缓存：安装时抓一次，供聊天 system 拼接与调用白名单校验
    const cache = loadToolCache();
    cache[s.id] = preview.tools;
    saveToolCache(cache);
    console.log(`[mcp-remote] installed ${s.name} host=${s.host} tools=${preview.tools.length} auth=${authChoice}`);
    setPreview(null);
    setInput("");
    setKeyInput("");
    refresh();
  };

  const doStartOAuth = async (s: RemoteMcpServer) => {
    setErr("");
    if (oauthFor === s.id) {
      // 展开状态下再次点击 = 带手动参数发起
      const r = await startOAuthForServer(s, oauthForm.authorizeUrl ? oauthForm : undefined);
      if (!r.ok) setErr(r.reason ?? "无法发起授权");
      else setNotice("已打开系统浏览器授权页，完成授权后回到本页自动接收结果");
      setOauthFor("");
      refresh();
      return;
    }
    if (s.oauth?.authorizeUrl && s.oauth?.tokenUrl && s.oauth?.clientId) {
      const r = await startOAuthForServer(s);
      if (!r.ok) setErr(r.reason ?? "无法发起授权");
      else setNotice("已打开系统浏览器授权页（PKCE + state），完成授权后回到本页自动接收结果");
      refresh();
    } else {
      // 缺 clientId（标准 MCP 端点自动发现时常见）：展开表单让用户填平台提供的 client id
      setOauthFor(s.id);
      setOauthForm({ authorizeUrl: s.oauth?.authorizeUrl ?? "", tokenUrl: s.oauth?.tokenUrl ?? "", clientId: s.oauth?.clientId ?? "", scope: s.oauth?.scope ?? "" });
    }
  };

  const authBadge = (s: RemoteMcpServer) => {
    if (s.auth === "none") return { cls: "bg-neutral-500/10 text-neutral-500", label: "无认证" };
    if (s.auth === "oauth") return hasValidToken(s.id) ? { cls: "bg-emerald-500/12 text-emerald-600", label: "OAuth 已授权" } : { cls: "bg-amber-500/15 text-amber-700", label: "OAuth 未授权" };
    return hasServerKey(s.id) ? { cls: "bg-emerald-500/12 text-emerald-600", label: "已填密钥" } : { cls: "bg-amber-500/15 text-amber-700", label: "未填密钥" };
  };

  const toolCount = (id: string) => (loadToolCache()[id] ?? []).length;
  const mediumCount = (s: RemoteMcpServer) => Object.keys(s.mediumConsents ?? {}).length;

  return (
    <div className="absolute inset-0 z-[72] flex flex-col bg-black/40" onClick={onClose}>
      <div className="drawer-panel glass-strong mt-auto flex max-h-[88%] flex-col rounded-t-3xl p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <Globe2 className="size-4 shrink-0 text-primary" />
          <h2 className="min-w-0 flex-1 truncate text-[14px] font-bold text-neutral-800">远程 MCP 导入</h2>
          <button type="button" aria-label="关闭" onClick={onClose} className="jelly-icon shrink-0 text-muted-foreground">
            <X className="size-4" />
          </button>
        </div>
        <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
          支持直接粘贴 https MCP 服务地址（自动完成标准握手并读取工具清单），或 GitHub 仓库链接（只读约定的 mcp.json，绝不下载执行仓库代码）。
        </p>

        {/* 输入 + 检查 */}
        <div className="mt-3 flex gap-2">
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="https://mcp.example.com/mcp 或 owner/repo" className="glass-input h-9 min-w-0 flex-1 text-[12px]" />
          <Button size="sm" className="jelly-btn h-9 shrink-0 bg-primary px-3 text-[12px] text-primary-foreground" disabled={busy || !input.trim()} onClick={() => void doInspect()}>
            {busy ? "读取中…" : "安全检查"}
          </Button>
        </div>
        {err && <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-rose-50 px-2.5 py-2 text-[11px] leading-relaxed text-rose-600"><AlertTriangle className="mt-0.5 size-3 shrink-0" />{err}</p>}
        {notice && <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-emerald-50 px-2.5 py-2 text-[11px] leading-relaxed text-emerald-700"><ShieldCheck className="mt-0.5 size-3 shrink-0" />{notice}</p>}

        {/* 安装前预览：域名/工具/权限/认证 */}
        {preview && (
          <section className="mt-3 space-y-2 rounded-2xl border border-border/60 bg-white/70 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-[13px] font-bold text-neutral-800">{preview.name}</h3>
              <span className="text-[10px] text-muted-foreground">来源：{preview.sourceLabel}</span>
            </div>
            <p className="break-all text-[10.5px] text-muted-foreground">服务域名：{preview.host}</p>
            <div className="flex flex-wrap gap-1.5 text-[9.5px] font-semibold">
              <span className="rounded-full bg-sky-500/12 px-2 py-0.5 text-sky-600">传输：Streamable HTTP</span>
              <span className={`rounded-full px-2 py-0.5 ${preview.auth === "none" ? "bg-emerald-500/12 text-emerald-600" : "bg-amber-500/15 text-amber-700"}`}>
                认证：{preview.auth === "none" ? "无需密钥" : preview.auth === "bearer" ? "Bearer Token" : preview.auth === "apikey" ? "API Key" : "OAuth 授权"}
              </span>
              <span className="rounded-full bg-violet-500/12 px-2 py-0.5 text-violet-600">权限：仅调用下列工具</span>
            </div>
            {preview.tools.length > 0 ? (
              <ul className="max-h-36 space-y-1 overflow-y-auto">
                {preview.tools.map((t) => (
                  <li key={t.name} className="flex items-start gap-1.5 text-[11px] leading-snug">
                    <Plug className="mt-0.5 size-3 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-neutral-800">{t.name}</span>
                      {t.description && <span className="ml-1 text-muted-foreground">{t.description}</span>}
                    </span>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8.5px] font-semibold ${RISK_BADGE[t.risk]}`}>{RISK_LABEL[t.risk]}</span>
                    {t.private && <span className="shrink-0 rounded-full bg-orange-500/12 px-1.5 py-0.5 text-[8.5px] font-semibold text-orange-600">涉私</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-muted-foreground">该服务未声明工具清单。</p>
            )}
            {preview.warnings.map((w) => (
              <p key={w} className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-[10.5px] leading-relaxed text-amber-700">
                <ShieldCheck className="mt-0.5 size-3 shrink-0" />
                {w}
              </p>
            ))}
            {authChoice === "oauth" && (
              <div className="space-y-1.5 rounded-xl bg-sky-50/70 p-2.5">
                <p className="text-[10px] leading-relaxed text-sky-700">OAuth 走 PKCE + 随机 state，本应用是公开客户端，不需要也不允许填写 client secret。</p>
                <Input value={oauthForm.authorizeUrl} onChange={(e) => setOauthForm({ ...oauthForm, authorizeUrl: e.target.value })} placeholder="授权页地址 authorizeUrl（https）" className="glass-input h-8 text-[11px]" />
                <Input value={oauthForm.tokenUrl} onChange={(e) => setOauthForm({ ...oauthForm, tokenUrl: e.target.value })} placeholder="Token 地址 tokenUrl（https）" className="glass-input h-8 text-[11px]" />
                <div className="flex gap-1.5">
                  <Input value={oauthForm.clientId} onChange={(e) => setOauthForm({ ...oauthForm, clientId: e.target.value })} placeholder="Client ID" className="glass-input h-8 min-w-0 flex-1 text-[11px]" />
                  <Input value={oauthForm.scope} onChange={(e) => setOauthForm({ ...oauthForm, scope: e.target.value })} placeholder="scope 可选" className="glass-input h-8 min-w-0 flex-1 text-[11px]" />
                </div>
              </div>
            )}
            {(authChoice === "bearer" || authChoice === "apikey") && (
              <Input value={keyInput} onChange={(e) => setKeyInput(e.target.value)} type="password" placeholder="认证密钥（仅保存在本机浏览器）" className="glass-input h-8 text-[12px]" autoComplete="off" />
            )}
            <div className="flex gap-2 pt-0.5">
              <Button
                size="sm"
                className="jelly-btn h-8 flex-1 bg-primary text-[12px] text-primary-foreground"
                disabled={authChoice === "oauth" && !(oauthForm.authorizeUrl.trim() && oauthForm.tokenUrl.trim() && oauthForm.clientId.trim())}
                onClick={doInstall}
              >
                确认安装
              </Button>
              <Button size="sm" variant="outline" className="jelly-btn h-8 flex-1 text-[12px]" onClick={() => setPreview(null)}>
                取消
              </Button>
            </div>
          </section>
        )}

        {/* 已安装服务 */}
        {servers.length > 0 && (
          <section className="mt-3 space-y-1.5">
            <h3 className="text-[11px] font-bold text-neutral-700">已连接的服务（{servers.length}）</h3>
            {servers.map((s) => {
              const b = authBadge(s);
              return (
                <div key={s.id} className="rounded-xl bg-white/60 px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-neutral-800">{s.name}</span>
                    <span className="shrink-0 text-[9.5px] text-muted-foreground">{s.host}</span>
                    <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8.5px] font-semibold ${b.cls}`}>{b.label}</span>
                  </div>
                  <p className="mt-0.5 break-all text-[9.5px] text-muted-foreground">{stripUrlSecrets(s.url)}</p>
                  <p className="mt-0.5 text-[9px] text-muted-foreground">
                    授权工具 {toolCount(s.id)} 个{s.auth === "oauth" ? "" : ` · ${s.auth === "none" ? "无需认证" : "密钥仅存本机"}`}
                    {mediumCount(s) > 0 ? ` · 已授权涉私工具 ${mediumCount(s)} 个` : ""}
                  </p>
                  {oauthFor === s.id && (
                    <div className="mt-1.5 space-y-1.5 rounded-lg bg-sky-50/70 p-2">
                      <Input value={oauthForm.authorizeUrl} onChange={(e) => setOauthForm({ ...oauthForm, authorizeUrl: e.target.value })} placeholder="授权页地址 authorizeUrl（https）" className="glass-input h-7 text-[11px]" />
                      <Input value={oauthForm.tokenUrl} onChange={(e) => setOauthForm({ ...oauthForm, tokenUrl: e.target.value })} placeholder="Token 地址 tokenUrl（https）" className="glass-input h-7 text-[11px]" />
                      <Input value={oauthForm.clientId} onChange={(e) => setOauthForm({ ...oauthForm, clientId: e.target.value })} placeholder="Client ID" className="glass-input h-7 text-[11px]" />
                    </div>
                  )}
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px]">
                    {s.auth === "oauth" && (
                      <button type="button" className="font-semibold text-primary hover:underline" onClick={() => void doStartOAuth(s)}>
                        {oauthFor === s.id ? "填写后再次点击发起" : hasValidToken(s.id) ? "重新授权" : "去授权"}
                      </button>
                    )}
                    {s.auth !== "none" && (
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-rose-500"
                        onClick={() => {
                          if (s.auth === "oauth") void revokeOAuth(s).then(refresh);
                          else {
                            revokeAuth(s.id);
                            refresh();
                          }
                        }}
                      >
                        撤销授权
                      </button>
                    )}
                    {confirmRemove === s.id ? (
                      <>
                        <button type="button" className="font-semibold text-rose-600" onClick={() => { removeServer(s.id); setConfirmRemove(""); refresh(); }}>确认移除并停用</button>
                        <button type="button" className="text-muted-foreground" onClick={() => setConfirmRemove("")}>取消</button>
                      </>
                    ) : (
                      <button type="button" className="flex items-center gap-0.5 text-rose-500 hover:underline" onClick={() => setConfirmRemove(s.id)}>
                        <Trash2 className="size-3" /> 移除服务
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        )}

        {/* 调用日志 */}
        {logs.length > 0 && (
          <section className="mt-3 space-y-1">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-bold text-neutral-700">调用记录（最近 {logs.length} 条）</h3>
              <button type="button" className="text-[10px] text-muted-foreground hover:text-rose-500" onClick={() => { clearLog(); setLogs([]); }}>清空</button>
            </div>
            <ul className="max-h-32 space-y-1 overflow-y-auto">
              {[...logs].reverse().map((l) => (
                <li key={l.id} className="flex items-baseline gap-1.5 text-[10px] leading-snug">
                  <span className={`shrink-0 font-semibold ${l.ok ? "text-emerald-600" : "text-rose-500"}`}>{l.ok ? "✓" : "✗"}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{new Date(l.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="min-w-0 flex-1 truncate text-neutral-700">{l.serverName} · {l.tool} — {l.note}</span>
                </li>
              ))}
            </ul>
            <p className="text-[9px] leading-relaxed text-muted-foreground">日志自动遮盖密钥与 token；涉及私人内容的调用只记录摘要，不保存返回原文。</p>
          </section>
        )}
      </div>
    </div>
  );
}
