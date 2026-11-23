# 认证业务接线示例

本文展示页面如何组合动作、共享状态和守卫，覆盖完整登录、注册收尾及恢复导航。接口参数、返回值和默认行为统一查 [模板接口速查](../runtime-api.md)；项目接入前提见 [工程接入](../integration.md)。已有等价实现只做必要适配。

示例文件落点与路由应适配现有项目，不要求新建同名目录或替换既有 Auth Context/store。验证使用项目实际页面及祖先布局。

## 按页面访问语义选择守卫

先确认页面和操作是否需要身份，再选择守卫；`/app` 只是业务路径，不代表全部内容需要登录。AuthProvider 提供共享身份状态，本身不限制页面访问。

| 页面用途 | 接线方式 | 身份变化后的表现 |
| --- | --- | --- |
| 公开内容，或游客可浏览、登录后增加能力的混合访问页 | 页面及共享布局不套 AuthGate；需要个性化内容时读取 useAuth | 登录、退出均可留在该页，按状态更新内容，不因 Session 变化强制导航 |
| 只有登录后才能访问的页面 | 在该页放 AuthGate；仅当某布局全部子页都需登录时，才在布局统一放置 | 匿名时返回登录，保留原地址；loading/error 分别处理 |
| 登录、注册、找回密码入口 | 使用对应 mode 的 AuthEntryGate | 按下文导航职责推进，注册／恢复不因 Session 先到而离开 |

混合访问页只对需要身份的操作（如收藏、提交）在触发时引导登录，保留安全的 returnTo；浏览公开内容不触发登录跳转。不要把会自动导航的 AuthGate 直接包在可选侧栏或按钮外，否则仍会把整页带走。私有内容组件仅在 authenticated 时挂载并查询；公开内容在身份 loading/error 时继续可用，依赖身份的区域单独显示等待或错误，不把未知状态当成游客执行操作。退出或切换账号时清空旧用户私有数据并隔离旧请求；实际读写权限仍由 API/RLS 校验。

## Web 认证路由的最小接入顺序

适用于新建 Web 认证入口或调整认证布局；已有结构的局部修复只核对受影响链路。文件名与 URL 的对应关系、无路径布局、index 冲突及生成路由树的规则统一见 [react-design 的路由章节](../../../react-design/SKILL.md#路由)，此处负责认证页面与业务页面如何组合。Expo 沿用 [Expo 适配](../expo-auth.md)，不套用 Web 文件路由结构。

1. **先确定路由关系。** 在当前任务中列出所需页面的「文件路径 → 实际 URL → 父布局 → 登录要求 → 导航负责人」，同时确定根路径用途和登录后的默认目标。已有路由及公开首页按需求保留，不为认证接入统一改成某个路径前缀；不要求新增规划文件。
2. **接通最小链路再扩展。** 先接入唯一 AuthProvider、登录入口和一个符合需求的最小业务页面，仅在需要登录的边界接入 AuthGate；本轮涉及注册／恢复时，同时确定其独立入口及祖先布局。运行项目已有的 `pnpm run build`，核对生成路由树的实际 URL 与父子关系，通过后再批量填充其余业务页面。跳转职责按下节落实，不能在表单、页面和祖先布局重复处理同一次跳转。
3. **验证项目实际入口。** 按工程规范启动最新预览，确认登录表单可见；需求包含混合访问页时，验证游客可浏览且只有受限操作引导登录；包含受保护页时，验证匿名访问返回登录。有可用测试身份时验证登录后返回原业务地址、目标页面实际出现及刷新恢复；缺少身份或验证码时记录未验证项，继续可完成的工作，不重搭路由或伪造登录态。注册／恢复的 Session 先到场景按文末验收表检查，构建通过不代表流程已验证。
4. **保留已验证结构。** 记录已核对的路由关系、验证结果及下一步。仅需求变化或具体错误证据支持调整；修改前定位冲突 URL、父布局或跳转调用方，优先修路由声明、文件名与导航引用，复用业务页面正文。不因尚未验证或缺少登录态就删除重建整组页面，不把「换个思路」当作迁移路由的依据。

下表示意公开首页、混合访问业务区与受保护账号页共存；路径与文件名按产品需求替换，只生成已确认功能需要的入口。根路径可以直接展示首页，不要求跳到 `/app`。

| 示例文件 | 实际 URL | 父布局与访问控制 | 导航负责人 |
| --- | --- | --- | --- |
| `routes/__root.tsx` | 根布局，无独立页面 | 挂唯一 AuthProvider 与 Outlet，不统一要求登录 | 不按 Session 跳转 |
| `routes/index.tsx` | `/` | 根布局，游客与登录用户均可访问 | 展示首页，不按 Session 跳转 |
| `routes/login.tsx` | `/login` | 根布局，`AuthEntryGate(mode="login")` | Gate 返回安全的 returnTo，默认 `/app` |
| `routes/register.tsx` | `/register` | 根布局，`AuthEntryGate(mode="register")` | 注册成功步骤 |
| `routes/reset-password.tsx` | `/reset-password` | 根布局，`AuthEntryGate(mode="recovery")` | 恢复流程退出成功后的 onExit |
| `routes/app.tsx` | `/app` 布局 | 根布局，仅放共享业务外壳与 Outlet，不统一套 AuthGate | 不按 Session 跳转 |
| `routes/app.index.tsx` | `/app/` | app 布局，游客可浏览，登录后按需增强 | 仅在触发需要身份的操作时引导登录 |
| `routes/app.account.tsx` | `/app/account` | app 布局，本页 AuthGate 内挂载私有账号内容 | 匿名时由本页 AuthGate 返回登录 |

只有需求明确 `/app` 下所有页面均需登录时，才将 AuthGate 提升到 `app.tsx`，子页面不再重复守卫。认证入口不挂在要求登录的业务布局下。普通退出行为按页面访问要求处理，见下文。

## 先确定谁负责导航

**`AuthEntryGate.mode` 表示当前正在进行的业务流程，不是路由文件名。** 页面在 `/login` 内展示找回密码，也必须从进入找回时使用 recovery 模式。当前模板不会根据子组件或恢复 Hook 自动纠正外层 mode，不能只接入 RecoveryFlow 就认为跳转已受保护。

| 当前流程 | 入口 Gate 的 mode | 收到有效 Session 后 |
| --- | --- | --- |
| 普通登录 | `login` | 自动进入安全的 returnTo |
| 注册及确认／资料收尾 | `register` | 保留当前步骤，业务成功后才导航 |
| 找回密码：发码到改密／退出完成 | `recovery` | 保留当前步骤，退出恢复会话成功后才返回登录 |

短信 `verifyOtp(type: 'sms')` 成功可先触发 `SIGNED_IN`，邮箱恢复可先触发 `PASSWORD_RECOVERY`；此时 Provider 已有 Session，但验证码请求或后续 `getUser()` 可能尚未返回。若外层仍为 login，Gate 会先跳走并卸载表单，后续新密码步骤无法展示。不能等验证成功才切 mode，也不能提前调用 `enterPasswordRecovery()` 代替入口模式切换：保留页面不等于获得改密资格。

## 默认使用独立认证路由

新项目按需使用 `/login`、`/register`、`/reset-password` 三个独立路由，每页固定 Gate 的 mode，不创建共享 mode state 或 `/auth?mode=...` 切页。只生成已确认功能需要的页面；当前验证码 SOP 不需要回调页，只有认证方式确实依赖回调时才创建 `/auth/callback`。存量组合入口只保留必要兼容：从进入注册／恢复时即保留流程，祖先不得按 Session 提前跳转；不要为局部修复强制迁移路由。本 Skill 不提供组合页示例。

下面是 Web 页面接线，分别接入项目现有路由树；不创建第二个 Router 或 Provider。LoginForm、RegisterFlow、RecoveryFlow 为项目业务表单，沿用已确认的认证模式。`/app` 替换为项目实际存在的业务页。

```tsx
import { useSearch, useNavigate } from '@tanstack/react-router';
import { AuthEntryGate, useAuth, resolveSafeReturnTo } from '@/features/supabase-auth-runtime';
import { LoginForm } from '@/components/auth/LoginForm';
import { RegisterFlow } from '@/components/auth/RegisterFlow';
import { RecoveryFlow } from '@/components/auth/RecoveryFlow';

function useEntryContext(rawReturnTo: unknown) {
  const { status } = useAuth();
  const navigate = useNavigate();
  const returnTo = resolveSafeReturnTo(
    typeof rawReturnTo === 'string' ? rawReturnTo : undefined, '/app',
  );
  const goTo = (to: '/login' | '/register' | '/reset-password') =>
    navigate({ to, search: { returnTo }, replace: true });
  return { status, returnTo, goTo };
}

// /login：这里只挂登录表单；忘记密码通过 onForgot 进入独立恢复路由。
export function LoginPage() {
  const search = useSearch({ from: '/login' });
  const { status, returnTo, goTo } = useEntryContext(search.returnTo);
  return <AuthEntryGate status={status} mode="login" authenticatedPath={returnTo}>
    <LoginForm onRegister={() => goTo('/register')}
      onForgot={() => goTo('/reset-password')} />
  </AuthEntryGate>;
}

// /register
export function RegisterPage() {
  const search = useSearch({ from: '/register' });
  const { status, returnTo, goTo } = useEntryContext(search.returnTo);
  return <AuthEntryGate status={status} mode="register" authenticatedPath={returnTo}>
    <RegisterFlow returnTo={returnTo} onExit={() => goTo('/login')} />
  </AuthEntryGate>;
}

// /reset-password：首次渲染即保留恢复流程，祖先布局也不能按 Session 跳走。
export function ResetPasswordPage() {
  const search = useSearch({ from: '/reset-password' });
  const { status, returnTo, goTo } = useEntryContext(search.returnTo);
  return <AuthEntryGate status={status} mode="recovery" authenticatedPath={returnTo}>
    <RecoveryFlow onExit={() => goTo('/login')} />
  </AuthEntryGate>;
}
```

文件路由分别导出对应页面；配置路由分别注册对应路径。`useSearch.from` 使用对应路由的实际 ID（有无路径的路由组时尤其注意），文件路由也可用该页的 `Route.useSearch()`。读取本页匹配的 search，避免跳转期间旧页面读取新页面的全局 location，丢失 returnTo 后触发二次导航。按当前路由库保留并校验 returnTo，TanStack 文件路由的 `validateSearch` 至少保留字符串 returnTo；切换页面不能丢失原业务地址的 query/hash。自定义认证路径同步加入 `auth-navigation.ts` 的入口集合，集合不代表必须创建这些页面。

根部只挂一次稳定的 AuthProvider 和 Outlet；祖先不能套固定 login 的 Gate、按路径重挂 Provider，或添加“有 Session 就跳首页”的 effect。注册、恢复页即使已有 Session 也保留当前步骤，loading/error 不得在 Gate 外提前 return 而卸载流程。`onExit` 只在子流程确认取消／退出完成后调用，不能用直接返回登录的链接绕过收尾。

刷新恢复页面后从发码开始，不能从 URL 或普通登录态恢复改密资格。独立页面内部仍使用 step 管理注册确认、资料收尾或密码恢复；拆分路由不替代这些步骤。Expo 同样使用独立 screen 和固定 mode，导航采用 Expo Router，不复制 Web DOM 示例。

### 存量内嵌恢复入口的适配

仅在项目已有内嵌入口或用户明确要求时沿用，不据此把新项目改成组合页。如果已有 `recovering` 控制 LoginForm／RecoveryFlow 的切换，外层同一个 Gate 必须同步使用 `mode={recovering ? 'recovery' : 'login'}`；点击忘记密码就切换，直到 RecoveryFlow 确认取消／退出完成后才由 `onExit` 切回。不要另设一份需要手动同步的 mode 或通用跳转锁。

检查实际 JSX：固定 `mode="login"` 的 Gate 内出现 `recovering ? <RecoveryFlow ... /> : <LoginForm ... />` 就是错误接线。也要向上检查布局、路由 beforeLoad 和导航 effect；在子组件里再加 recovery 模式的 AuthEntryGate，无法阻止外层 login Gate 把整个页面卸载。

## 普通密码登录的完整链路

前提是项目**已确认使用 basic_auth**，本例不替代认证模式选择。邮箱／短信项目保留已确认模式，同步适配字段、校验、动作参数与反馈，不能根据输入内容动态切换模式。

接线顺序为：表单原始输入 → 唯一动作对象 → 平台 Client → AuthProvider 共享状态 → AuthEntryGate 导航。本节以需登录的账号页为目标，由 AuthGate 保护；返回混合访问页时不额外套守卫。以下 Web 页面使用模板已有的 TanStack Router；Expo 沿用这条状态链路，改用 RN 表单和 Expo Router，具体见 [Expo 适配](../expo-auth.md)。

在已有认证模块中复用动作对象；尚无定义时，例如在 `src/auth/actions.ts` 创建：

```ts
import { createAuthActions } from '@/features/supabase-auth-runtime';

export const authActions = createAuthActions('basic_auth');
```

登录页示例 `src/pages/LoginPage.tsx`：接收原始用户名和密码，展示错误，阻止重复提交。普通登录固定 `mode="login"`，认证状态负责导航，finally 只恢复按钮。注册、恢复使用各自独立页面，不把该登录页扩展成模式切换容器。

```tsx
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearch } from '@tanstack/react-router';
import {
  AuthEntryGate, resolveAuthFeedback, resolveSafeReturnTo, useAuth,
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
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const submitting = useRef(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (!username.trim() || !password) {
      setFeedback('请输入用户名和密码');
      return;
    }
    submitting.current = true;
    setBusy(true);
    setFeedback('');
    try {
      const { error } = await authActions.signIn({ username, password });
      if (error) throw error;
      // AuthProvider 接收认证事件后，由外层 Gate 导航。
    } catch (error) {
      setFeedback(resolveAuthFeedback(error, { operation: 'signIn' }).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <form onSubmit={onSubmit} aria-busy={busy}>
    <label>用户名<input type="text" autoComplete="username" required
      value={username} onChange={event => setUsername(event.target.value)} /></label>
    <label>密码<input type="password" autoComplete="current-password" required
      value={password} onChange={event => setPassword(event.target.value)} /></label>
    {feedback && <p role="alert">{feedback}</p>}
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

## 注册按步骤完成导航

RegisterFlow 自己持有 `form → verify（仅需确认时）→ finalize（仅需业务收尾时）→ success` 步骤。basic_auth 注册不增加验证码步骤；注册动作成功返回有效 Session 后按需要核对身份、完成写入，再进入 success。邮箱／短信注册确认沿用 [共同流程](../verification-flow.md)，不能用有 Session 代替验证码和身份检查。

成功分支显式推进 `step='success'`，失败保留当前步骤及错误。finally 仅结束按钮 loading。Web 成功步骤使用 TanStack Router 的声明式 Navigate；动态完整路径按项目路由类型适配：

```tsx
// RegisterFlow 内；Navigate 为 RouterNavigate<AnyRouter, string, string>。
if (step === 'success') {
  return (
    <AuthGate status={status} loginPath={buildLoginPath(returnTo)}>
      <Navigate href={resolveSafeReturnTo(returnTo)} replace />
    </AuthGate>
  );
}
```

完成后 Session 失效由 AuthGate 引导重新登录，不能退回已消费的验证码步骤。身份已确认但业务写入失败时留在 finalize，仅重试写入；注册步骤和祖先均不使用固定为 login 的 AuthEntryGate。已登录直接进入注册页时展示当前身份和继续／返回入口，不自动创建或切换账号。

## RecoveryFlow 的模板接线

```text
发码 → 验证码输入 → 身份核对 → 新密码表单 → 保存 → 退出恢复会话 → 返回登录
```

恢复统一使用 [恢复流程 Hook 与表单示例](../recovery-flow-example.md)，本页只负责入口和导航。`AuthEntryGate(mode="recovery")` 保留整个页面；Hook 核对恢复身份并推进步骤；业务表单按 `flow.step` 展示、绑定 Hook 动作，退出／取消成功后才调用 `onExit` 返回登录。页面不直接编排验证、恢复标记、改密或 SDK 退出，也不另设恢复资格守卫。

邮箱与短信分别沿用对应 SOP 的动作和固定身份，不混用 OTP 类型。Expo 复用同一 Hook，表单和路由采用 RN / Expo Router。

## 用项目实际页面验证导航

验证对象必须是项目生成或修改后的入口页面、真实路由和祖先布局。模板 Hook／示例测试通过，只能证明模板正确，不能证明项目没有把恢复流程接到 login Gate 下。

| 操作与时序 | 必须看到的结果 |
| --- | --- |
| 登录 → 受保护页 → 点击退出（含确认） | 退出动作完成、登录表单实际出现；没有重复导航或 Maximum update depth exceeded，退出后刷新不恢复旧身份 |
| 混合访问页：游客浏览 → 受限操作引导登录 → 返回原页 → 退出 | 游客能浏览公开内容，登录后增强能力可用；退出默认留在原页，私有数据清空，刷新仍可访问且不恢复旧身份 |
| 跳转 pending 期间父层重渲染／StrictMode effect 重放 | 同一次 Gate 跳转只发起一次；原业务地址的 query/hash 保留，不能变成登录页或 `/` |
| 导航抛错后点击重试 | 显示可见错误，重试仍使用原目标，不自动重复请求 |
| 从登录页点击忘记密码 | 进入独立恢复路由；存量内嵌入口则同一份状态同时切换表单和 Gate 模式 |
| 验证码提交先触发认证事件，验证请求／身份核对延迟返回 | 不跳业务页，恢复表单不卸载；身份核对成功后出现新密码及确认输入框 |
| 验证失败，或验证码已成功但身份核对失败 | 保留对应步骤、显示错误并可重试；后者只重试身份核对，不重复消费验证码 |
| 改密成功但退出恢复会话失败 | 保留保存结果和退出重试入口，不重复改密、不提前返回登录 |
| 退出恢复会话成功，再执行普通登录 | 返回登录；普通登录成功后仍自动进入安全的 returnTo，不残留恢复模式 |

登录只由 Gate 跳转；注册只在成功步骤导航；恢复只在退出当前恢复会话成功后回到登录。不要在 render 中调用 navigate/router.replace，也不添加重复的认证跳转 effect。注册另外验证 Session 先到仍保留未完成步骤、业务收尾成功后才导航。取消／旧响应与收尾失败按共同流程处理。

测试环境可以模拟认证事件和请求延迟，但必须保留实际页面与导航逻辑；不能把模拟认证写入交付代码。记录验证的项目文件及可见结果，构建通过或表单存在不算完成。缺少真实验证码时仍完成接线检查及可执行的模拟交互，将真实短信／邮件送达、改密及新密码登录标记为未验证。

## 工作单元收尾

修改认证行为前，确定这条链路涉及哪些文件；完成时检查以下交接点。只核对本轮受影响的流程，不为登录修复额外实现注册、恢复或 MFA。

| 交接点 | 需要一致的契约 |
| --- | --- |
| 模式 → 表单 → 动作 | SOP、标识字段、校验、动作参数和反馈 operation 一致；不存在旧字段调用方 |
| 动作 → 共享状态 | 检查结构化 error；身份由既有 Auth 状态源同步，页面不手工标记登录成功 |
| 共享状态 → 页面／祖先路由 | loading/error 不冒充 anonymous；登录自动导航，注册／恢复未完成步骤不被祖先跳转截断 |
| 必要业务收尾 → 成功步骤 | 写入或初始化失败保留当前步骤；重试仅处理失败环节，不重新消费验证码或重复改密 |
| 导航 → 目标页 | returnTo 经安全校验；目标路由存在，无循环，查询串/hash 保留；业务权限仍由 API/RLS 执行 |

搜索旧参数、状态字段和导航调用的残留后，执行受影响模块的类型检查与相应交互验证。外部身份或验证码缺失时完成其余检查，明确标记真实端到端未验证；不能用模拟事件或模板注入代替。中断交接统一按主 Skill 记录。
