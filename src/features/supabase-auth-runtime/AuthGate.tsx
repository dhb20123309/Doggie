import { useState, type ReactNode } from 'react';
import { useRouter } from '@tanstack/react-router';

import type { AuthStatus } from './AuthProvider';
import { AuthRedirect } from './AuthRedirect';
import { buildLoginPath } from './auth-navigation';

function LoginRedirect({ loginPath }: { loginPath?: string }) {
  const router = useRouter();
  // 只在进入匿名分支时读取来源，旧页面不会追随跳转中的 location 改写 returnTo。
  const [target] = useState(
    () => loginPath ?? buildLoginPath(router.state.location.href)
  );
  return <AuthRedirect href={target} />;
}

interface AuthGateProps {
  status: AuthStatus;
  children: ReactNode;
  loginPath?: string;
  loadingFallback?: ReactNode;
  errorFallback?: ReactNode;
}

export function AuthGate({
  status,
  children,
  loginPath,
  loadingFallback = null,
  errorFallback,
}: AuthGateProps) {
  if (status === 'loading') return loadingFallback;
  if (status === 'error') {
    return (
      errorFallback ?? <div role="alert">登录状态加载失败，请刷新重试</div>
    );
  }
  if (status === 'anonymous') return <LoginRedirect loginPath={loginPath} />;
  return children;
}

export type AuthEntryMode = 'login' | 'register' | 'recovery';

interface AuthEntryGateProps {
  mode: AuthEntryMode;
  status: AuthStatus;
  children: ReactNode;
  authenticatedPath?: string;
  loadingFallback?: ReactNode;
  errorFallback?: ReactNode;
}

// 登录随身份状态导航；注册和恢复由页面步骤完成导航。
export function AuthEntryGate({
  mode,
  status,
  children,
  authenticatedPath = '/',
  loadingFallback = null,
  errorFallback,
}: AuthEntryGateProps) {
  // 保留业务表单层级；注册和恢复页面自行展示 loading/error。
  if (mode === 'register' || mode === 'recovery') return children;
  if (status === 'loading') return loadingFallback;
  if (status === 'error') {
    return (
      errorFallback ?? <div role="alert">登录状态加载失败，请刷新重试</div>
    );
  }
  if (status === 'authenticated') {
    return <AuthRedirect href={authenticatedPath} />;
  }
  return children;
}
