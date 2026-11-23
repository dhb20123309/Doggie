# 认证错误反馈

从项目公共入口复用 `resolveAuthFeedback`，缺失时沿用已有等价实现或仅补反馈能力。只有修改错误映射、排查异常或接口不一致时才读取 `auth-error.ts`。

```ts
const { error } = await authActions.signIn({ username, password });
if (error) {
  const feedback = resolveAuthFeedback(error, { operation: 'signIn' });
  // invalid_credentials → { message: '账号或密码错误，请检查后重试', action: 'retry' }
  // 将 feedback 写入页面错误状态，结束当前提交。
}
```

## 输入与语义

- 处理 Supabase `result.error` 和 catch 异常；函数接受 unknown，优先按 `error.code + operation` 匹配，再以 HTTP 状态／有限网络消息兜底。不在页面复制错误字典，包装时不丢 code。
- `basic_auth` 的本地校验区分空账号、邮箱、用户名，分别使用 `auth_input_required`、`auth_input_email_invalid`、`auth_input_username_invalid`。以用户原始输入判断类型，不以映射后的虚拟邮箱判断；`result.error` 和 catch 都复用反馈函数，避免被固定文案覆盖。
- `operation` 与实际调用的方法名对应：`authActions.signIn()` → `signIn`、`signUp()` → `signUp`、`verifySignUp()` → `verifySignUp`、`requestPasswordRecovery()` → `requestPasswordRecovery`、`verifyPasswordRecovery()` → `verifyPasswordRecovery`、`updatePassword()` → `updatePassword`。直接调用 Client 时，`supabase.auth.updateUser()` → `updateUser`、`resend()` → `resend`、`mfa.challenge()` → `mfa.challenge`、`mfa.verify()` / `mfa.challengeAndVerify()` → `mfa.verify`；Session 恢复错误使用场景值 `session`。
- `resend` 仅注册确认重发；再次申请恢复码仍为 `requestPasswordRecovery`。
- 输出只有 message 和 action，不发请求、不改 Session、不自动跳转。注册需防枚举时传 `preventAccountEnumeration: true`，其他结果同步保持该策略；恢复 user_not_found 始终防枚举，不能据此创建账号或声称发送成功。
- 未知错误用安全兜底并保留脱敏诊断，不展示原始响应、Token、真实邮箱／手机号或内部配置。密码规则来自项目配置，不直接展示原始 strength reasons。

## 将 action 接到已有入口

| action | 页面动作 |
| --- | --- |
| `retry` | 保留输入和步骤，由用户修正后重试，不自动重试 |
| `edit_account / edit_password` | 定位对应输入 |
| `verify_account` | 进入已实现的注册确认，不用恢复代替 |
| `resend_code` | 保留待确认身份，按当前 SOP 重新获取 |
| `wait` | 停止连续请求，依据实际重试时间禁用／倒计时 |
| `login` | 提供已有登录／恢复入口；Session 失效时统一清理派生状态，同次只提示一次 |
| `reauthenticate` | 按 SOP 重新验证身份，再修改密码 |
| `restart_mfa` | 用户重新发起 challenge，成功后核对 AAL2 |
| `contact_support` | 提供已有支持入口，不绕过限制 |
| `none` | 留在当前流程显示提示，不进入成功态 |

只接已有能力，不因某个 action 新增注册、OTP 或 MFA。错误在表单附近持续可见（Web 可用 role=alert，Expo 用可访问文本），toast 仅作补充；不只存 feedback 而不渲染。

## 提交与验证

提交前清理旧反馈，请求中禁用重复提交，finally 只解除 loading；loading 不决定页面跳转。返回的 error 和 catch 异常都要写入可见反馈并中止成功分支；失败保留当前步骤，不清空所有输入、不继续写表／跳转、不抛成未处理 rejection。普通登录由认证状态驱动导航，注册和恢复由完成步骤驱动导航，具体接线见 [工程接入](integration.md#状态与页面跳转)。密码／验证码不持久化、不记日志。

对本轮适用的密码错误、重复注册、无效／过期码、限流、弱／相同密码、Session 失效或 MFA 失败，验证“失败响应 → 可见提示 → 正确下一步 → loading 解除”；另检查正常路径和未知错误。仅存在 catch／映射函数不代表页面反馈已完成。
