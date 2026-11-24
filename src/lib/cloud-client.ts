// 云服务可用性包装：GitHub Pages 等无 Meoo Cloud 环境变量的静态部署下，
// src/supabase/client.ts 的模块级 requirePublicEnv 会直接抛错导致整页白屏。
// 本文件不 import 那个模块（避免副作用），改为运行时动态 import + 环境变量预判：
// - 变量齐全 → 返回真实 supabase 客户端（平台内行为零变化）
// - 缺失 → cloudAvailable=false、getSupabase()=null，登录/云存档入口优雅降级为本地模式
import type { SupabaseClient } from "@supabase/supabase-js";

const REQUIRED_ENV = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_ONEDAY_APP_ID",
] as const;

/** 构建期静态表（平台注入 .env 时 Vite define 替换；未注入则回落运行期 import.meta.env） */
declare const __MEOO_CLOUD_ENV__: Record<string, string | undefined> | null;

function envValue(name: string): string | undefined {
  try {
    if (typeof __MEOO_CLOUD_ENV__ === "object" && __MEOO_CLOUD_ENV__) {
      const v = __MEOO_CLOUD_ENV__[name];
      if (v) return v;
    }
  } catch {
    /* define 未替换时该标识符不存在，忽略 */
  }
  return import.meta.env[name];
}

export function hasCloudEnv(): boolean {
  return REQUIRED_ENV.every((k) => !!envValue(k));
}

/** 同步预判：应用根部据此决定挂载真实 AuthProvider 还是本地降级版 */
export const cloudAvailable = hasCloudEnv();

let clientPromise: Promise<SupabaseClient | null> | null = null;

/** 惰性获取真实客户端；无云配置返回 null（调用方须判空） */
export function getSupabase(): Promise<SupabaseClient | null> {
  if (!cloudAvailable) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import("@/supabase/client")
      .then((m) => m.supabase as SupabaseClient)
      .catch((err) => {
        console.warn("[cloud] supabase client unavailable:", err);
        return null;
      });
  }
  return clientPromise;
}
