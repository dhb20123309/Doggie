// 锁屏页：时间日期 + 数字密码面板（0-9/删除）+ 圆点指示器，校验通过才解锁
import { useEffect, useState } from "react";
import { Delete, Lock } from "lucide-react";

interface Props {
  passcode: string;
  wallpaper: string;
  onUnlock: () => void;
  /** 真机沉浸模式：顶部时间区避开系统状态栏安全区 */
  immersive?: boolean;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

export function LockScreen({ passcode, wallpaper, onUnlock, immersive = false }: Props) {
  const [now, setNow] = useState(() => new Date());
  const [entered, setEntered] = useState("");
  const [error, setError] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  const len = Math.max(4, passcode.length);

  const press = (k: string) => {
    if (leaving) return;
    setError(false);
    if (k === "del") {
      setEntered((e) => e.slice(0, -1));
      return;
    }
    if (!k || entered.length >= len) return;
    const next = entered + k;
    setEntered(next);
    if (next.length >= passcode.length) {
      if (next === passcode) {
        setLeaving(true);
        setTimeout(onUnlock, 450);
      } else if (next.length === len) {
        setError(true);
        setTimeout(() => {
          setError(false);
          setEntered("");
        }, 500);
      }
    }
  };

  const week = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][now.getDay()];

  return (
    <div className={`relative flex h-full flex-col text-white ${leaving ? "lock-unlock" : ""}`}>
      {/* 壁纸层 */}
      <div
        className="absolute inset-0"
        style={{ backgroundImage: `url(${wallpaper})`, backgroundSize: "cover", backgroundPosition: "center" }}
      />
      <div className="lock-scrim absolute inset-0" />

      {/* 内容层：自身不做 transform，玻璃子元素才不会在动画期间降级模糊 */}
      <div className="lock-content relative z-10 flex h-full flex-col">
        {/* 顶部时间区 */}
        <div className={`flex flex-col items-center ${immersive ? "pt-[calc(2.5rem+env(safe-area-inset-top))]" : "pt-14"}`}>
          <Lock className="size-5 text-white/85" strokeWidth={1.6} />
          <p className="mt-3 font-display text-[56px] font-semibold leading-none tracking-tight tabular-nums" style={{ textShadow: "0 2px 14px rgba(60,50,90,.45)" }}>
            {String(now.getHours()).padStart(2, "0")}:{String(now.getMinutes()).padStart(2, "0")}
          </p>
          <p className="mt-2 text-sm font-medium text-white/95" style={{ textShadow: "0 1px 10px rgba(60,50,90,.5)" }}>
            {week} · {now.getMonth() + 1}月{now.getDate()}日
          </p>
        </div>

        {/* 圆点指示器 */}
        <div className={`mt-8 flex justify-center gap-2.5 ${error ? "shake-x" : ""}`}>
          {Array.from({ length: len }).map((_, i) => (
            <span
              key={i}
              className={`size-2.5 rounded-full border transition-all duration-200 ${
                i < entered.length
                  ? error
                    ? "border-destructive bg-destructive"
                    : "border-white bg-white"
                  : "border-white/60 bg-white/15"
              }`}
            />
          ))}
        </div>
        <p
          className={`h-4 text-center text-xs transition-opacity ${error ? "opacity-100" : "opacity-0"}`}
          style={{ color: "#fff", textShadow: "0 1px 6px rgba(0,0,0,.4)" }}
        >
          密码错误，请重新输入
        </p>

        {/* 数字键盘 */}
        <div className="mt-auto grid grid-cols-3 gap-x-8 gap-y-3 px-10 pb-6">
          {KEYS.map((k, i) =>
            k === "" ? (
              <span key={i} />
            ) : (
              <button
                key={i}
                type="button"
                onClick={() => press(k)}
                aria-label={k === "del" ? "删除" : `数字 ${k}`}
                className={`jelly-icon mx-auto flex size-[58px] items-center justify-center rounded-full text-xl font-medium text-white transition-colors active:bg-white/40 ${
                  k === "del" ? "text-sm" : "key-soft"
                }`}
                style={k === "del" ? { background: "transparent", border: "none", boxShadow: "none" } : undefined}
              >
                {k === "del" ? <Delete className="size-5" /> : k}
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
