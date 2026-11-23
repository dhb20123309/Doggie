# Web用户名密码入口：复用表单与受保护路由

Web 普通用户名密码登录使用 LoginEntry，业务父路由使用 ProtectedLayout，注册复用 PasswordRegistrationForm。Web 模板自带输入框、提交按钮、间距和焦点样式。项目可用 className 定制外层布局，并在项目 CSS 中通过表单的 [data-meoo-password-form] 作用域调整控件。存量项目以实际组件为准，旧表单缺少样式时给现有表单补作用域 CSS。已有架构保留；Expo、邮箱/短信、复杂存量共页等交互按需使用对应参考。

## 最小业务接线

项目只创建一次createAuthActions(已选SOP)。basic_auth直接传{username,password}，密码不trim；注册无Session保留账号并报告配置不兼容，不能自动确认、改Auth或重复signUp。现成注册表单内部已复用useRegistrationFlow：Session先到不抢走资料收尾，资料失败只重试saveProfile，身份/卸载隔离由scope约束。登录由外层login Gate随身份导航，表单不重复navigate。

```tsx
// src/components/AccountEntries.tsx
import { useNavigate } from '@tanstack/react-router';
import { AuthEntryGate, LoginEntry, PasswordRegistrationForm, useAuth } from '@/features/supabase-auth-runtime';
import { authActions } from '@/lib/auth';
import { saveProfile } from '@/services/profile';

export function LoginPage() {
  return <LoginEntry signIn={authActions.signIn} authenticatedPath="/app" />;
}
export function RegisterEntry() {
  const { status } = useAuth();
  const navigate = useNavigate();
  return <AuthEntryGate status={status} mode="register">
    <PasswordRegistrationForm status={status} signUp={values => authActions.signUp(values)}
      saveProfile={saveProfile} onComplete={() => { void navigate({ to: '/app', replace: true }); }} />
  </AuthEntryGate>;
}
```

saveProfile(id,{name},scope)接实际项目schema：写入前scope.assertCurrent()；异步预检后及每个新写入前再次assertCurrent；检查SDK error、select返回非空和主键/身份归属，失败抛错。把name映射真实姓名字段，不能仅检查HTTP成功。不要把客户种子、CRUD等额外业务作为注册成功条件。其他必填业务字段确需新增时才使用原Hook写消费者，不删真实需求或验收。

## 文件名、URL、父布局一次确定

适用于默认TanStack文件路由插件的新Web项目；已有前缀时做等价映射，复用正文。点号代表层级，不能把app.profile写成app_profile，也不能用app_.profile绕过受保护父布局；_app是无路径布局，不是/app。以实际routeTree.gen.ts为准，不手写生成文件或用类型断言掩盖错路径。规则来源：https://tanstack.com/router/latest/docs/routing/file-naming-conventions

| 文件 | createFileRoute参数 | 实际URL | 父布局/职责 |
| --- | --- | --- | --- |
| __root.tsx | 原根路由 | 全局 | 保留原QueryClientProvider，内部唯一AuthProvider+Outlet，不全局跳登录 |
| index.tsx | / | / | 公开入口，禁止与_app.index另造同URL |
| login.tsx | /login | /login | 公开路由 LoginPage |
| register.tsx | /register | /register | RegisterEntry |
| app.tsx | /app | /app | ProtectedLayout+Outlet，所有受保护业务子路由共同父布局 |
| app.index.tsx | /app/ | /app/ | 本次客户概览 |
| app.profile.tsx | /app/profile | /app/profile | 基础资料；父路由必须是app.tsx |

```tsx
// src/routes/app.tsx
import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { ProtectedLayout } from '@/features/supabase-auth-runtime';
export const Route = createFileRoute('/app')({ component: ProtectedApp });
function ProtectedApp() {
  return <ProtectedLayout>
    <nav><Link to="/app">概览</Link><Link to="/app/profile">基础资料</Link></nav>
    <Outlet />
  </ProtectedLayout>;
}
```

先接根Provider、登录/注册、实际资料service和app受保护布局，立即运行类型检查与构建；路由插件生成树后再核对URL、parent及Link目标，修正后再增加当前要求的概览/基础资料。不从“客户会员中心”推导客户CRUD/详情/跟进等未要求功能；更多文件不等于完成度更高。客户概览和基础资料仍须真实数据、loading/error/空态、身份变更隔离和RLS。

## 验收与交付

同范围检验真实生成handler及其实际导入表单：Session先到仍停留收尾；资料失败可重试且不重复signUp；无Session保留账号；重复点击、卸载不产生额外写入；登录失败可重试且成功只导航一次。核对真实profile路由在受保护父布局内、所有Link目标存在、刷新/退出及RLS。构建、模板字节或SDK测试登录不等于真实注册全通过，确认环境缺口如实列出。

脚本直接装载真实actions/service/页面，不另造业务注册实现。SDK{data:{user,session},error}不同于REST，取实际schema；预期403/零行拒绝不算生成故障。已完成本轮验收就交付，不为了造通过反复测试或扩大范围。公共API已注入，不补读相同合同或遍历核心源码；具体编译/契约故障才读取对应源码。
