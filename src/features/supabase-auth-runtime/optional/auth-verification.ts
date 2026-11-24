// 邮箱／短信模式的确认、恢复和改密动作；由 createAuthActions 按已选模式组合。
// 客户端经 requireSupabase() 惰性获取；无云配置时返回 SDK 形状的失败结果而非抛错。
import { normalizeMainlandPhone } from '../auth-phone';
import { requireSupabase } from '../cloud-auth';

export type AuthResponse<T> = { data: T; error: Error | null };

async function clientOrError(): Promise<
  Awaited<ReturnType<typeof requireSupabase>> | AuthResponse<Record<string, never>>
> {
  try {
    return await requireSupabase();
  } catch (error) {
    return { data: {}, error: error as Error };
  }
}

function requireValue(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${fieldName}不能为空`);
  return normalized;
}

export const emailVerificationActions = {
  async verifySignUp(email: string, token: string) {
    const supabase = await clientOrError();
    if ('error' in supabase && supabase.error) return supabase;
    return (supabase as NonNullable<Awaited<ReturnType<typeof requireSupabase>>>).auth.verifyOtp({
      email: requireValue(email, '邮箱'),
      token,
      type: 'signup',
    });
  },
  async requestPasswordRecovery(email: string) {
    const normalizedEmail = requireValue(email, '邮箱');
    const supabase = await clientOrError();
    if ('error' in supabase && supabase.error) return supabase;
    return (supabase as NonNullable<Awaited<ReturnType<typeof requireSupabase>>>).auth.resetPasswordForEmail(normalizedEmail);
  },
  async verifyPasswordRecovery(email: string, token: string) {
    const supabase = await clientOrError();
    if ('error' in supabase && supabase.error) return supabase;
    return (supabase as NonNullable<Awaited<ReturnType<typeof requireSupabase>>>).auth.verifyOtp({
      email: requireValue(email, '邮箱'),
      token,
      type: 'recovery',
    });
  },
  async updatePassword(password: string) {
    const supabase = await clientOrError();
    if ('error' in supabase && supabase.error) return supabase;
    return (supabase as NonNullable<Awaited<ReturnType<typeof requireSupabase>>>).auth.updateUser({ password });
  },
};

export const phoneVerificationActions = {
  async verifySignUp(phone: string, token: string) {
    const supabase = await clientOrError();
    if ('error' in supabase && supabase.error) return supabase;
    return (supabase as NonNullable<Awaited<ReturnType<typeof requireSupabase>>>).auth.verifyOtp({
      phone: normalizeMainlandPhone(phone),
      token,
      type: 'sms',
    });
  },
  async requestPasswordRecovery(phone: string) {
    const supabase = await clientOrError();
    if ('error' in supabase && supabase.error) return supabase;
    return (supabase as NonNullable<Awaited<ReturnType<typeof requireSupabase>>>).auth.signInWithOtp({
      phone: normalizeMainlandPhone(phone),
      options: { shouldCreateUser: false },
    });
  },
  async verifyPasswordRecovery(phone: string, token: string) {
    const supabase = await clientOrError();
    if ('error' in supabase && supabase.error) return supabase;
    return (supabase as NonNullable<Awaited<ReturnType<typeof requireSupabase>>>).auth.verifyOtp({
      phone: normalizeMainlandPhone(phone),
      token,
      type: 'sms',
    });
  },
  async updatePassword(password: string) {
    const supabase = await clientOrError();
    if ('error' in supabase && supabase.error) return supabase;
    return (supabase as NonNullable<Awaited<ReturnType<typeof requireSupabase>>>).auth.updateUser({ password });
  },
};
