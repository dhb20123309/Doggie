// 仅在角色权限或 MFA 场景读取和使用。
import type { ReactNode } from 'react';
import { AuthRedirect } from '../AuthRedirect';
import { requireSupabase } from '../cloud-auth';

export type RoleGateStatus = 'loading' | 'granted' | 'denied' | 'error';

// MFA 完成只认 Supabase 返回的 AAL2，不使用前端布尔值代替。

export type AssuranceLevel = 'aal1' | 'aal2' | null;
export type MfaStatus =
  | 'loading'
  | 'not_enrolled'
  | 'challenge_required'
  | 'verified'
  | 'error';

export interface MfaSnapshot {
  status: MfaStatus;
  currentLevel: AssuranceLevel;
  nextLevel: AssuranceLevel;
  error: Error | null;
}

export const initialMfaSnapshot: MfaSnapshot = {
  status: 'loading',
  currentLevel: null,
  nextLevel: null,
  error: null,
};

function deriveMfaStatus(
  currentLevel: AssuranceLevel,
  nextLevel: AssuranceLevel
): Exclude<MfaStatus, 'loading' | 'error'> {
  if (currentLevel === 'aal2') return 'verified';
  if (nextLevel === 'aal2') return 'challenge_required';
  return 'not_enrolled';
}

export async function resolveMfaSnapshot(): Promise<MfaSnapshot> {
  const supabase = await requireSupabase().catch(() => null);
  if (!supabase) {
    return {
      status: 'error',
      currentLevel: null,
      nextLevel: null,
      error: new Error('当前部署未配置云服务'),
    };
  }
  const { data, error } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (error) {
    return {
      status: 'error',
      currentLevel: null,
      nextLevel: null,
      error,
    };
  }

  // SDK 可以返回未来新增的 AAL；未知值不能视为未注册或已验证。
  const normalizeLevel = (value: unknown): AssuranceLevel | undefined => {
    if (value == null) return null;
    if (value === 'aal1' || value === 'aal2') return value;
    return undefined;
  };
  const currentLevel = normalizeLevel(data?.currentLevel);
  const nextLevel = normalizeLevel(data?.nextLevel);
  if (!data || currentLevel === undefined || nextLevel === undefined) {
    return {
      status: 'error',
      currentLevel: null,
      nextLevel: null,
      error: new Error('无法识别二次校验状态，请刷新重试'),
    };
  }
  return {
    status: deriveMfaStatus(currentLevel, nextLevel),
    currentLevel,
    nextLevel,
    error: null,
  };
}

interface MfaGateProps {
  status: MfaStatus;
  children: ReactNode;
  challengePath?: string;
  enrollmentPath?: string;
  loadingFallback?: ReactNode;
  errorFallback?: ReactNode;
}

// 只在明确要求 AAL2 的页面使用；页面跳转不能替代 API/RLS 校验。
export function MfaGate({
  status,
  children,
  challengePath = '/auth/mfa/challenge',
  enrollmentPath = '/auth/mfa/enroll',
  loadingFallback = null,
  errorFallback,
}: MfaGateProps) {
  if (status === 'loading') return loadingFallback;
  if (status === 'error') {
    return errorFallback ?? <div role="alert">二次校验状态加载失败</div>;
  }
  if (status === 'challenge_required') {
    return <AuthRedirect key="challenge" href={challengePath} />;
  }
  if (status === 'not_enrolled') {
    return <AuthRedirect key="enrollment" href={enrollmentPath} />;
  }
  return children;
}

interface RoleGateProps {
  status: RoleGateStatus;
  children: ReactNode;
  deniedPath?: string;
  loadingFallback?: ReactNode;
  errorFallback?: ReactNode;
}

export function RoleGate({
  status,
  children,
  deniedPath = '/',
  loadingFallback = null,
  errorFallback,
}: RoleGateProps) {
  if (status === 'loading') return loadingFallback;
  // 网络、限流或查询失败代表权限未知，不能按无权限跳走。
  if (status === 'error') {
    return (
      errorFallback ?? <div role="alert">权限状态加载失败，请刷新重试</div>
    );
  }
  if (status === 'denied') return <AuthRedirect href={deniedPath} />;
  return children;
}
