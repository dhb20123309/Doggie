# 当前流程：密码登录

仅在本轮需要实现或修改登录页时读取。沿用已选 SOP 与模板公共动作，不迁移认证模式。普通密码公共类型见 [密码接口](password-api.md)；本页只在需要具体表单示例时加载。路由边界见 [路由关系](auth-route-plan.md)，恢复/MFA 不提前加载。

## 普通密码登录的完整链路

前提是项目**已确认使用 basic_auth**，本例不替代认证模式选择。邮箱／短信项目保留已确认模式，同步适配字段、校验、动作参数与反馈，不能根据输入内容动态切换模式。

接线顺序为：表单原始输入 → 唯一动作对象 → 平台 Client → AuthProvider 共享状态 → AuthEntryGate 导航。本节以需登录的账号页为目标，由 AuthGate 保护；返回混合访问页时不额外套守卫。以下 Web 页面使用模板已有的 TanStack Router；Expo 沿用这条状态链路，改用 RN 表单和 Expo Router，具体见 [Expo 适配](expo-auth.md)。

在已有认证模块中复用动作对象；尚无定义时，例如在 `src/auth/actions.ts` 创建：

```ts
import { createAuthActions } from '@/features/supabase-auth-runtime';

export const authActions = createAuthActions('basic_auth');
```

登录页示例 `src/pages/LoginPage.tsx`：接收原始用户名和密码，展示错误，阻止重复提交。普通登录固定 `mode="login"`，认证状态负责导航，finally 只恢复按钮。注册、恢复使用各自独立页面，不把该登录页扩展成模式切换容器。

```tsx
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useSearch } from '@tanstack/react-router';
import {
  AuthEntryGate, useAuthSubmit, resolveSafeReturnTo, useAuth,
} from '@/features/supabase-auth-runtime';
import { authActions } from '@/auth/actions';

export function LoginPage() {
  const { status } = useAuth();
  const { returnTo } = useSearch({ from: '/login' });
  const safeReturnTo = resolveSafeReturnTo(returnTo);
  return <AuthEntryGate status={status} mode="login" authenticatedPath={safeReturnTo}
    loadingFallback={<p role="status">正在恢复登录状态…</p>}>
    <LoginForm />
  </AuthEntryGate>;
}

function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { busy, feedback, execute } = useAuthSubmit();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await execute('signIn', () => authActions.signIn({ username, password }));
  }

  return <form onSubmit={onSubmit} aria-busy={busy}>
    <label>用户名<input type="text" autoComplete="username" required
      value={username} onChange={event => setUsername(event.target.value)} /></label>
    <label>密码<input type="password" autoComplete="current-password" required
      value={password} onChange={event => setPassword(event.target.value)} /></label>
    {feedback && <p role="alert">{feedback.message}</p>}
    <button type="submit" disabled={busy}>{busy ? '登录中…' : '登录'}</button>
  </form>;
}
```

目标页示例 `src/pages/AccountPage.tsx`：保留原地址的查询串和 hash，未登录返回登录页；认证状态失败显示错误，不当匿名处理。

```tsx
import { AuthGate, useAuth } from '@/features/supabase-auth-runtime';

export function AccountPage() {
  const { status, username } = useAuth();
  return <AuthGate status={status}
    loadingFallback={<p role="status">正在恢复登录状态…</p>}>
    <main>当前用户：{username ?? '已登录用户'}</main>
  </AuthGate>;
}
```

在项目**现有**路由中将 `/login` 接到 LoginPage，将业务地址（例如 `/account`）接到 AccountPage，并确认安全回退地址 `/` 是实际存在的页面。根部的现有 RouterProvider 外只保留一份 AuthProvider；已有等价共享状态则局部适配，不新增 Provider。路由注册方式沿用项目文件路由或配置路由，不复制另一套 Router。`username` 仅用于展示，不能据此授权。

该最小链路不依赖业务资料加载。确实需要 profile／角色初始化时，在 AuthGate 内挂载独立业务初始化组件，由其 effect 按当前 user.id 查询；loading、成功、失败分别展示，失败提供重试，完成前不渲染依赖它的内容。切换账号清空旧结果并隔离旧请求；不要先调用业务查询 Hook，再指望包住 JSX 的 Gate 阻止请求。角色来自可信的服务端权限来源，不能从可编辑的 user_metadata 推断。业务 API 接线沿用 `supabase-data-access`，不在登录表单重复初始化。

验收访问 `/account?tab=profile#details` → 登录 → 自动返回同一地址，再刷新确认身份恢复；用实际存在的业务地址替换本例。失败时应看到反馈且按钮恢复，快速重复提交只发起一次认证请求。普通用户名 `1111`、`alice` 应进入认证请求，页面不要求邮箱格式；能提交不等于账号存在。
