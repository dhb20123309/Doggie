// 认证运行时的云端入口桥：统一经 cloud-client 惰性获取真实 supabase 客户端。
// 无云服务配置（GitHub Pages 静态部署）时返回 null，调用方给出"未配置云服务"错误反馈；
// 绝不在模块顶层 import @/supabase/client——该模块在无 env 时会抛错导致整页白屏。
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/cloud-client';

export async function requireSupabase(): Promise<SupabaseClient> {
  const client = await getSupabase();
  if (!client) {
    throw Object.assign(new Error('当前部署未配置云服务，无法使用账号登录'), {
      code: 'cloud_not_configured',
    });
  }
  return client;
}
