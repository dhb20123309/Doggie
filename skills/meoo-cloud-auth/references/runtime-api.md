# 模板接口速查

适用于 Web/H5、Expo 的 `src/features/supabase-auth-runtime/`。普通接入核对项目实际 `index.ts`、所需导出及目标文件存在后即可按契约调用，无需读取内部源码；使用可选子路径时核对对应模块和导出。源码读取条件见 [最小公共合同](../SKILL.md#最小公共合同)。本文描述当前模板，不代表模板已经注入。已有等价实现时沿用其接口；入口缺失时按 [工程接入](integration.md) 补齐，或使用对应 SOP 的原生 SDK 示例。

本文维护导入路径、参数、返回值与接口边界；本轮只补当前流程：[密码登录](auth-password-login-example.md)、[注册收尾](auth-registration-navigation.md)、[退出](auth-signout-example.md)。跨流程导航排障才补 [完整接线示例](auth-entry-example.md)。基础接口从 `@/features/supabase-auth-runtime` 导入。

## 1. 动作：createAuthActions

传入已确认的模式字面量，返回该模式的共享动作对象；在项目中复用一份，不按表单输入类型切换模式。

| 模式参数 | signUp(input) | signIn(input) | supportsPasswordRecovery |
| --- | --- | --- | --- |
| `'basic_auth'` | `{ username, password }` | `{ username, password }` | `false` |
| `'auth_email_password'` | `{ email, password, username }` | `{ email, password }` | `true` |
| `'auth_sms_password'` | `{ phone, password, username }` | `{ phone, password }` | `true` |

表中字段均为必填 `string`。三种对象都提供 `mode`、`signUp(input)`、`signIn(input)`、`signOut()`；邮箱／短信对象额外提供第 5 节的方法。

- `username` 注册时写入 `user_metadata.username`。邮箱／短信模式中它是展示资料，登录不用传；需要真实姓名等资料时由业务另行处理。
- 账号和用户名会 `trim()`，密码原样传递。`basic_auth` 传原始用户名，由共享动作解析；输入规则见 `skills/meoo-cloud/references/basic_auth.md`，页面字段见 [页面输入契约](integration.md#页面输入契约)。邮箱动作检查标识非空，页面负责邮箱格式校验；短信动作接收原始手机号，由模板统一校验并归一化为 E.164，页面不另写补区号逻辑，接受范围见下方手机号说明。
- 邮箱注册类型 `EmailPasswordSignUpInput` 还保留可选 `emailRedirectTo?: string`，当前验证码流程省略它。

### 返回值与错误

各方法直接返回对应 Supabase SDK 的 Promise 结果，不解包 `data`。检查结果中的 `error`；本地校验可能同步抛错，请将调用放在 `try/catch` 内。

| 方法 | 底层调用 | 结果读取 |
| --- | --- | --- |
| `signUp(input)` | `supabase.auth.signUp` | `{ data: { user, session }, error }`；无错误仍可能没有 Session |
| `signIn(input)` | `supabase.auth.signInWithPassword` | `{ data: { user, session }, error }`；身份更新由共享 Provider 监听 |
| `signOut()` | `supabase.auth.signOut` | `{ error }` |

动作不会设置按钮 loading、显示反馈、写 profile 或执行导航。导出的输入类型为 `BasicAuthSignUpInput`、`EmailPasswordSignUpInput`、`PhonePasswordSignUpInput`。

普通密码登录的提交、可见反馈和状态导航见 [当前登录示例](auth-password-login-example.md)，不展开注册确认、恢复或 MFA。

短信动作（注册、登录、注册确认、恢复发码和恢复验证）在调用 SDK 前统一归一手机号。公共入口导出 `normalizeMainlandPhone(phone: string): string`：大陆 11 位号码、`86`／`+86` 前缀统一为 `+86XXXXXXXXXXX`，忽略首尾空白；其他格式抛出 `auth_input_phone_invalid`，由 `resolveAuthFeedback` 提示修改账号。页面直接使用 SDK 重发时也使用此函数和固定的待验证号码。该规则不改变 basic_auth 的数字用户名，也不修改已有 Auth 账号。

## 2. 身份状态：AuthProvider / useAuth

`AuthProvider` 只接收 `children: ReactNode`，在根部挂一次。`useAuth(): AuthContextValue` 必须在它内部调用，返回：

| 字段／方法 | 类型与含义 |
| --- | --- |
| `status` | `AuthStatus`：`loading / authenticated / anonymous / error` |
| `session` | `Session \| null`，Supabase 会话 |
| `user` | `User \| null`，当前用户 |
| `error` | `Error \| null`，身份加载错误 |
| `username` | `string \| null`，从 `user.user_metadata.username` 派生 |
| `authFlow` | `AuthFlow`：`standard / password_recovery` |
| `enterPasswordRecovery()` | `void`，由恢复 Hook 在验证码及身份核对成功后设置恢复标记，页面不直接调用 |
| `leavePasswordRecovery()` | `void`，由恢复 Hook 在退出完成后清除恢复标记，不替代退出 Session |

Provider 负责初始化和认证事件订阅；初始 Session 经 `getUser()` 核对后才进入 authenticated，`INITIAL_SESSION` 不提前放行或覆盖核对错误，后续真实认证变更优先于旧初始化结果。恢复标记只随同一用户的会话刷新保留，切换用户、Session 消失或 `USER_UPDATED / SIGNED_OUT` 时清除；无已认证 Session 时不能设置恢复标记。页面不另建监听器，恢复标记不是改密授权，恢复收尾见 [确认与恢复流程](verification-flow.md)。

## 3. 页面守卫与跳转

所有基础 Gate 都要求 `status: AuthStatus`、`children: ReactNode`；可选 `loadingFallback?: ReactNode`（默认空白）、`errorFallback?: ReactNode`（默认内置错误提示）。

| 组件 | 额外参数与默认值 | 行为 |
| --- | --- | --- |
| `AuthGate` | `loginPath` 可选；Web 默认 `/login?returnTo=原业务地址`，Expo 默认 `/login` | 匿名时 replace 到登录页，已登录显示 children |
| `AuthEntryGate` | 必填 `mode: 'login' \| 'register' \| 'recovery'`；`authenticatedPath` 默认 `/` | login 已登录时 replace 到目标页，匿名显示 children；register/recovery 始终显示 children，由页面处理等待、错误及完成导航 |

Web 路径参数为 `string`，Expo 为 Expo Router 的 `Href`。Gate 只消费状态；Web 默认来源在进入匿名分支时读取一次，不要求业务页订阅 location。显式 loginPath 为完整目标地址（可含 query/hash），不会自动再拼 returnTo；自定义登录路径时由调用方提供安全目标。根布局、业务边界与入口的用法见 [路由关系](auth-route-plan.md)。只有项目公共入口或导航契约缺失时补读 [工程接入](integration.md#最小使用示例)。

Web 的 Gate 内部共用 `AuthRedirect.tsx`（不从公共入口导出）：一次跳转固定目标，重渲染和 StrictMode effect 重放不重复发起；pending 时等待路由提交，不把地址变化当作完成。导航抛错显示“重试跳转”，重试沿用原目标；离开跳转分支后再次进入会开始新的一次跳转。不要使用 location 作为 Gate 的 key。此实现不改变 Expo Router 的 Redirect。

普通业务页退出只调用 signOut 并处理反馈，匿名后的跳转由 AuthGate 负责；恢复流程仍由自己的完成步骤负责返回。

| 工具函数 | 返回值与边界 |
| --- | --- |
| `resolveSafeReturnTo(returnTo: string \| null \| undefined, fallback = '/')` | 返回站内路径，保留 query/hash；非法目标或模板认证入口返回 fallback。fallback 由业务提供可信路径 |
| `buildLoginPath(returnTo: string, loginPath = '/login')` | 返回带编码后 `returnTo` 参数的登录地址；loginPath 使用不带 query/hash 的登录路径 |

两者只返回字符串，不导航。模板认证入口集合为 `/login`、`/register`、`/auth/callback`、`/reset-password`；项目修改入口时同步适配。

## 4. 错误反馈：resolveAuthFeedback

`resolveAuthFeedback(error: unknown, options: AuthFeedbackOptions): AuthFeedback`

- `options.operation` 必填，使用当前动作名：`signIn`、`signUp`、`verifySignUp`、`requestPasswordRecovery`、`verifyPasswordRecovery`、`resend`、`updatePassword`、`updateUser`、`session`、`mfa.challenge`、`mfa.verify`。兼容旧别名，新代码使用这些名称。
- `options.preventAccountEnumeration?: boolean`：注册时是否隐藏账号存在信息，默认 `false`；找回密码始终使用防枚举文案。
- 返回 `{ message: string, action: AuthFeedbackAction }`。页面展示 message 并按 action 提供操作；函数不会自动重试、发码或跳转。

action 包括 `retry / edit_account / edit_password / verify_account / resend_code / wait / login / reauthenticate / restart_mfa / contact_support / none`；具体交互映射见 [错误反馈](auth-error-feedback.md)。

## 5. 邮箱／短信确认和恢复动作

仍从同一个 `createAuthActions('auth_email_password')` 或 `createAuthActions('auth_sms_password')` 返回对象调用；`basic_auth` 没有以下方法，无需直接导入 `optional/auth-verification.ts`。

所有参数均为 `string`；`identifier` 在邮箱模式是邮箱，在短信模式可传原始大陆手机号，由共享动作统一归一化。仅页面直接调用 SDK（如注册重发）时，才显式调用同一个 `normalizeMainlandPhone`，不另写归一规则。

| 方法 | 邮箱模式 | 短信模式 | 返回值 |
| --- | --- | --- | --- |
| `verifySignUp(identifier, token)` | `verifyOtp`，type 为 signup | `verifyOtp`，type 为 sms | `{ data: { user, session }, error }` |
| `requestPasswordRecovery(identifier)` | `resetPasswordForEmail`，不传 redirectTo | `signInWithOtp`，`shouldCreateUser: false` | 对应 SDK 原始结果，检查 error；发出验证码不代表已建立恢复会话 |
| `verifyPasswordRecovery(identifier, token)` | `verifyOtp`，type 为 recovery | `verifyOtp`，type 为 sms | `{ data: { user, session }, error }` |
| `updatePassword(password)` | `updateUser({ password })` | 同左 | `{ data: { user }, error }` |

调用同样处理 `error` 和抛错。验证、身份核对、恢复标记、改密和退出的顺序见 [确认与恢复流程](verification-flow.md)；这些方法不会代替页面推进步骤。重发验证码及 MFA 动作按对应流程调用 SDK，不在该动作对象上虚构方法。

## 6. 可选守卫与 MFA 状态

从 `@/features/supabase-auth-runtime/optional/auth-guards` 导入，不从公共入口导入。各 Gate 必填 `children`，同样支持 `loadingFallback`、`errorFallback`，路径类型与基础 Gate 相同。

| 导出 | 参数／返回值 |
| --- | --- |
| `RoleGate` | 必填 `status: RoleGateStatus`（loading/granted/denied/error）；`deniedPath` 默认 `/`。granted 显示 children，denied 跳转；查询错误显示 errorFallback |
| `MfaGate` | 必填 `status: MfaStatus`（loading/not_enrolled/challenge_required/verified/error）；`enrollmentPath` 默认 `/auth/mfa/enroll`，`challengePath` 默认 `/auth/mfa/challenge`。verified 显示 children；未开通或待验证时到对应页面 |
| `initialMfaSnapshot` | 初始状态值：status 为 loading，currentLevel、nextLevel、error 为 null |
| `resolveMfaSnapshot()` | `Promise<MfaSnapshot>`，查询 Supabase AAL；返回 `{ status, currentLevel, nextLevel, error }`，两个 level 为 `'aal1' \| 'aal2' \| null` |

`resolveMfaSnapshot()` 将 SDK 返回的错误放入 error、status 设为 error；调用时也处理抛错。currentLevel 为 aal2 则 verified，否则 nextLevel 为 aal2 则 challenge_required，其余为 not_enrolled。

角色和 MFA 查询由业务在身份更新后执行，Gate 不发起查询；API/RLS 承担数据权限校验。Web 角色查询、错误重试和切换账号隔离见 [角色查询接线](role-access-example.md)，MFA 流程见 [MFA](auth-mfa.md)。

## 7. 可选恢复流程 Hook

从 `@/features/supabase-auth-runtime/optional/usePasswordRecoveryFlow` 导入 `usePasswordRecoveryFlow`，传入项目唯一的邮箱或短信 `authActions`；不适用于 basic_auth。Web/Expo 共享实现，不新增 Client、Session 订阅或持久化授权。

返回 `step / pendingIdentity / passwordSaved / busy / error` 与以下异步动作，动作成功返回 true，失败、重复提交或过期响应返回 false；错误已经转成可见反馈。`passwordSaved` 只在改密成功后为 true，取消时的退出提示不能宣称密码已保存。页面仍负责输入格式、两次密码一致性及服务端限流提示。

| 方法 | 允许步骤与行为 |
| --- | --- |
| request(identity) | request/invalid 发码；verify 重发固定的 pendingIdentity，不改用输入框新值 |
| verify(token) | verify 校验后进入 checkingIdentity，再核对 getUser 和当前 Session；成功才进入 password |
| retryIdentity() | checkingIdentity 失败只重试身份核对，不重复消费验证码 |
| save(password) | password 再次核对身份后进入 saving；成功进入 signingOut，页面立即清空密码 |
| finish() | signingOut 检查并退出本次用户的当前恢复会话，成功进入 done；失败只重试此方法 |
| cancel() | 非忙碌且尚未保存时取消；本流程已建立会话则先退出，失败留在退出步骤；不注销其他用户 |

`done` 表示退出／取消已完成，页面此时调用 onExit 回登录；`invalid` 需要重新发码。刷新重新从 request 开始，URL 和普通登录态不提供改密资格。切换账号会作废本次验证；卸载后不推进 UI，也不自动登出。验证／改密期间禁用流程切换，不能依靠卸载撤销已经发出的 Auth 请求。恢复资格由 Hook 在验证及保存动作中检查；页面只按 step 渲染，不再按 status/authFlow 过滤步骤，saving/signingOut/done 在恢复标记清除后仍须可见。

完整 Web 表单见 [恢复示例](recovery-flow-example.md)。
