# Web 登录后的角色查询与页面准入

用于用户明确要求管理员、多角色或权限控制的 Web 页面。普通登录直接使用 LoginEntry 和 ProtectedLayout。

本例沿用项目已有的 QueryClientProvider、AuthProvider 和 Supabase Client。查询键包含用户 ID，同一项目中的页面复用该 QueryClient。示例假设已有 public.user_roles(user_id, role)，当前用户能通过 RLS 读取自己的角色。存量项目将查询适配到真实表或 RPC。

## 业务父布局

将以下组件放入 src/components/AdminLayout.tsx。在管理员父路由中使用 `<AdminLayout><Outlet /></AdminLayout>`，登录页位于 ProtectedLayout 外。创建实际可访问的 /app/access-denied 页面，该页面可使用 ProtectedLayout，必须放在管理员角色布局之外。

```tsx
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ProtectedLayout, useAuth } from '@/features/supabase-auth-runtime';
import { RoleGate, type RoleGateStatus } from '@/features/supabase-auth-runtime/optional/auth-guards';
import { supabase } from '@/supabase/client';

function AdminAccess({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const roles = useQuery({
    queryKey: ['auth-role-access', userId],
    enabled: Boolean(userId),
    queryFn: async ({ signal }) => {
      if (!userId) throw new Error('缺少当前用户');
      const { data, error } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', userId)
        .abortSignal(signal);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('角色查询返回异常');
      return data.map(row => row.role);
    },
    // 挂载时重新确认权限，离开布局后清理闲置缓存。
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  let status: RoleGateStatus = 'loading';
  if (userId && !roles.isPending && !roles.isFetching) {
    if (roles.isError) status = 'error';
    else status = roles.data?.includes('admin') ? 'granted' : 'denied';
  }

  return (
    <RoleGate
      status={status}
      deniedPath="/app/access-denied"
      loadingFallback={<p role="status">正在确认访问权限…</p>}
      errorFallback={
        <div role="alert">
          <p>权限查询失败，请稍后重试。</p>
          <button type="button" onClick={() => { void roles.refetch(); }}>
            重试权限查询
          </button>
        </div>
      }
    >
      {children}
    </RoleGate>
  );
}

export function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <ProtectedLayout>
      <AdminAccess>{children}</AdminAccess>
    </ProtectedLayout>
  );
}
```

## 状态与更新

- 身份恢复由外层 ProtectedLayout 处理。角色尚未查完时保持 loading，已有缓存正在重新验证时同样等待。
- 查询失败进入 error，保留页面并允许手动重试。禁止 catch 后返回空数组，否则网络失败会被解释为拒绝访问。
- 成功返回空角色列表才可判断 denied。需要确认 RLS 允许本人读取角色，否则策略过滤也会得到空列表。
- 切换账号时 queryKey 立即变化，旧请求使用自己的用户 ID 和缓存键。abortSignal 用于取消不再使用的请求，旧结果无法成为新用户的权限结果。禁止使用 placeholderData 或 keepPreviousData 继承上一账号的角色。
- 在共同父布局中查询一次，子页面共享结果。退出后外层卸载 AdminAccess，gcTime=0 清理无观察者的缓存。其他角色消费者也应按身份状态卸载。
- 本人角色变更成功后，调用 queryClient.invalidateQueries({ queryKey: ['auth-role-access', userId] }) 重新确认。远程权限变更的通知或刷新按项目需求接入。多个租户或认证实例共用 QueryClient 时，查询键还必须包含对应租户或实例 ID。
- 查询失败后由用户手动重试。本例关闭自动重试以避免限流时连续请求；确需自动重试时按共享数据基线设置有上限的退避。
- RoleGate 控制页面展示，业务接口和 RLS 必须校验实际访问权限。

## 验证

延迟角色响应时不能提前拒绝访问；失败后能重试；成功返回非管理员时进入拒绝页；管理员进入目标页；A 账号请求未完成时切到 B，A 的迟到结果不能放行 B。对已有缓存的刷新失败也要显示错误，不能继续使用缓存中的管理员结论。
