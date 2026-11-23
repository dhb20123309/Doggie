# 按需注册流程：保留的取消与身份快照能力

# 密码注册/登录的业务接线

仅用于本轮明确需要取消/身份世代隔离的复杂注册收尾，或项目已经使用该流程。普通接入使用 password-flow.md 的 R12 路径，两种流程择一，不能同时维护。

## 登录与入口

根布局唯一 AuthProvider + Outlet；业务保护边界 AuthGate。登录 AuthEntryGate(mode="login") 由 Session 自动导航，表单仅用 useAuthSubmit.execute("signIn",()=>authActions.signIn(values))，不重复 navigate。注册从进入起固定 mode="register"，Session 提前到达不能跳过收尾。同页标签与外层 Gate.mode 必须由同一父组件控制。

createAuthActions(已选SOP) 只创建一次。basic_auth 原样传 username/password；真实邮箱或短信使用该模式字段，密码不 trim，不按账号形状换 SOP。

## 按需直接复用流程 Hook

```tsx
import { useRegistrationFlow, type RegistrationFinalizationScope } from '@/features/supabase-auth-runtime/useRegistrationFlow';
const registration = useRegistrationFlow('register-entry');
async function onSubmit(event: React.FormEvent) {
  event.preventDefault();
  if (registration.phase === 'finalization-failed') {
    await registration.retryFinalization(finalizeProfile);
    return;
  }
  const submitted = { ...values }; // 固定本次提交；不要把编辑输入当 scopeKey
  await registration.start(submitted.username, () => authActions.signUp(submitted), finalizeProfile);
}
```

ScopeKey 只用于注册入口/认证上下文世代替换；正在编辑的账号不能用作 scopeKey，否则会取消当前流程。Hook 返回 busy/feedback，按钮 type=submit、disabled=busy，反馈展示 feedback.message。

| phase | 业务展示/行为 |
| --- | --- |
| submitting/finalizing | 等待，不再发第二次注册 |
| signup-failed | 展示 SDK 失败；显式人工重试，不自动重放 |
| no-identity | 未返回用户，结果未确认；显示核验/登录入口，不声称账号已创建，不再次 signUp |
| confirmation-required | 显示 submittedLabel，保留真实 userId；没有匹配 Session 不写资料、不导航、不再次 signUp |
| finalization-failed | 仅 retryFinalization(finalizeProfile)，仍是原用户；不清空提交身份 |
| completed | 用项目 Router 到安全目标；目标处继续 AuthGate |

basic_auth 虚拟邮箱无 Session 表示实际 Auth 确认配置不兼容，应报告配置阻塞，不能伪造会话/验证码。真实邮箱/短信需要确认时才读 verification-flow.md 和相应模式参考；确认成功后把真实 SDK 的 data 交 completeConfirmation(data,finalizeProfile)，Hook 核对原身份与匹配 Session 后才收尾，不再次注册。Hook 不负责发验证码或验证 OTP。

## 业务收尾 callback

finalizeProfile({id}, flowScope) 返回 Promise<void>：先核对当前真实 SDK 身份仍为 id，再完成本轮必需的资料/角色/示例数据并核对写入回执；失败抛错。Hook 不内置业务表、字段、seed、导航或客户端。提交值需参与资料写入时也保存同一提交快照，重试不读取已修改的表单字段。从 useRegistrationFlow 子路径导入 RegistrationFinalizationScope 类型。每次异步预检或业务步骤结束后、开始下一笔新写入之前调用 flowScope.assertCurrent()；卸载/世代切换的判定复用固定Hook，不再写一套ref/generation。已发送请求可能成功，不能伪装撤回或自动重放。

```ts
async function finalizeProfile(
  { id }: { id: string },
  flowScope: RegistrationFinalizationScope,
): Promise<void> {
  const current = await supabase.auth.getUser();
  flowScope.assertCurrent(); // 异步身份预检后，发新写入前核对当前世代
  if (current.error || current.data.user?.id !== id) throw new Error('当前身份已变化');
  const r = await supabase.from('profiles').update(已确认的业务patch)
    .eq('id', id).select('id').single();
  if (r.error || !r.data || r.data.id !== id) throw new Error('资料保存未确认，请重试收尾');
}
```

表、patch、insert/update 与主键以实际 schema 和 RLS 为准；零行/null 不算完成。多个业务步骤保存已确认进度，失败只恢复未确认收尾，不重放已确认 seed。异步查询账号切换时清空旧数据并使用已有数据访问 gate；不从可编辑 user_metadata 判断可信角色。

代码验收只执行本次实际提交处理器及业务 callback：并发 signUp 一次、无身份/无 Session 不导航、资料失败后只重试资料、提交账号不随编辑变化、卸载/账号世代切换屏蔽晚到结果。固定 Hook 的完整状态回归由研发维护，不在每个项目重新造测试框架。真实注册/登录/刷新恢复/退出和 RLS 另用正常 SDK 与接口核对；构建不能代替它们。
