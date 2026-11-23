// 邮箱／短信模式的确认、恢复和改密动作；由 createAuthActions 按已选模式组合。
import { supabase } from '@/supabase/client';
import { normalizeMainlandPhone } from '../auth-phone';

function requireValue(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${fieldName}不能为空`);
  return normalized;
}

export const emailVerificationActions = {
  verifySignUp(email: string, token: string) {
    return supabase.auth.verifyOtp({
      email: requireValue(email, '邮箱'),
      token,
      type: 'signup',
    });
  },
  requestPasswordRecovery(email: string) {
    const normalizedEmail = requireValue(email, '邮箱');
    return supabase.auth.resetPasswordForEmail(normalizedEmail);
  },
  verifyPasswordRecovery(email: string, token: string) {
    return supabase.auth.verifyOtp({
      email: requireValue(email, '邮箱'),
      token,
      type: 'recovery',
    });
  },
  updatePassword(password: string) {
    return supabase.auth.updateUser({ password });
  },
};

export const phoneVerificationActions = {
  verifySignUp(phone: string, token: string) {
    return supabase.auth.verifyOtp({
      phone: normalizeMainlandPhone(phone),
      token,
      type: 'sms',
    });
  },
  requestPasswordRecovery(phone: string) {
    return supabase.auth.signInWithOtp({
      phone: normalizeMainlandPhone(phone),
      options: { shouldCreateUser: false },
    });
  },
  verifyPasswordRecovery(phone: string, token: string) {
    return supabase.auth.verifyOtp({
      phone: normalizeMainlandPhone(phone),
      token,
      type: 'sms',
    });
  },
  updatePassword(password: string) {
    return supabase.auth.updateUser({ password });
  },
};
