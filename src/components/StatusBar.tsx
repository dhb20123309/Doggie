// 手机状态栏：时间、信号、电量
import { useEffect, useState } from "react";

export function StatusBar({ dark = false }: { dark?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const color = dark ? "text-white" : "text-foreground";

  return (
    <div className={`flex items-center justify-between px-5 pt-2 pb-1 text-[11px] font-medium tabular-nums ${color}`}>
      <span>{hh}:{mm}</span>
      <div className="flex items-center gap-1.5">
        {/* 信号 */}
        <svg width="14" height="10" viewBox="0 0 14 10" fill="currentColor" aria-label="信号">
          <rect x="0" y="7" width="2.5" height="3" rx="0.5" />
          <rect x="3.8" y="5" width="2.5" height="5" rx="0.5" />
          <rect x="7.6" y="2.5" width="2.5" height="7.5" rx="0.5" />
          <rect x="11.4" y="0" width="2.5" height="10" rx="0.5" opacity="0.35" />
        </svg>
        <span className="pulse-dot inline-block size-1.5 rounded-full bg-success" aria-label="在线" />
        {/* 电池 */}
        <span className="flex items-center gap-0.5">
          <span className="relative h-[9px] w-[17px] rounded-[2.5px] border border-current/70">
            <span className="absolute inset-[1.5px] right-[5px] rounded-[1px] bg-current" />
          </span>
          <span className="text-[9px] leading-none">78%</span>
        </span>
      </div>
    </div>
  );
}
