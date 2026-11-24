// Supabase Auth 第一因子动作；调用方必须只选择 authentication.md 已确认的一种 SOP。
// 云端客户端统一经 requireSupabase() 惰性获取：无云服务配置时返回带 code 的失败结果，
// 由 useAuthSubmit 转成用户可读反馈，而不是抛错打断页面。
import { normalizeMainlandPhone } from './auth-phone';
import { requireSupabase } from './cloud-auth';
import type { AuthResponse } from './optional/auth-verification';
import {
  emailVerificationActions,
  phoneVerificationActions,
} from './optional/auth-verification';

export type AuthImplementationSop =
  | 'basic_auth'
  | 'auth_email_password'
  | 'auth_sms_password';

export interface BasicAuthSignUpInput {
  username: string;
  password: string;
}

export interface EmailPasswordSignUpInput {
  email: string;
  password: string;
  username: string;
  emailRedirectTo?: string;
}

export interface PhonePasswordSignUpInput {
  phone: string;
  password: string;
  username: string;
}

/** 无云配置时的统一失败响应（SDK 形状：data 空 + error） */
async function cloudless<T>(): Promise<AuthResponse<T>> {
  try {
    await requireSupabase();
  } catch (error) {
    return { data: {} as T, error: error as Error };
  }
  return { data: {} as T, error: null };
}

function requireValue(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${fieldName}不能为空`);
  return normalized;
}

function toAuthEmail(username: string): string {
  const account = username.trim();
  if (!account) {
    throw Object.assign(new Error('请输入用户名或邮箱'), {
      code: 'auth_input_required',
    });
  }
  // 按原始输入选择提示，不能将内部虚拟邮箱的错误当作用户邮箱错误。
  const isEmailInput = account.includes('@');
  const email = isEmailInput ? account : `${account}@meoo.local`;
  const parts = email.split('@');
  const [local, domain] = parts;
  const localPattern =
    /^[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
  const labelPattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
  if (
    parts.length !== 2 ||
    /\s/.test(account) ||
    local.length > 64 ||
    !localPattern.test(local) ||
    !domain.split('.').every(label => labelPattern.test(label)) ||
    email.length > 254
  ) {
    throw Object.assign(
      new Error(isEmailInput ? '请输入正确的邮箱地址' : '请输入正确的用户名'),
      {
        code: isEmailInput
          ? 'auth_input_email_invalid'
          : 'auth_input_username_invalid',
      }
    );
  }
  return email;
}

const sharedActions = {
  async signOut() {
    const supabase = await requireSupabase().catch(() => null);
    if (!supabase) return { data: {} as Record<string, never>, error: null };
    return supabase.auth.signOut();
  },
};

const basicAuthActions = {
  ...sharedActions,
  mode: 'basic_auth' as const,
  supportsPasswordRecovery: false as const,
  async signUp({ username, password }: BasicAuthSignUpInput) {
    const normalizedUsername = username.trim();
    const email = toAuthEmail(normalizedUsername);
    const supabase = await requireSupabase().catch(() => null);
    if (!supabase) return cloudless<{ session: unknown; user: unknown }>();
    return supabase.auth.signUp({
      email,
      password,
      options: { data: { username: normalizedUsername } },
    });
  },
  async signIn({ username, password }: BasicAuthSignUpInput) {
    const email = toAuthEmail(username);
    const supabase = await requireSupabase().catch(() => null);
    if (!supabase) return cloudless<{ session: unknown; user: unknown }>();
    return supabase.auth.signInWithPassword({
      email,
      password,
    });
  },
};

const emailPasswordActions = {
  ...emailVerificationActions,
  ...sharedActions,
  mode: 'auth_email_password' as const,
  supportsPasswordRecovery: true as const,
  async signUp({
    email,
    password,
    username,
    emailRedirectTo,
  }: EmailPasswordSignUpInput) {
    const normalizedEmail = requireValue(email, '邮箱');
    const normalizedUsername = requireValue(username, '用户名');
    const supabase = await requireSupabase().catch(() => null);
    if (!supabase) return cloudless<{ session: unknown; user: unknown }>();
    return supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: { username: normalizedUsername },
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
    });
  },
  async signIn({
    email,
    password,
  }: Pick<EmailPasswordSignUpInput, 'email' | 'password'>) {
    const normalizedEmail = requireValue(email, '邮箱');
    const supabase = await requireSupabase().catch(() => null);
    if (!supabase) return cloudless<{ session: unknown; user: unknown }>();
    return supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });
  },
};

const phonePasswordActions = {
  ...phoneVerificationActions,
  ...sharedActions,
  mode: 'auth_sms_password' as const,
  supportsPasswordRecovery: true as const,
  async signUp({ phone, password, username }: PhonePasswordSignUpInput) {
    const normalizedPhone = normalizeMainlandPhone(phone);
    const normalizedUsername = requireValue(username, '用户名');
    const supabase = await requireSupabase().catch(() => null);
    if (!supabase) return cloudless<{ session: unknown; user: unknown }>();
    return supabase.auth.signUp({
      phone: normalizedPhone,
      password,
      options: { data: { username: normalizedUsername } },
    });
  },
  async signIn({
    phone,
    password,
  }: Pick<PhonePasswordSignUpInput, 'phone' | 'password'>) {
    const normalizedPhone = normalizeMainlandPhone(phone);
    const supabase = await requireSupabase().catch(() => null);
    if (!supabase) return cloudless<{ session: unknown; user: unknown }>();
    return supabase.auth.signInWithPassword({
      phone: normalizedPhone,
      password,
    });
  },
};

export function createAuthActions(sop: 'basic_auth'): typeof basicAuthActions;
export function createAuthActions(
  sop: 'auth_email_password'
): typeof emailPasswordActions;
export function createAuthActions(
  sop: 'auth_sms_password'
): typeof phonePasswordActions;
export function createAuthActions(sop: AuthImplementationSop) {
  switch (sop) {
    case 'basic_auth':
      return basicAuthActions;
    case 'auth_email_password':
      return emailPasswordActions;
    case 'auth_sms_password':
      return phonePasswordActions;
    default:
      throw new Error(`不支持的认证模式：${String(sop)}`);
  }
}
