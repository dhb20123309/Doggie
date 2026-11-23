import type { ReactNode } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { AuthEntryGate, AuthGate } from './AuthGate';
import { useAuth } from './AuthProvider';
import { PasswordLoginForm, type PasswordLoginFormProps } from './PasswordAuthForms';
import { resolveSafeReturnTo } from './auth-navigation';

const restoring = <p role="status">正在恢复登录状态…</p>;

/**
 * 用于 Web 项目的普通用户名密码登录页。将登录路由放在根 AuthProvider 下、
 * ProtectedLayout 外，使匿名用户可以打开表单，已登录用户会自动跳转。
 *
 * - signIn（必填）接收 { username, password }，返回含 { data, error } 的异步结果。
 *   可直接传入 createAuthActions('basic_auth') 创建的 authActions.signIn。
 *   表单负责展示错误并允许重试，登录成功后的跳转由组件随认证状态变化触发。
 * - authenticatedPath（必填）传入项目中实际存在的站内业务路径，如 /app。
 *   登录后优先返回 URL 中有效的 returnTo，缺失或校验失败时使用 authenticatedPath。
 * - className（可选）传给登录表单，用于设置页面样式。
 *
 * @example
 * // src/routes/login.tsx
 * import { createFileRoute } from '@tanstack/react-router';
 * import { LoginEntry } from '@/features/supabase-auth-runtime';
 * import { authActions } from '@/lib/auth';
 *
 * export const Route = createFileRoute('/login')({ component: LoginPage });
 * function LoginPage() {
 *   return <LoginEntry signIn={authActions.signIn} authenticatedPath="/app" className="account-form" />;
 * }
 */
export function LoginEntry({
  signIn,
  authenticatedPath,
  className,
}: PasswordLoginFormProps & { authenticatedPath: string }) {
  const { status } = useAuth();
  const search = useRouterState({ select: state => state.location.searchStr });
  const target = resolveSafeReturnTo(new URLSearchParams(search).get('returnTo'), authenticatedPath);
  return (
    <AuthEntryGate mode="login" status={status} authenticatedPath={target} loadingFallback={restoring}>
      <PasswordLoginForm signIn={signIn} className={className} />
    </AuthEntryGate>
  );
}

/**
 * 用于个人中心、工作台等要求登录的页面。在这些页面共同的父路由中包住 Outlet，
 * 所有子页面即可共享根布局的 AuthProvider，无需逐页判断登录状态。
 * 登录、注册等公开页面放在这个父路由之外，否则匿名用户无法打开登录表单。
 *
 * 恢复会话时显示等待提示，已登录时渲染子页面。匿名访问默认跳到 /login，
 * 并用 returnTo 记录原地址。传入 loginPath 时直接跳到该地址。
 *
 * @example
 * // src/routes/app.tsx 中的父路由组件，保护 /app 及其子页面。
 * function AppLayout() {
 *   return <ProtectedLayout><Outlet /></ProtectedLayout>;
 * }
 */
export function ProtectedLayout({ children, loginPath }: { children: ReactNode; loginPath?: string }) {
  const { status } = useAuth();
  return (
    <AuthGate status={status} loginPath={loginPath} loadingFallback={restoring}>
      {children}
    </AuthGate>
  );
}
