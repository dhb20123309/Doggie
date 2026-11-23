# 邮箱验证码＋密码

前提：已确认 `authImplementationSop=auth_email_password`，云服务已初始化。本文补充邮箱通道差异；注册确认与恢复的身份核对及收尾规则见 [共同流程](verification-flow.md)。

## 动作与身份

公共入口创建一次 `createAuthActions('auth_email_password')`。注册、确认、密码登录和恢复均使用同一个真实 `auth.users.email`，不能用仅存在于 profiles 的邮箱恢复虚拟邮箱账号；存量虚拟邮箱升级按主 Skill 的迁移闸门执行。

| 页面动作 | 模板调用 | 底层 Auth 语义 |
| --- | --- | --- |
| 注册并发确认邮件 | `signUp({ email, password, username })` | `signUp({ email, password, options: { data: { username } } })` |
| 确认注册数字码 | `verifySignUp(email, token)` | `verifyOtp({ email, token, type: 'signup' })` |
| 密码登录 | `signIn({ email, password })` | `signInWithPassword({ email, password })` |
| 申请恢复码 | `requestPasswordRecovery(email)` | `resetPasswordForEmail(email)`，不传 redirectTo |
| 验证恢复码 | `verifyPasswordRecovery(email, token)` | `verifyOtp({ email, token, type: 'recovery' })` |
| 设置新密码 | `updatePassword(password)` | 恢复身份核对后 `updateUser({ password })` |

注册／登录不能用 `signInWithOtp` 或 `/auth/v1/otp` 替代。普通密码登录不追加邮箱 OTP。UI 未收集 username 时，按项目规则用清洗后的邮箱前缀加短随机后缀派生，避免空值或重复。

## 注册固定使用数字码

注册邮件模板使用 `{{ .Token }}`。signUp 成功后进入可输入、可提交的验证码页面，固定本次注册邮箱，调用 `verifySignUp(email, token)`（type 为 signup）；不能只有“查收邮件”的提示。

重发使用 `supabase.auth.resend({ type: 'signup', email })`。不传 `emailRedirectTo`，不生成等待链接页或注册 callback。若实际邮件发出链接，属于模板配置不符，应修正配置或报告阻塞，不据此切换页面流程。

## 恢复固定使用数字码

Meoo Cloud 只支持 Recovery 验证码：Recovery 邮件模板用 `{{ .Token }}` 发送 6 位码，有效期按当前实例配置核实。申请不传 `redirectTo`，不生成 Recovery 链接、等待链接页或恢复 callback。邮件与界面不符时修正配置或报告阻塞，不能让页面提示点击链接。

signup 与 recovery 验证 type 不可互换；验证码成功后按共同流程核对 Session/getUser，再进入新密码表单。验收同时核对邮件内容与页面实际步骤，不能只证明发信成功。
