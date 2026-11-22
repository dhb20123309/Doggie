// 锁屏密码 + 壁纸（锁屏/桌面自定义背景）本地持久化
import { useEffect, useState } from "react";

const PWD_KEY = "vp-phone:lockpass:v1";
const LOCK_WP_KEY = "vp-phone:lock-wallpaper:v1";
const HOME_WP_KEY = "vp-phone:home-wallpaper:v1";
const CHAT_BG_KEY = "vp-phone:chat-bg:v1";

/** 初始固定密码 */
export const DEFAULT_PASSCODE = "0517";

/** 内置默认壁纸（AI 生成 CDN 图，用户可在设置里上传替换） */
export const DEFAULT_LOCK_WALLPAPER =
  "https://g.cdn.meoo.host/xn5qwuicmstz/ai-images/锁屏壁纸.png?auth_key=6b7d924b2b56a07a1771b1ecca3a5b572e8092ca8b319c10bd24626ec17b9eb1";
export const DEFAULT_HOME_WALLPAPER =
  "https://g.cdn.meoo.host/xn5qwuicmstz/ai-images/%E5%A4%B4%E5%83%8F%E5%BA%95%E5%BA%A7%E8%83%8C%E6%99%AF.png?auth_key=38385574f2560e0b2e4aa846fd14ab7a21d7a959c708c48b3de78a0e2344bfd3";
export const DEFAULT_CHAT_BACKGROUND =
  "https://g.cdn.meoo.host/xn5qwuicmstz/ai-images/聊天背景默认.png?auth_key=3560dae87179a8fa854ef45b80c274eda187956799340604561e589e415635fb";

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

export function useChatBackground(): [string, Setter<string>] {
  return usePersistedStr(CHAT_BG_KEY, DEFAULT_CHAT_BACKGROUND);
}
