// 配置持久化：仅存于当前浏览器 localStorage，绝不写入代码仓库
import { useEffect, useState } from "react";
import { type AiConfig, EMPTY_CONFIG } from "./types";

const KEY = "vp-phone:aiconfig:v1";

export function loadConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY_CONFIG;
    const parsed = JSON.parse(raw) as Partial<AiConfig>;
    return {
      baseUrl: parsed.baseUrl ?? "",
      apiKey: parsed.apiKey ?? "",
      model: parsed.model ?? "",
    };
  } catch {
    return EMPTY_CONFIG;
  }
}

export function saveConfig(cfg: AiConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* 隐私模式下可能失败，忽略 */
  }
}

/** 全局配置 hook：多个组件共享同一份内存状态 */
let current: AiConfig = typeof window !== "undefined" ? loadConfig() : EMPTY_CONFIG;
const listeners = new Set<(c: AiConfig) => void>();

export function useAiConfig(): [AiConfig, (next: AiConfig) => void] {
  const [cfg, setCfg] = useState(current);
  useEffect(() => {
    const fn = (next: AiConfig) => setCfg(next);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  const update = (next: AiConfig) => {
    current = next;
    saveConfig(next);
    listeners.forEach((fn) => fn(next));
  };
  return [cfg, update];
}
