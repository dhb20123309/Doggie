// 锁屏密码 + 壁纸（锁屏/桌面自定义背景）本地持久化
import { useEffect, useState } from "react";

const PWD_KEY = "vp-phone:lockpass:v1";
const LOCK_WP_KEY = "vp-phone:lock-wallpaper:v1";
const HOME_WP_KEY = "vp-phone:home-wallpaper:v1";

/** 初始固定密码 */
export const DEFAULT_PASSCODE = "0517";

/** 内置默认壁纸（AI 生成 CDN 图，用户可在设置里上传替换） */
export const DEFAULT_LOCK_WALLPAPER =
  "https://g.cdn.meoo.host/xn5qwuicmstz/ai-images/锁屏壁纸.png?auth_key=6b7d924b2b56a07a1771b1ecca3a5b572e8092ca8b319c10bd24626ec17b9eb1";
export const DEFAULT_HOME_WALLPAPER =
  "https://g.cdn.meoo.host/xn5qwuicmstz/ai-images/桌面壁纸.png?auth_key=4583818c344ecffea76a6d904bf6f3efaf12108567f007f6cb00aa28db0047c3";

function readStr(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeStr(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* 隐私模式忽略 */
  }
}

type Setter<T> = (next: T | ((prev: T) => T)) => void;

function usePersistedStr(key: string, fallback: string): [string, Setter<string>] {
  const [value, setValue] = useState<string>(() => readStr(key, fallback));
  const update: Setter<string> = (next) => {
    setValue((prev) => {
      const resolved = next instanceof Function ? next(prev) : next;
      writeStr(key, resolved);
      return resolved;
    });
  };
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) setValue(readStr(key, fallback));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [value, update];
}

export function usePasscode(): [string, Setter<string>] {
  return usePersistedStr(PWD_KEY, DEFAULT_PASSCODE);
}

export function useLockWallpaper(): [string, Setter<string>] {
  return usePersistedStr(LOCK_WP_KEY, DEFAULT_LOCK_WALLPAPER);
}

export function useHomeWallpaper(): [string, Setter<string>] {
  return usePersistedStr(HOME_WP_KEY, DEFAULT_HOME_WALLPAPER);
}
