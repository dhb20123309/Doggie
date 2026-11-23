// 开机引导卡：首次解锁且未登录时弹一次；"稍后再说"永久不再打扰（vp-phone:cloud-onboard:v1）。
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  onLogin: () => void;
  onSkip: () => void;
}

export function CloudOnboard({ onLogin, onSkip }: Props) {
  return (
    <div className="absolute inset-0 z-[75] flex items-end justify-center bg-black/40 pb-16">
      <div className="drawer-panel glass-strong mx-3 w-full max-w-[340px] rounded-3xl p-5 shadow-2xl">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 ring-1 ring-primary/20">
          <KeyRound className="size-6 text-primary" />
        </div>
        <h3 className="text-center text-sm font-bold">给你的回忆上个云保险</h3>
        <p className="mt-1.5 text-center text-[11px] leading-relaxed text-muted-foreground">
          注册专属账号后，角色、聊天、群聊、世界书、相册都能备份到云端，换设备登录即可完整找回。
        </p>
        <Button className="jelly-blob mt-4 w-full rounded-2xl py-4 text-sm font-semibold" onClick={onLogin}>
          去登录 / 注册
        </Button>
        <Button variant="ghost" size="sm" className="mt-1.5 w-full justify-center text-[11px] text-muted-foreground" onClick={onSkip}>
          稍后再说
        </Button>
      </div>
    </div>
  );
}
