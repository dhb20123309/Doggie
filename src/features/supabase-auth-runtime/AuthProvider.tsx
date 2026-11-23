// 应用根部只挂载一次；业务查询放在 Auth 状态更新后的 effect 中。
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { supabase } from '@/supabase/client';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error';
export type AuthFlow = 'standard' | 'password_recovery';

interface AuthSnapshot {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  error: Error | null;
  authFlow: AuthFlow;
}

export interface AuthContextValue extends AuthSnapshot {
  username: string | null;
  enterPasswordRecovery: () => void;
  leavePasswordRecovery: () => void;
}

const initialSnapshot: AuthSnapshot = {
  status: 'loading',
  session: null,
  user: null,
  error: null,
  authFlow: 'standard',
};
const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function resolveAuthFlow(
  event: AuthChangeEvent,
  current: AuthSnapshot,
  session: Session | null,
): AuthFlow {
  if (!session || event === 'SIGNED_OUT' || event === 'USER_UPDATED') return 'standard';
  if (event === 'PASSWORD_RECOVERY') return 'password_recovery';
  // 同一用户刷新会话时保留标记；切换身份不能继承上一个用户的恢复流程。
  return current.session?.user.id === session.user.id ? current.authFlow : 'standard';
}

async function readInitialSnapshot(): Promise<AuthSnapshot> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session) return { ...initialSnapshot, status: 'anonymous' };
  const { data: identity, error: identityError } =
    await supabase.auth.getUser();
  if (identityError || !identity.user) {
    return {
      ...initialSnapshot,
      status: 'error',
      session: data.session,
      error: identityError ?? new Error('登录身份校验失败'),
    };
  }
  return {
    ...initialSnapshot,
    status: 'authenticated',
    session: data.session,
    user: identity.user,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AuthSnapshot>(initialSnapshot);
  useEffect(() => {
    let active = true;
    let authRevision = 0;
    const initialRevision = authRevision;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // 初始快照统一由 getSession + getUser 核对；INITIAL_SESSION 不提前认证，
      // 也不作废正在进行的核对或覆盖已得到的错误结果。
      if (!active || event === 'INITIAL_SESSION') return;
      authRevision += 1;
      // 回调只同步状态，不在 Auth 回调内 await 其他 Supabase 请求。
      if (active)
        setSnapshot(current => ({
          status: session ? 'authenticated' : 'anonymous',
          session,
          user: session?.user ?? null,
          error: null,
          authFlow: resolveAuthFlow(event, current, session),
        }));
    });
    // 先订阅再初始化；真实认证变更（包括订阅时同步收到的事件）优先于旧查询。
    void readInitialSnapshot()
      .then(next => {
        if (active && authRevision === initialRevision) setSnapshot(next);
      })
      .catch(error => {
        if (active && authRevision === initialRevision)
          setSnapshot({
            ...initialSnapshot,
            status: 'error',
            error:
              error instanceof Error ? error : new Error('登录状态初始化失败'),
          });
      });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // Recovery OTP 校验成功后调用；该标记只控制 UI，不能替代有效 Session。
  const enterPasswordRecovery = useCallback(() => {
    setSnapshot(current => current.status === 'authenticated' && current.session
      ? { ...current, authFlow: 'password_recovery' }
      : current);
  }, []);
  const leavePasswordRecovery = useCallback(() => {
    setSnapshot(current => ({ ...current, authFlow: 'standard' }));
  }, []);
  const value = useMemo<AuthContextValue>(() => {
    const username = snapshot.user?.user_metadata?.username;
    return {
      ...snapshot,
      username:
        typeof username === 'string' && username.length > 0 ? username : null,
      enterPasswordRecovery,
      leavePasswordRecovery,
    };
  }, [snapshot, enterPasswordRecovery, leavePasswordRecovery]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return context;
}
