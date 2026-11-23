// Supabase Auth 第一因子动作；调用方必须只选择 authentication.md 已确认的一种 SOP。
import { supabase } from '@/supabase/client';
import { normalizeMainlandPhone } from './auth-phone';
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
  signOut() {
    return supabase.auth.signOut();
  },
};

const basicAuthActions = {
  ...sharedActions,
  mode: 'basic_auth' as const,
  supportsPasswordRecovery: false as const,
  signUp({ username, password }: BasicAuthSignUpInput) {
    const normalizedUsername = username.trim();
    return supabase.auth.signUp({
      email: toAuthEmail(normalizedUsername),
      password,
      options: { data: { username: normalizedUsername } },
    });
  },
  signIn({ username, password }: BasicAuthSignUpInput) {
    return supabase.auth.signInWithPassword({
      email: toAuthEmail(username),
      password,
    });
  },
};

const emailPasswordActions = {
  ...emailVerificationActions,
  ...sharedActions,
  mode: 'auth_email_password' as const,
  supportsPasswordRecovery: true as const,
  signUp({
    email,
    password,
    username,
    emailRedirectTo,
  }: EmailPasswordSignUpInput) {
    const normalizedEmail = requireValue(email, '邮箱');
    const normalizedUsername = requireValue(username, '用户名');
    return supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: { username: normalizedUsername },
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
      },
    });
  },
  signIn({
    email,
    password,
  }: Pick<EmailPasswordSignUpInput, 'email' | 'password'>) {
    return supabase.auth.signInWithPassword({
      email: requireValue(email, '邮箱'),
      password,
    });
  },
};

const phonePasswordActions = {
  ...phoneVerificationActions,
  ...sharedActions,
  mode: 'auth_sms_password' as const,
  supportsPasswordRecovery: true as const,
  signUp({ phone, password, username }: PhonePasswordSignUpInput) {
    const normalizedPhone = normalizeMainlandPhone(phone);
    const normalizedUsername = requireValue(username, '用户名');
    return supabase.auth.signUp({
      phone: normalizedPhone,
      password,
      options: { data: { username: normalizedUsername } },
    });
  },
  signIn({
    phone,
    password,
  }: Pick<PhonePasswordSignUpInput, 'phone' | 'password'>) {
    return supabase.auth.signInWithPassword({
      phone: normalizeMainlandPhone(phone),
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
