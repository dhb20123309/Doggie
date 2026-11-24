// 云账号登录/注册全屏页（手机屏内）：basic_auth 用户名+密码。
// 提交走 useAuthSubmit 互斥与错误反馈；Session 到达后由本组件回调关闭（无路由跳转，App 是单页手机壳）。
import { useState, type FormEvent } from "react";
import { KeyRound, LoaderCircle, ChevronLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth, useAuthSubmit } from "@/features/supabase-auth-runtime";
import { authActions } from "@/lib/auth";
import { cloudAvailable } from "@/lib/cloud-client";

interface Props {
  /** 登录/注册成功（Session 已建立）后回调 */
  onDone: () => void;
  onClose: () => void;
}

export function AuthSheet({ onDone, onClose }: Props) {
  const { status } = useAuth();
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const { busy, feedback, execute } = useAuthSubmit();

  // Session 到达即完成（注册成功后 Supabase 自动签发会话时同样命中）
  if (status === "authenticated") {
    onDone();
    return null;
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!username.trim()) return;
    if (password.length < 6) return;
    if (tab === "register" && password !== confirm) return;
    const values = { username: username.trim(), password };
    const data =
      tab === "login"
        ? await execute("signIn", () => authActions.signIn(values))
        : await execute("signUp", () => authActions.signUp(values));
    if (!data) return; // 失败：feedback 已给出原因，留在表单可重试
    // signUp 可能无 Session（需邮箱确认）——此时提示用户去确认后再登录
    const hasSession = Boolean((data as { data?: { session?: unknown } }).data?.session ?? (data as { session?: unknown }).session);
    if (tab === "register" && !hasSession) {
      // 不假装注册完成：切回登录并说明
      setTab("login");
    }
  };

  const localError =
    tab === "register" && confirm && password !== confirm ? "两次输入的密码不一致" : "";
  const shown = feedback?.message ?? localError;

  return (
    <div className="fade-up absolute inset-0 z-[80] flex flex-col bg-background">
      <div className="glass-nav flex items-center gap-1 px-2 py-2">
        <Button variant="ghost" size="icon" className="jelly-icon size-8" onClick={onClose} aria-label="返回">
          <ChevronLeft className="size-5" />
        </Button>
        <span className="text-sm font-semibold">云存档账号</span>
        <span className="w-8" />
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-8 pt-6">
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 ring-1 ring-primary/20">
          <KeyRound className="size-7 text-primary" />
        </div>
        <h2 className="text-center text-base font-bold">把你的恋爱记忆存进云端</h2>
        <p className="mx-auto mt-1.5 max-w-[260px] text-center text-[11px] leading-relaxed text-muted-foreground">
          注册一个专属账号，角色、聊天记录、群聊、世界书、相册全部可备份，换设备也能找回。
        </p>

        {/* 登录 / 注册切换 */}
        <div className="mt-6 grid grid-cols-2 rounded-full glass p-1">
          {(["login", "register"] as const).map((t) => (
            <button
              key={t}
              type="button"
              disabled={busy}
              onClick={() => setTab(t)}
              className={`jelly-btn rounded-full py-1.5 text-xs font-medium transition-colors ${
                tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              {t === "login" ? "登录" : "注册"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-5 space-y-3.5" aria-busy={busy}>
          <div className="space-y-1.5">
            <Label htmlFor="auth-user" className="text-xs text-muted-foreground">
              用户名或邮箱
            </Label>
            <Input
              id="auth-user"
              autoComplete="username"
              placeholder="给自己起个账号名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="h-10 rounded-xl glass-input text-[13px]"
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="auth-pass" className="text-xs text-muted-foreground">
              密码（至少 6 位）
            </Label>
            <Input
              id="auth-pass"
              type="password"
              autoComplete={tab === "login" ? "current-password" : "new-password"}
              placeholder="••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10 rounded-xl glass-input text-[13px]"
              disabled={busy}
            />
          </div>
          {tab === "register" && (
            <div className="space-y-1.5">
              <Label htmlFor="auth-confirm" className="text-xs text-muted-foreground">
                再输一遍密码
              </Label>
              <Input
                id="auth-confirm"
                type="password"
                autoComplete="new-password"
                placeholder="••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="h-10 rounded-xl glass-input text-[13px]"
                disabled={busy}
              />
            </div>
          )}

          {shown && <p role="alert" className="text-[11px] leading-relaxed text-destructive">{shown}</p>}

          <Button
            type="submit"
            className="jelly-blob w-full rounded-2xl py-5 text-sm font-semibold"
            disabled={busy || !username.trim() || password.length < 6 || (tab === "register" && password !== confirm)}
          >
            {busy ? (
              <>
                <LoaderCircle className="mr-1.5 size-4 animate-spin" />
                {tab === "login" ? "登录中…" : "注册中…"}
              </>
            ) : tab === "login" ? (
              "登 录"
            ) : (
              "注册并登录"
            )}
          </Button>
        </form>

        <div className="mt-5 flex items-start gap-2 rounded-2xl glass p-3 text-[10.5px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <span>
            账号数据仅用于你自己的云备份：每个账号只有一份专属存档，除你之外任何人都读不到（数据库行级权限保护）。
          </span>
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="mt-4 w-full justify-center text-[11px] text-muted-foreground"
          onClick={onClose}
          disabled={busy}
        >
          暂不登录，继续使用本机数据
        </Button>
      </div>
    </div>
  );
}
