// 角色与聊天记录的本地持久化（localStorage），刷新后保留
import { useEffect, useState } from "react";
import { type Character, type ChatEntry, DEFAULT_CHARACTER } from "./chat-types";

const CHAR_KEY = "vp-phone:character:v1";
const LOG_KEY = "vp-phone:rolechat-log:v1";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式忽略 */
  }
}

type Setter<T> = (next: T | ((prev: T) => T)) => void;

function usePersisted<T>(key: string, fallback: T): [T, Setter<T>] {
  const [value, setValue] = useState<T>(() => read(key, fallback));
  const update: Setter<T> = (next) => {
    setValue((prev) => {
      const resolved = next instanceof Function ? next(prev) : next;
      write(key, resolved);
      return resolved;
    });
  };
  // 多组件实例间同步（同一页面内挂载点较少，靠 key 重挂载即可）
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === key && e.newValue) {
        try {
          setValue(JSON.parse(e.newValue) as T);
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);
  return [value, update];
}

export function useCharacter(): [Character, Setter<Character>] {
  return usePersisted(CHAR_KEY, DEFAULT_CHARACTER);
}

export function useChatLog(): [ChatEntry[], Setter<ChatEntry[]>] {
  return usePersisted(LOG_KEY, [] as ChatEntry[]);
}

export function clearChatLog(): void {
  write(LOG_KEY, []);
}
