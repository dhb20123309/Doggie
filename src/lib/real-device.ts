// 真机沉浸模式：真实手机浏览器里隐藏"假系统 UI"（自绘状态栏/灵动岛），并用 visualViewport 实时同步 --app-vh，
// 修复 iOS 动态工具栏下 height:100% 链塌陷导致的底部空白。桌面预览（宽屏/鼠标）保持模拟机身不变。
import { useEffect, useState } from "react";

/** 是否运行在真实触屏设备（平板同样按真机处理：窄屏+触屏=没有理由再画假外壳） */
export function isRealDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const coarse = matchMedia("(pointer: coarse)").matches;
  const touch = (navigator.maxTouchPoints ?? 0) > 0 || "ontouchstart" in window;
  const iosUA = /iP(hone|od|ad)/.test(navigator.userAgent);
  const androidUA = /Android/.test(navigator.userAgent);
  // 触屏笔记本（pointer:fine）不命中；只认"粗指针或触屏 + 移动 UA"，双条件收敛误判
  return (coarse || touch) && (iosUA || androidUA);
}

/**
 * 挂载时启动：把可视视口高度写入 CSS 变量 --app-vh（styles.css 高度链消费）。
 * 监听 visualViewport resize/scroll 与 orientationchange，键盘弹出/工具栏收缩都即时跟随。
 */
export function useAppViewportHeight(): void {
  useEffect(() => {
    const sync = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--app-vh", `${Math.round(h)}px`);
    };
    sync();
    window.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("scroll", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);
    };
  }, []);
}

/** 真机标志（组件内用；SSR 安全，首帧 false 后立即校正） */
export function useIsRealDevice(): boolean {
  const [real, setReal] = useState(false);
  useEffect(() => setReal(isRealDevice()), []);
  return real;
}
