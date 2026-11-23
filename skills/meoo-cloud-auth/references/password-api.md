# 密码认证公共接口

普通用户名/邮箱/短信密码注册登录只使用本页的公共合同；恢复、MFA 与迁移不需要同时加载。上下文已提供公共入口导出且复制回执ready时直接使用；已有实现或具体错误时再核对实际入口，固定模板不修改、不复制内部代码。

从 `@/features/supabase-auth-runtime` 导入：

| 接口 | 当前接线合同 |
| --- | --- |
| `AuthProvider` | 只接收 children；在根布局挂载一次，内部使用平台生成 Client |
| `useAuth()` | 返回 status、session、user、error、username；status 为 loading/authenticated/anonymous/error |
| `AuthGate` | 必填 status/children；可选 loginPath/loadingFallback/errorFallback；只保护需要登录的业务边界 |
| `AuthEntryGate` | 必填 status/mode/children；可选 authenticatedPath/loadingFallback/errorFallback；login 自动导航，register/recovery 保留流程 |
| `createAuthActions(SOP)` | 一个项目只创建一次模式对象；signIn/signUp 返回原始 SDK `{data:{user,session},error}`，signOut 返回 `{error}` |
| `useRegistrationFlow(scopeKey)` | 注册返回 phase/busy/feedback/submittedLabel；start(label, signUp, finalize) 与 retryFinalization(finalize) 返回 boolean，只有 true 才导航；固定流程 key，不能使用表单内容或 Session 作 key |
| `useAuthSubmit()` | 返回 busy/feedback/execute；feedback 的 message 应显示在表单；execute 同步互斥，返回原始 data 或 null，不导航、不初始化业务资料 |
| `resolveSafeReturnTo(value, fallback?)` | 返回站内安全目标；默认目标必须对应项目真实页面 |

Web普通用户名密码页面直接使用以下现成表单（已复制到工程，内部Hook无需补读）：

| 组件 | 必填props与行为 |
| --- | --- |
| `LoginEntry` | Web 普通用户名密码公开登录页。传 `signIn(values)` 与真实业务路径 `authenticatedPath`，可传 `className`。内部处理身份恢复、表单错误、重试与安全 returnTo 跳转。 |
| `ProtectedLayout` | Web 业务父路由放入 children（通常为 Outlet），根布局提供唯一 AuthProvider。默认匿名跳 /login 并记录来源，自定义 loginPath 为指定跳转地址。登录页必须在此布局之外。 |
| `PasswordLoginForm` | `signIn(values)` 接SDK原始回执；values={username,password}；可选className；错误可重试、互斥提交；不自行导航，外层login Gate按身份导航 |
| `PasswordRegistrationForm` | `status`、`signUp(values)`、`saveProfile(id,{name},scope)`、`onComplete()`；可选className；包含用户名/密码/姓名输入，资料失败只重试资料；无Session保留提交账号、显示待确认；仅资料成功或idle已有身份才调用onComplete |

`saveProfile` 是当前业务适配器：把name映射实际schema字段，验证SDK error/非空回执/身份归属并抛错；异步预检后及每个新写入前scope.assertCurrent()。模板不创建Client、业务表、种子数据或伪造登录态。只给现成form加className/CSS样式；业务接线和实际文件路由见password-flow.md。邮箱/短信等不同输入或确认流程按其明确需求使用Hook，不把用户名表单强加给其他交互。

`execute(operation, action)` 的 action 是返回 `{data,error}` 的 PromiseLike；operation 使用对应 signIn/signUp/signOut。同步校验和 SDK error 都会成为反馈，重复/失败/卸载返回 null。仅 finally 解锁，不决定导航。执行退出可把 SDK 的 `{error}` 适配为 `{data:true,error}`，不要期待 signOut 原生包含 data。

直接传入 SDK 动作即可；execute 从完整返回类型保留 data 的联合分支，不需要给页面加类型断言、非空断言或为通过类型检查另包成功/失败对象：

```ts
const data = await execute('signIn', () => authActions.signIn({ username, password }));
// 需要消费回执时，仍检查 data?.user / data?.session；不把无 Session 当成功。
```

有真实业务校验时才在 callback 内校验并抛错，再返回原 SDK 回执；这不是解决类型推断的必需步骤。

| SOP | signIn | signUp |
| --- | --- | --- |
| basic_auth | `{username,password}` | `{username,password}` |
| auth_email_password | `{email,password}` | `{email,password,username}` |
| auth_sms_password | `{phone,password}` | `{phone,password,username}` |

字段是必填 string，密码原样传递；不要按字符串形状切 SOP。短信号码交模板归一为 +86，支持范围按已选短信模式的文档；basic_auth 不增加验证码。邮箱/短信没有 Session 时使用真实确认流程，不假装注册完成。

正常登录由 login Gate 随身份导航。注册及资料收尾从进入起使用 register，包括同页标签切换；标签状态和外层 Gate.mode 必须由同一父组件持有。注册确认及必要业务写入全部成功后才导航；写入失败留在 finalize，仅重试写入。

需要额外能力时才读完整 runtime-api 对应章节或恢复/MFA参考。模板初始化、Session订阅、提交锁和路由去重不在业务页面再写一套。注册用 useRegistrationFlow 承接 SDK 原始回执，不叠加 useAuthSubmit 的提交锁；登录及普通动作仍用 useAuthSubmit。普通资料异步查询使用已有数据访问模板的请求代次，账号变化作废旧回调；业务 schema、RLS 与字段由当前项目决定。

basic_auth 的虚拟邮箱若返回无 Session，保留已提交身份并显示配置不兼容；没有真实收信入口，不要求用户重复注册。需配置变更时报告当前确认设置，由有权限的操作者决定，不绕过认证。资料收尾判断本次 flow.start / retryFinalization 返回值，失败保留流程，仅重试收尾。
