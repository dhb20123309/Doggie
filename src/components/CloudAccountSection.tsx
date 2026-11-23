// 设置页「云端账号」区：登录状态、立即备份（进度）、从云端恢复（二次确认+留底）、自动备份开关、退出登录。
// 未登录时只是一个入口按钮，具体表单在 AuthSheet（PhoneShell 层弹出）。
import { useEffect, useState } from "react";
import { Cloud, CloudUpload, CloudDownload, LogOut, LoaderCircle, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/features/supabase-auth-runtime";
import { authActions } from "@/lib/auth";
import {
  backupNow,
  fetchSnapshotMeta,
  restoreNow,
  reloadApp,
  readLastBackupAt,
  isAutoBackupOn,
  setAutoBackup,
  isDirty,
  type BackupProgress,
  type SnapshotMeta,
} from "@/lib/cloud-store";

interface Props {
  onOpenAuth: () => void;
}

type Feedback = { ok: boolean; text: string } | null;

export function CloudAccountSection({ onOpenAuth }: Props) {
  const { status, username, user } = useAuth();
  const [auto, setAuto] = useState(isAutoBackupOn());
  const [busy, setBusy] = useState<"backup" | "restore" | null>(null);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const [fb, setFb] = useState<Feedback>(null);
  const [meta, setMeta] = useState<SnapshotMeta | null>(null);
  const [lastLocal, setLastLocal] = useState(readLastBackupAt());
  const [confirmRestore, setConfirmRestore] = useState(false);

  const signedIn = status === "authenticated";

  // 已登录时拉一次云端元信息（显示上次备份时间）
  useEffect(() => {
    if (!signedIn) {
      setMeta(null);
      return;
    }
    let alive = true;
    void fetchSnapshotMeta().then((m) => {
      if (alive) setMeta(m);
    });
    return () => {
      alive = false;
    };
  }, [signedIn, lastLocal]);

  const doBackup = async () => {
    setBusy("backup");
    setFb(null);
    const r = await backupNow(setProgress);
    setBusy(null);
    setProgress(null);
    if (r.ok) {
      setLastLocal(readLastBackupAt());
      setFb({ ok: true, text: `备份完成：${r.images} 张图片、${fmtBytes(r.bytes)} 已上云` });
    } else {
      setFb({ ok: false, text: `备份失败：${r.error ?? "未知错误"}` });
    }
  };

  const doRestore = async () => {
    setConfirmRestore(false);
    setBusy("restore");
    setFb(null);
    const r = await restoreNow();
    setBusy(null);
    if (r.ok) {
      setFb({ ok: true, text: `已恢复 ${r.entries} 项数据，正在重新加载…` });
      setTimeout(reloadApp, 900);
    } else {
      setFb({ ok: false, text: `恢复失败：${r.error ?? "未知错误"}` });
    }
  };

  const doSignOut = async () => {
    // 退出前若有未备份改动，先静默补一份备份（失败不阻断退出）
    if (isDirty()) {
      try {
        await backupNow();
      } catch {
        /* ignore */
      }
    }
    await authActions.signOut();
    setFb({ ok: true, text: "已退出登录，本机数据保留不受影响" });
  };

  return (
    <div className="glass space-y-2.5 rounded-2xl p-3.5">
      <div className="flex items-center gap-1.5 text-[13px] font-semibold">
        <Cloud className="size-4 text-primary" />
        云端账号
        {signedIn && (
          <span className="ml-auto max-w-[130px] truncate text-[10px] font-normal text-muted-foreground">
            @{username ?? user?.email?.split("@")[0] ?? "已登录"}
          </span>
        )}
      </div>

      {!signedIn ? (
        <>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            注册专属账号后，角色、聊天、群聊、世界书、相册等全部数据可备份到云端，换设备登录即可找回。
          </p>
          <Button size="sm" className="jelly-btn h-8 w-full rounded-xl text-xs" onClick={onOpenAuth}>
            登录 / 注册
          </Button>
        </>
      ) : (
        <>
          <p className="text-[10.5px] leading-relaxed text-muted-foreground">
            {meta
              ? `云端存档：${new Date(meta.updatedAt).toLocaleString("zh-CN")} · ${meta.entries} 项 · ${fmtBytes(meta.sizeBytes)}`
              : lastLocal
                ? `上次本机备份：${new Date(lastLocal).toLocaleString("zh-CN")}（云端还没确认到存档，试试立即备份）`
                : "还没有云存档，点下方按钮备份第一份"}
          </p>

          <Button
            size="sm"
            variant="outline"
            className="jelly-btn h-9 w-full gap-1.5 rounded-xl border-primary/40 text-xs font-semibold text-primary hover:bg-primary/5"
            onClick={() => void doBackup()}
            disabled={busy !== null}
          >
            {busy === "backup" ? (
              <>
                <LoaderCircle className="size-3.5 animate-spin" />
                {progress?.stage === "upload" ? `上传图片 ${progress.done}/${progress.total}…` : progress?.stage === "save" ? "写入云端…" : "扫描数据…"}
              </>
            ) : (
              <>
                <CloudUpload className="size-3.5" />
                立即备份
              </>
            )}
          </Button>

          {!confirmRestore ? (
            <Button
              size="sm"
              variant="ghost"
              className="jelly-btn h-8 w-full gap-1.5 rounded-xl text-xs text-muted-foreground"
              onClick={() => setConfirmRestore(true)}
              disabled={busy !== null || !meta}
            >
              {busy === "restore" ? <LoaderCircle className="size-3.5 animate-spin" /> : <CloudDownload className="size-3.5" />}
              从云端恢复
            </Button>
          ) : (
            <div className="space-y-2 rounded-xl bg-destructive/5 p-2.5 ring-1 ring-destructive/20">
              <p className="text-[10.5px] leading-relaxed text-destructive">
                恢复将用 {meta ? new Date(meta.updatedAt).toLocaleString("zh-CN") : "云端"} 的存档覆盖本机现有数据（旧数据会先在本机留底，可联系找回）。确定吗？
              </p>
              <div className="flex gap-2">
                <Button size="sm" className="jelly-btn h-7 flex-1 rounded-lg bg-destructive text-[11px] text-white hover:bg-destructive/90" onClick={() => void doRestore()}>
                  覆盖并恢复
                </Button>
                <Button size="sm" variant="outline" className="jelly-btn h-7 flex-1 rounded-lg text-[11px]" onClick={() => setConfirmRestore(false)}>
                  取消
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-0.5">
            <span className="text-[11px] text-muted-foreground">自动备份（切后台/退出前）</span>
            <Switch
              checked={auto}
              onCheckedChange={(v) => {
                setAuto(v);
                setAutoBackup(v);
              }}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="jelly-btn h-7 flex-1 gap-1 rounded-lg text-[10.5px] text-muted-foreground"
              onClick={() => void fetchSnapshotMeta().then((m) => setMeta(m))}
            >
              <RefreshCw className="size-3" />
              刷新状态
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="jelly-btn h-7 flex-1 gap-1 rounded-lg text-[10.5px] text-muted-foreground hover:text-destructive"
              onClick={() => void doSignOut()}
            >
              <LogOut className="size-3" />
              退出登录
            </Button>
          </div>
        </>
      )}

      {fb && (
        <p className={`flex items-start gap-1 text-[11px] leading-relaxed ${fb.ok ? "text-success" : "text-destructive"}`}>
          {fb.ok ? <CheckCircle2 className="mt-0.5 size-3 shrink-0" /> : <XCircle className="mt-0.5 size-3 shrink-0" />}
          {fb.text}
        </p>
      )}
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
