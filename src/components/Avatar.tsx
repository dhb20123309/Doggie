// 共享头像组件：RoleChatApp 私聊与 GroupChatView 群聊共用（emoji 或图片 URL + 在线状态点 + 未读角标）
import type { Character } from "@/lib/chat-types";

export type DotStatus = "online" | "typing" | "offline";

export function Avatar({ character, size, status, badge }: { character: Character; size: number; status?: DotStatus; badge?: number }) {
  const isImg = character.avatar.startsWith("data:") || character.avatar.startsWith("http");
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <span
        className="flex size-full items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-wallpaper-from to-wallpaper-to ring-1 ring-white/40"
        style={{ fontSize: size * 0.55 }}
      >
        {isImg ? <img src={character.avatar} alt="角色头像" className="size-full object-cover" /> : character.avatar || "👤"}
      </span>
      {status && !badge && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 rounded-full ring-2 ring-white/80 ${
            status === "online" ? "bg-success" : status === "typing" ? "bg-warning pulse-dot" : "bg-muted-foreground/50"
          }`}
          style={{ width: Math.max(7, size * 0.28), height: Math.max(7, size * 0.28) }}
          aria-label={status === "online" ? "在线" : status === "typing" ? "正在输入" : "离线"}
        />
      )}
      {!!badge && (
        <span
          className="absolute -right-1.5 -top-1.5 flex min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-semibold leading-4 text-white shadow-sm"
          aria-label={`${badge} 条未读`}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </span>
  );
}
