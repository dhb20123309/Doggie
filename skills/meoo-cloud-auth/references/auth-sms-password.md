# 短信验证码＋密码

前提：已确认 `authImplementationSop=auth_sms_password`，云服务已初始化。本文补充短信通道差异；注册确认与恢复的身份核对及收尾规则见 [共同流程](verification-flow.md)。

## 动作与身份

公共入口创建一次 `createAuthActions('auth_sms_password')`。使用同一个真实 `auth.users.phone`，不采用“手机号当用户名＋虚拟邮箱”；存量升级按主 Skill 的迁移闸门执行。

| 页面动作 | 模板调用 | 底层 Auth 语义 |
| --- | --- | --- |
| 注册并发确认短信 | `signUp({ phone, password, username })` | `signUp({ phone, password, options: { data: { username } } })` |
| 确认注册码 | `verifySignUp(phone, token)` | `verifyOtp({ phone, token, type: 'sms' })` |
| 密码登录 | `signIn({ phone, password })` | `signInWithPassword({ phone, password })` |
| 申请恢复码 | `requestPasswordRecovery(phone)` | `signInWithOtp({ phone, options: { shouldCreateUser: false } })` |
| 验证恢复码 | `verifyPasswordRecovery(phone, token)` | `verifyOtp({ phone, token, type: 'sms' })` |
| 设置新密码 | `updatePassword(password)` | 恢复身份核对后 `updateUser({ password })` |

两种验证虽都用 `sms`，但注册与恢复的发起动作、待确认身份和页面状态独立。`shouldCreateUser: false` 仅用于既有账号密码恢复，不能用于未注册手机号发码，也不能暴露为常规免密登录入口；注册不用 `/auth/v1/otp`。

## 手机号与页面差异

- 仅支持中国大陆手机号。模板短信动作统一调用 `normalizeMainlandPhone(phone)`，接受大陆 11 位号码、`86` 或 `+86` 前缀及首尾空白，输出 E.164 `+86XXXXXXXXXXX`；其他区号或非法格式在请求前拒绝。不生成国际区号选择器，不在页面另写一套补区号逻辑。getUser 返回 phone 若省略前导 `+`，按同一函数比较，不接受不同号码。存量项目先确认辅助函数和动作已更新；格式兼容不会迁移已存在的 Auth 身份。
- UI 未收集 username 时按既有规则以手机号后四位加短随机后缀派生，保证非空且唯一；需要业务查询时才另写 profiles.phone。
- 注册先提交手机号和密码，再进入可见的短信验证码输入态；固定本次号码调用 `verifySignUp()`。重发走 `supabase.auth.resend({ type: 'sms', phone: normalizeMainlandPhone(pendingPhone) })`，归一函数从公共入口导入，不调用恢复发码或再次注册。
- 恢复验证通过后仍需新密码表单。普通密码登录不追加短信 OTP；Phone MFA 另按 [MFA](auth-mfa.md) 实现。
- 验证码有效期、发送频率及错误次数限制以当前实例配置／服务端响应为准。页面提供重发等待与限流反馈；未知时不要编造倒计时或固定解封时间，不连续重试。

验收重点是同一 E.164 身份、独立的注册确认与恢复步骤，以及未知手机号恢复不会创建用户。共同流程、失败反馈与真实短信测试要求按所链接文档，不以短信已发送作为完成。

本文件的动作表只覆盖注册、密码登录与恢复。单独修改手机号需区分业务资料字段和 Auth 登录身份：前者按项目权限更新资料，后者核对现有账号变更流程和验证配置另行接线；不能只改 profiles.phone 冒充 Auth 换绑，也不能复用恢复码完成换绑。
