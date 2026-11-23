# 当前流程：普通退出

复用既有动作与 AuthProvider；本页只补退出交互，不新建认证状态。复杂恢复退出见 [完整接线示例](auth-entry-example.md)。

## 普通业务页退出登录

退出按钮只负责确认交互、调用既有 `authActions.signOut()` 和显示反馈；`AuthProvider` 同步匿名状态后，受保护页由 AuthGate 跳转，混合访问页默认留在原页展示游客内容并清空私有数据。以下示例的成功分支和 finally 不调用 navigate、router.replace 或刷新页面；不手工清理 Token、伪造 anonymous，也不把 busy 作为 Gate 的导航条件。若产品明确要求公开页退出后跳转，只保留一个导航负责人，不与守卫重复。是否需要确认弹窗按产品需求决定，确认后调用同一个退出处理函数。

```tsx
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { authActions } from '@/auth/actions';

export function SignOutButton() {
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  async function signOut() {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      const { error } = await authActions.signOut();
      if (error) toast.error('退出失败，请重试');
      else toast.success('已退出登录');
    } catch {
      toast.error('退出失败，请重试');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return <button type="button" disabled={busy} onClick={signOut}>
    {busy ? '正在退出…' : '退出登录'}
  </button>;
}
```

Toast 容器挂在不会随受保护子树卸载的根布局；失败处理同时覆盖返回的 error 和抛错。这里仅用于普通业务页退出；密码恢复继续由恢复 Hook 完成退出后交给页面的完成步骤导航。

Web 默认 `<AuthGate status={status}>` 会在进入匿名分支时捕获业务地址，保留 query/hash 并生成安全的 returnTo，无需业务页订阅全局 location。自定义登录入口时可传完整的 `loginPath`，runtime 同样固定本次目标；不要给 Gate/内部跳转组件绑定随 location 变化的 key，避免不断重新挂载。注册和恢复仍按独立完成步骤导航。
