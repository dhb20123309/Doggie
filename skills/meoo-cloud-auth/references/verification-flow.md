# 注册确认与密码恢复的共同流程

适用于已确认的邮箱／短信验证码＋密码方案，规定身份核对、失败重试和完成条件。通道差异见 [邮箱](auth-email-password.md) 或 [短信](auth-sms-password.md)。基础密码登录不额外增加 OTP；普通 OTP 也不是 MFA。

## 注册：提交与确认分开

```text
注册表单 → submitting → 验证码输入 → verifying → success
```

注册步骤独立于 login/register 页面模式，用明确的 step 状态表示，不能仅按验证码输入是否为空决定调用 signUp 还是 verifySignUp。整个流程保持 register 模式，不套固定为 login 的 AuthEntryGate；已有 Session 也不代表本次注册步骤已完成。成功步骤核对当前 Session 后渲染声明式导航，不另设跳转开关。

1. 使用本次真实身份、密码及 username 调用 `authActions.signUp()`。`username` 按既有规则生成，非空、稳定且满足唯一性；传入 Auth metadata 以兼容 profile trigger，不为验证码另建用户表。
2. 检查返回 error；无错误且 `data.session` 为空时保留本次身份和 username、清空密码，进入确认步骤。不能调用 `signIn / signInWithPassword` 兜底，也不能只弹“已发送”后切回登录。预期需确认却立即返回 Session 时报告配置不符，不关闭确认或冒充已验证。
3. 验证码提交调用 `verifySignUp(pendingIdentity, token)`，确认本次验证的有效 Session，再用 `getUser()` 核对同一身份；失败保留步骤，不写业务数据或跳成功页。密码已在 signUp 设置，确认成功后无需再次密码登录。
4. 仅在项目确需时补写 profile，必要写入成功后才进入成功态；已确认身份但写入失败时保留独立的业务收尾步骤，仅重试必要写入，不再次 signUp 或消费旧验证码。邮箱／手机号仅当业务需查询时写 profile；不能把 profile 中的次级身份当作 Auth 身份。
5. 重发走 signup confirmation，绑定同一待确认身份，不重新 signUp，也不调用恢复发码。编辑身份需显式重新开始；刷新／返回丢失待确认身份或必要 username 时，提示注册信息失效并回到表单，不能用空身份、当前表单新值或 profile 字段验证旧码。

验证、改密和退出期间禁用重复提交及切换身份／流程；如允许取消，旧请求结果不得继续推进新流程。业务收尾前再次核对当前用户与本次验证用户一致，角色／MFA 异步结果也不能跨账号复用。

通常使用原生确认流程；只有用户明确要求自定义验证流程时才另行设计受控服务端方案，不默认增加验证云函数或绕过 Auth。确认页应有禁用重复提交、错误／过期反馈和重发／重新开始入口。

## 恢复：验证成功后仍有新密码步骤

恢复统一使用 `optional/usePasswordRecoveryFlow`，完整接线见 [恢复流程](recovery-flow-example.md)。以下说明 Hook 承担的身份与状态约束，页面只绑定 Hook 动作并按 step 渲染，不重新编排底层 SDK 调用。

完整接入本方案的密码登录页时，提供可到达恢复流程的“忘记密码”入口，除非用户明确不需要；不能只有空链接或提示。局部修复仍遵守本轮范围，不顺带新增功能。

```text
身份输入 → 发码 → 验证码输入 → 身份核对 → 新密码表单 → 保存 → 退出恢复会话 → 返回登录
```

1. 页面调用 `flow.request(identity)`，Hook 请求恢复码并固定本次身份；确认发送成功只进入验证码步骤。
2. 页面调用 `flow.verify(token)`，Hook 核对验证返回的 error、Session 及 `getUser()` 身份后，才设置恢复标记并进入 password。当前已有普通登录 Session 不能替代本次验证；身份核对失败调用 `flow.retryIdentity()`，不重复消费验证码。
3. 页面仅在 `flow.step === 'password'` 展示新密码表单，调用 `flow.save(password)` 前完成输入校验；Hook 在改密请求前再次确认本次恢复身份及 Session。验证码失效、无 Session 或刷新丢失一次性恢复状态时重新申请，不从 authenticated 自动恢复改密资格。
4. Hook 在改密前进入独立 saving 步骤，成功后进入 signingOut，避免 `USER_UPDATED` 清除标记时丢失结果。页面清空密码，调用 `flow.finish()` 由 Hook 退出当前恢复会话，仅成功后返回登录；退出失败只重试 finish，不重复 save 或报成改密失败。清除恢复标记不等于登出，saving/signingOut/done 不再按 authFlow 过滤展示。
5. 从进入恢复入口起保留页面，不能等 verifyOtp/getUser 返回才阻止重定向。恢复流程及祖先不能使用 固定为 login 的 `AuthEntryGate` 或“有 Session 就跳首页”的 effect；独立恢复页面固定 `mode="recovery"`，接线见 [业务示例](auth-entry-example.md)。

恢复模式只用于保留页面，不能作为权限凭据；不要持久化验证码、密码或自造恢复授权标记，平台 Client 的 Session 持久化照常工作。取消时只清理本次流程建立且仍为当前用户的会话，不能注销后来切换的其他账号；注销失败保留可重试状态。

## 验收重点

- 沿真实页面入口检查“注册提交 → 确认 → 成功”和“恢复发码 → 验证 → 设置新密码 → 使用新密码登录”；只测试本轮适用流程。检查同一身份、OTP type、signup 重发及恢复 API，不以函数存在或送达消息代替页面接线。
- 模拟 Auth 事件先于验证请求／getUser 返回，确认表单不会提前跳走；验证 USER_UPDATED 不丢保存结果，退出失败不重复改密。无效／过期码、网络失败和业务写入失败保留当前步骤并提供反馈。
- 注册确认前 signIn 调用应为零，不能靠登录兜底掩盖配置问题。启用服务与交付证据按主 Skill；真实身份／验证码缺失时端到端记为 `BLOCKED`，模拟交互不能证明邮件或短信实测通过。
