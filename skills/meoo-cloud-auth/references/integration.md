# 认证工程接入

先核对项目实现和 `<available-project-capability name="meoo-cloud-auth">` 回执。`ready` 表示可复用公共入口；`partial` 只补缺口；`existing` 表示已有等价实现，保留现有契约；`not_available` 不代表没有认证，先搜索再做最小适配。回执不证明页面已经接线。

## 入口和模块

Web/H5 与 Expo 的公共入口均为 `src/features/supabase-auth-runtime/index.ts`。基础能力从入口导入；密码恢复使用 `optional/usePasswordRecoveryFlow`，角色／MFA 守卫使用 `optional/auth-guards` 子路径。Web Gate 使用 TanStack Router，Expo Gate 使用 Expo Router。参数与返回值见 [模板接口速查](runtime-api.md)。

项目入口只创建一份已确认模式的动作对象，例如 `createAuthActions('auth_email_password')`，不按输入字段动态切换：

| 模式 | Auth 身份 | 恢复能力 |
| --- | --- | --- |
| `basic_auth` | `username` 为合法邮箱时直接使用；不含 `@` 时使用 `${username}@meoo.local`；含 `@` 但非法时拒绝 | 无原生密码恢复 |
| `auth_email_password` | 同一个真实邮箱 | 邮箱 Recovery 验证码 |
| `auth_sms_password` | 同一个真实手机号 | 仅既有手机号 OTP 恢复 |

页面将原始账号传给共享动作，不自行拼接虚拟邮箱；标识范围、校验及存量兼容见 `skills/meoo-cloud/references/basic_auth.md`。

确认／恢复动作的实现位于 `optional/auth-verification.ts`，仍通过同一 `createAuthActions()` 返回对象调用，不额外创建动作对象。

动作不写 profile、不创建 Client、不生成页面；必要业务写入由调用方在核对身份后完成。存量项目复用 Auth Context/store，不因模板增加第二套状态源；超出授权的架构迁移按主 Skill 处理。

## 页面输入契约

注册和密码登录的第一认证标识由已确认的 `authImplementationSop` 决定；先选择模式，再生成页面，不能根据 UI 已写出的字段反推模式。

| 模式 | 第一认证输入及密码 | 标签／占位符 | 输入与校验 |
| --- | --- | --- | --- |
| `basic_auth` | `username` + `password` | “用户名”／“请输入用户名” | Web `type="text"`、`autoComplete="username"`；Expo 普通文本键盘；按用户名规则校验，不要求邮箱或 11 位手机号 |
| `auth_email_password` | `email` + `password` | “邮箱”／“请输入邮箱地址” | Web `type="email"`；Expo 邮箱键盘；按邮箱规则校验，不能接受普通用户名或手机号作为该模式的登录标识 |
| `auth_sms_password` | `phone` + `password` | “手机号”／“请输入手机号” | Web `type="tel"`；Expo 电话键盘；按短信 SOP 的手机号范围及归一化规则校验 |

- `basic_auth` 只生成一个用户名输入，不生成“邮箱”“手机号”“手机号 / 邮箱”登录字段、切换 Tab 或对应占位符；不能调用只允许手机号／邮箱的 `isValidAccount` 挡住合法用户名，例如 `1111`、`alice`。
- 共享 `basic_auth` 动作兼容邮箱形状或纯数字的用户名，仅用于解析实际输入与兼容已有账号；不据此把 UI 改成邮箱／手机登录。保留合法邮箱直传、其他用户名映射虚拟邮箱的底层规则，不增加禁止用户名包含 `@` 的页面校验。
- 邮箱／短信模式的注册页按需收集昵称、真实姓名等业务资料；这些不是额外的登录凭据，登录页不得强制填写。确认密码也不是第一认证标识；验证码输入仅在对应 SOP 要求的确认／恢复步骤出现。
- 提交校验和可见反馈使用相同的输入语义，不能让用户名页面提示“请输入正确的手机号或邮箱”。非法邮箱形状的用户名可按共享反馈提示邮箱格式问题，空值的页面提示使用当前字段标签（basic 为“请输入用户名”）。
- 需求明确要求邮箱或手机号登录入口时，先核对对应认证模式及能力范围，不能在 `basic_auth` 下仅改标签和校验来伪装支持；未确认的验证码或恢复能力不得顺带启用。
- 验收同时检查登录页和注册页的标签、占位符、输入类型、提交校验、动作参数与错误提示。`basic_auth` 的 `1111`、`alice` 应通过账号格式校验并进入认证请求；这不代表账号存在或密码正确。其他模式的非法标识应在提交前拒绝。

## 状态契约

| 状态 | 唯一职责 | 不代表什么 |
| --- | --- | --- |
| status | 共享身份是否已认证 | 注册或改密流程已完成 |
| mode | 当前登录／注册／恢复入口；默认由独立页面固定 | 改密资格 |
| step | 本次业务流程及失败重试位置 | 服务端身份或权限 |
| authFlow | 恢复 UI 标记 | Session 或身份验证的替代品 |

接线前定位表单、页面和全部祖先路由的导航负责人。登录仅由 AuthEntryGate 导航；注册仅在必要业务收尾成功后导航；恢复仅在退出成功后返回登录。同一用户的 `SIGNED_IN` 保留当前 flow，切换用户时清除；保留 flow 不能修复外层提前跳转。先核对“事件 → 请求返回 → 状态变化 → 导航”的顺序；没有 Provider 证据时不改其事件语义。


- 多页面场景在根部只挂载一次 `AuthProvider`，各组件调用 `useAuth()`；已有全局状态则直接复用。身份区分 `loading / authenticated / anonymous / error`，权限区分 `loading / granted / denied / error`，允许现有等价命名。查询错误是结论未知，不能当匿名或拒绝。
- 初始身份由 `getSession()` 与 `getUser()` 核对，完成前保留 loading，失败显示 error；`INITIAL_SESSION` 不提前发布 authenticated 或覆盖核对结果。其他认证事件只同步 Session 和事件意图，并使旧初始化结果失效；不在 `onAuthStateChange` 内 await 请求。角色、profile、MFA 和业务数据查询放在认证状态更新后的 effect，登出清理派生状态和角色缓存。
- 恢复 Hook 在验证码及 `getUser()` 身份核对成功后调用 `enterPasswordRecovery()`，保存前再次检查身份与恢复状态；页面只按 `flow.step` 展示步骤并调用 Hook 动作。`authFlow='password_recovery'` 不授予权限，页面不据此另写恢复资格判断。标记只随同一用户的会话刷新保留，切换用户、Session 消失或 `USER_UPDATED / SIGNED_OUT` 时清除；无已认证 Session 时不能设置标记，保存与退出顺序见 [共同流程](verification-flow.md)。
- 跳转使用 `resolveSafeReturnTo()` 或已有等价安全函数处理站内 pathname、search、hash，拒绝外部 URL、`//host`、反斜杠和认证入口；Web 默认及自写守卫均遵守下述导航契约，自定义完整目标才传 `AuthGate.loginPath`。受保护页退出由 AuthGate 执行 replace，按钮不重复导航；混合访问页默认留在原页展示游客内容。Expo 保留其现有路径契约。

## Web 守卫导航契约

适用于默认 Gate、存量／自写 `RequireAuth` 及导航适配层。优先复用已存在且符合契约的 Gate；保留已有 Auth Context/store 时，也必须保留以下导航行为：

- **固定来源和目标**：进入本次跳转分支时捕获来源快照（含 search/hash），经安全校验后生成固定目标；后续 location 更新不改写本次 returnTo／redirect。登录入口不能再次作为受保护来源嵌入目标，不依赖登录成功后的回跳校验来阻止登录前的自跳。
- **同一次尝试去重**：父层重渲染或 StrictMode effect 重放不能重复发起导航；不要用随 location 变化的 key 重挂守卫。失败展示错误并允许用户显式重试，不通过自动重渲染反复重试，也不新增跨流程的通用跳转锁。
- **等待路由提交**：地址变化或 navigate 返回不等于目标页已提交；pending 时旧守卫可能仍挂载，只展示等待／错误，不重新取来源导航、不放行受保护内容，由路由完成切换并卸载旧分支。

禁止在匿名分支中用实时 location 反复生成导航目标，例如：

```tsx
// 反例：旧守卫未卸载时，下一次 location 已可能是 /login?redirect=...
const location = useLocation();
if (status === 'anonymous') {
  const from = `${location.pathname}${location.searchStr ?? ''}`;
  return <Navigate to="/login" search={{ redirect: from }} replace />;
}
```

导航可能先更新 location、后提交新路由，导致旧守卫把 `/login?redirect=...` 再包进下一层 redirect，持续触发 URL 编码。删除手工 `encodeURIComponent` 或对依赖 location 的计算加 `useMemo` 都不能固定来源；单独短路 `/login` 可阻断该例自跳，但不能替代目标稳定和同一次尝试去重。

默认 AuthGate 已在匿名分支的独立组件中捕获来源，并由内部 AuthRedirect 固定目标、去重；业务只使用公共 Gate。确需适配现有守卫时，在该跳转分支挂载时用惰性 state 或等价快照捕获来源，不在整个守卫首次挂载、身份尚未确定时提前固定；Hook 放在独立组件顶层，不放进条件分支。检查慢导航 pending、父层重渲染及 StrictMode 重放时目标不变、同一次尝试只导航一次；源 URL 的 search/hash 保留，登录入口不会递归进入 redirect，失败后可显式重试。

## 状态与页面跳转

普通认证使用前两个 Gate；恢复入口固定 `mode="recovery"`，步骤与身份检查由恢复 Hook 负责：

| Gate | 判断依据 | 场景及未满足时的行为 |
| --- | --- | --- |
| `AuthGate` | 是否 authenticated | 仅限需登录的页面／布局；匿名跳 `loginPath`，混合访问页不套整页守卫 |
| `AuthEntryGate` | mode、认证状态 | login 已登录时跳 authenticatedPath，匿名显示页面；register/recovery 始终保留页面，由业务步骤完成导航 |
| `RoleGate` | 项目权限查询的 granted / denied | 角色业务页；明确拒绝才跳 `deniedPath` |
| `MfaGate` | AAL 查询得到的 MFA 状态 | AAL2 业务页；未开通去 enrollment，待验证去 challenge |

Gate 只消费状态，不查询权限或发起认证；API/RLS 才负责数据权限。`RoleGate / MfaGate` 放在 `AuthGate` 内，角色查询失败不能映射为 denied。角色必须来自可信的服务端权限来源，不能信任前端 isAdmin 或用户可编辑的 user_metadata；切换用户立即清空旧权限并丢弃旧查询结果。无权限页及 MFA enrollment/challenge 页不要套要求相同权限／已验证的 Gate，以免循环。

`loadingFallback` 可省略，加载期间允许渲染空白；`errorFallback` 未传时显示内置错误提示，查询失败不能长期白屏。

## 最小使用示例

默认使用独立认证路由，每页固定 mode；仅用户明确要求或已有组合入口时按需保留。以下为各页面的独立片段，页面由项目实现。已有 Auth Context/store 时直接传现有状态，不再挂 Provider。

```tsx
import { AuthProvider, useAuth, AuthGate, AuthEntryGate } from '@/features/supabase-auth-runtime';

// 根部只挂一次
<AuthProvider><App /></AuthProvider>;

// 普通业务页
const { status, user } = useAuth();
<AuthGate status={status}><Dashboard /></AuthGate>;

// 登录随认证状态导航；safeReturnTo 已通过安全函数校验
<AuthEntryGate mode="login" status={status} authenticatedPath={safeReturnTo}><LoginPage /></AuthEntryGate>;

// /register：资料收尾成功后导航
<AuthEntryGate status={status} mode="register" authenticatedPath={safeReturnTo}><RegisterFlow /></AuthEntryGate>;

// /reset-password：恢复会话退出后返回登录
<AuthEntryGate status={status} mode="recovery"><RecoveryFlow onExit={goToLogin} /></AuthEntryGate>;
```

### 可选守卫

只有本轮需要时才从子路径导入对应能力；不要把全部可选守卫复制到普通登录页。

```tsx
import { RoleGate, MfaGate } from '@/features/supabase-auth-runtime/optional/auth-guards';

// 角色、MFA 状态来自认证完成后的查询，放在 AuthGate 内
<RoleGate status={roleStatus} deniedPath="/forbidden"><AdminPage /></RoleGate>;
<MfaGate status={mfa.status}><SensitivePage /></MfaGate>;
```

示例路径须替换为项目已有页面，`safeReturnTo` 经安全函数处理；`goToLogin` 由页面提供，只在恢复 Hook 确认退出／取消完成后调用。`AuthEntryGate` 保留注册和恢复流程；`RecoveryFlow` 内使用恢复 Hook，完整接线见 [恢复示例](recovery-flow-example.md)。`mode` 为 `login | register | recovery`；从进入注册／恢复直到流程结束保持对应模式，所有祖先布局不能再因有 Session 而跳转。已登录直接打开注册页也由该页面展示已有身份及继续／返回入口，不由入口 Gate 自动跳走。

Web 默认及自写 Gate 均按 [Web 守卫导航契约](#web-守卫导航契约) 接线；静态业务路由优先用类型安全的 `to`，已有其他路由库时只适配导航并保留状态语义。Expo 使用 Expo Router，不换成 window.location。

不维护通用跳转锁，也不将按钮 loading 接到导航判断。普通密码登录只提交认证和展示错误，认证成功后由 Gate 自动跳转；普通业务页退出只调用 signOut、处理返回 error／抛错和反馈，受保护页匿名后由 AuthGate 自动跳转，混合访问页默认留在原页切回游客视图。守卫放置及私有数据加载按 [页面访问语义](auth-route-plan.md#按页面访问语义选择守卫) 处理；必须完成的 profile、角色或业务初始化放在受保护的目标页／初始化步骤，未完成时不展示依赖它的业务内容。

注册（含 basic_auth）使用独立的表单、确认、必要业务收尾和成功步骤；成功建立本次 Session、完成所需身份核对及写入后，在成功步骤渲染声明式导航。不要为触发自动跳转把 register 改成 login。恢复流程按保存、退出、返回登录的顺序推进。两类流程即使 Auth loading/error 也保留当前步骤并显示等待／错误，不用固定为 login 的 AuthEntryGate 包裹。跳转统一由 Gate 或完成步骤负责，不在 render 中调用 navigate/router.replace，也不叠加“有 Session 就跳首页”的 effect。独立页面接线读 [业务示例](auth-entry-example.md)；存量组合入口同样遵守步骤收尾和祖先不得提前跳转的约束，不提供组合接线代码。
