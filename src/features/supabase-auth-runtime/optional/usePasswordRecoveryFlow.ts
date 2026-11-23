import { useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/supabase/client';
import { normalizeMainlandPhone } from '../auth-phone';
import { useAuth } from '../AuthProvider';
import type { createAuthActions } from '../auth-actions';
import { resolveAuthFeedback, type AuthFeedbackOperation } from '../auth-error';

type RecoveryActions = Pick<ReturnType<typeof createAuthActions>,
  'requestPasswordRecovery' | 'verifyPasswordRecovery' | 'updatePassword'
> & { mode: 'auth_email_password' | 'auth_sms_password' };

export type PasswordRecoveryStep =
  | 'request' | 'verify' | 'checkingIdentity' | 'password'
  | 'saving' | 'signingOut' | 'done' | 'invalid';

interface RecoveryState {
  step: PasswordRecoveryStep;
  pendingIdentity: string;
  passwordSaved: boolean;
  busy: boolean;
  error: string;
}

const initialState: RecoveryState = {
  step: 'request', pendingIdentity: '', passwordSaved: false, busy: false, error: '',
};

// 只管理本次恢复步骤；身份仍来自唯一的 AuthProvider 和平台 Client。
// 页面必须从进入恢复入口起使用 mode="recovery"，祖先不能按 Session 跳走。
export function usePasswordRecoveryFlow(actions: RecoveryActions) {
  const auth = useAuth();
  const [state, setState] = useState<RecoveryState>(initialState);
  const current = useRef(state);
  const latestAuth = useRef(auth);
  latestAuth.current = auth;
  const active = useRef(true);
  const revision = useRef(0);
  const ownerId = useRef<string | null>(null);

  function patch(next: Partial<RecoveryState>) {
    current.current = { ...current.current, ...next };
    if (active.current) setState(current.current);
  }

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      revision.current += 1;
      // 不在卸载时自动注销：用户可能已在其他入口切换账号。
    };
  }, []);

  useEffect(() => {
    if (!ownerId.current || current.current.step === 'done') return;
    // 本流程退出成功也会先收到 SIGNED_OUT，由退出请求结果推进 done。
    if (current.current.step === 'signingOut' && auth.status === 'anonymous') return;
    if (auth.status === 'anonymous' || (auth.user && auth.user.id !== ownerId.current)) {
      revision.current += 1;
      ownerId.current = null;
      patch({ step: 'invalid', busy: false, error: '登录身份已变化，请重新发起找回密码。' });
    }
  }, [auth.status, auth.user?.id]);

  function live(id: number) {
    return active.current && revision.current === id;
  }

  async function run(
    steps: PasswordRecoveryStep[], operation: AuthFeedbackOperation,
    action: (id: number) => Promise<void>,
  ): Promise<boolean> {
    if (!active.current || current.current.busy || !steps.includes(current.current.step)) return false;
    const id = ++revision.current;
    patch({ busy: true, error: '' });
    try {
      await action(id);
      return live(id);
    } catch (error) {
      if (live(id)) patch({ error: resolveAuthFeedback(error, { operation }).message });
      return false;
    } finally {
      if (live(id)) patch({ busy: false });
    }
  }

  function matches(user: User, identity: string) {
    if (actions.mode === 'auth_sms_password') {
      try {
        return !!user.phone && normalizeMainlandPhone(user.phone) === normalizeMainlandPhone(identity);
      } catch {
        return false;
      }
    }
    return user.email?.toLowerCase() === identity.toLowerCase();
  }

  async function readSessionUser() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session?.user ?? null;
  }

  function invalidIdentity() {
    patch({ step: 'invalid' });
    return new Error('恢复身份已失效，请重新发起找回密码。');
  }

  async function exitSession(id: number) {
    const user = await readSessionUser();
    if (!live(id)) return;
    if (user && user.id !== ownerId.current) throw invalidIdentity();
    if (user) {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (!live(id)) return;
      if (error) throw error;
    }
    const remaining = await readSessionUser();
    if (!live(id)) return;
    if (remaining) throw new Error('退出尚未完成，请重试退出当前恢复会话。');
    latestAuth.current.leavePasswordRecovery();
    ownerId.current = null;
    patch({ step: 'done', pendingIdentity: '' });
  }

  function request(identity: string) {
    return run(['request', 'verify', 'invalid'], 'requestPasswordRecovery', async id => {
      const pendingIdentity = current.current.step === 'verify'
        ? current.current.pendingIdentity
        : actions.mode === 'auth_sms_password' ? normalizeMainlandPhone(identity) : identity.trim();
      if (!pendingIdentity) throw new Error('请填写找回密码的账号。');
      // 恢复重发仍调用恢复动作；不要复用注册确认 resend。
      const { error } = await actions.requestPasswordRecovery(pendingIdentity);
      if (!live(id)) return;
      if (error) throw error;
      ownerId.current = null;
      patch({ step: 'verify', pendingIdentity, passwordSaved: false });
    });
  }

  function verify(token: string) {
    return run(['verify'], 'verifyPasswordRecovery', async id => {
      const identity = current.current.pendingIdentity;
      const { data, error } = await actions.verifyPasswordRecovery(identity, token.trim());
      if (!live(id)) return;
      if (error) throw error;
      if (!data.session) throw new Error('验证码未建立有效会话，请重新验证。');
      // 验证成功后可重试身份检查；不能再次消费已使用的验证码。
      ownerId.current = data.session.user.id;
      patch({ step: 'checkingIdentity' });
      await checkIdentity(id);
    });
  }

  async function checkIdentity(id: number) {
    const { data, error } = await supabase.auth.getUser();
    if (!live(id)) return;
    if (error) throw error;
    if (!data.user || data.user.id !== ownerId.current || !matches(data.user, current.current.pendingIdentity)) {
      throw invalidIdentity();
    }
    const user = await readSessionUser();
    if (!live(id)) return;
    if (user?.id !== ownerId.current) throw invalidIdentity();
    latestAuth.current.enterPasswordRecovery();
    patch({ step: 'password' });
  }

  function retryIdentity() {
    return run(['checkingIdentity'], 'verifyPasswordRecovery', checkIdentity);
  }

  function save(password: string) {
    return run(['password'], 'updatePassword', async id => {
      // 再核对当前身份，不能用 URL、普通 Session 或旧验证结果直接改密。
      const { data, error } = await supabase.auth.getUser();
      if (!live(id)) return;
      if (error) throw error;
      const user = await readSessionUser();
      if (!live(id)) return;
      if (!ownerId.current || data.user?.id !== ownerId.current || user?.id !== ownerId.current
        || !matches(data.user, current.current.pendingIdentity)
        || latestAuth.current.authFlow !== 'password_recovery') throw invalidIdentity();
      patch({ step: 'saving' });
      try {
        const { error: updateError } = await actions.updatePassword(password);
        if (!live(id)) return;
        if (updateError) throw updateError;
      } catch (error) {
        if (live(id)) patch({ step: 'password' });
        throw error;
      }
      // USER_UPDATED 可清除 authFlow；页面按 step 展示保存结果和退出入口。
      patch({ step: 'signingOut', passwordSaved: true });
    });
  }

  function finish() {
    return run(['signingOut'], 'session', exitSession);
  }

  function cancel() {
    return run(['request', 'verify', 'checkingIdentity', 'password', 'invalid'], 'session', async id => {
      if (ownerId.current) {
        patch({ step: 'signingOut' });
        await exitSession(id);
      } else {
        patch({ step: 'done', pendingIdentity: '' });
      }
    });
  }

  return { ...state, request, verify, retryIdentity, save, finish, cancel };
}
