// 手机状态栏：时间、信号格、Wi-Fi、电量（iOS 风格）
import { useEffect, useState } from "react";

export function StatusBar({ dark = false }: { dark?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const color = dark ? "text-[oklch(0.3_0.02_80)] [text-shadow:0_1px_3px_oklch(1_0_0/0.7)]" : "text-foreground";

  return (
    <div className={`absolute left-0 right-0 top-0 z-40 flex items-center justify-between px-6 pt-2.5 pb-1 text-[11px] font-semibold tabular-nums ${color}`}>
      <span>{hh}:{mm}</span>
      <div className="flex items-center gap-1.5">
        {/* 信号 */}
        <svg width="15" height="10" viewBox="0 0 15 10" fill="currentColor" aria-label="信号">
          <rect x="0" y="7" width="2.5" height="3" rx="0.8" />
          <rect x="3.9" y="5" width="2.5" height="5" rx="0.8" />
          <rect x="7.8" y="2.5" width="2.5" height="7.5" rx="0.8" />
          <rect x="11.7" y="0" width="2.5" height="10" rx="0.8" opacity="0.35" />
        </svg>
        {/* Wi-Fi */}
        <svg width="13" height="10" viewBox="0 0 13 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-label="Wi-Fi">
          <path d="M1.5 3.6a7.5 7.5 0 0 1 10 0" opacity="0.9" />
          <path d="M3.6 5.9a4.6 4.6 0 0 1 5.8 0" />
          <path d="M5.6 8.1a1.8 1.8 0 0 1 1.8 0" />
        </svg>
        {/* 电池 */}
        <span className="flex items-center gap-0.5">
          <span className="relative h-[10px] w-[19px] rounded-[3px] border border-current/70">
            <span className="absolute inset-[1.5px] right-[5px] rounded-[1.5px] bg-current" />
            <span className="absolute -right-[2.5px] top-1/2 h-[4px] w-[1.5px] -translate-y-1/2 rounded-r bg-current/70" />
          </span>
          <span className="text-[9px] leading-none">78%</span>
        </span>
      </div>
    </div>
  );
}
