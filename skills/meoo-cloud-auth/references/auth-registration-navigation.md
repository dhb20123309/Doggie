# 当前流程：注册完成与导航

先按 [密码公共合同](password-api.md) 调用已选模式的 signUp，检查原始 data/error；没有 error 不代表已获得 Session 或完成注册。只有本轮需要邮箱/短信确认时读取 [共同确认流程](verification-flow.md)，basic_auth 不增加验证码。页面从进入注册起使用 mode="register"，Session 提前到达不能跳过业务收尾。

## 注册按步骤完成导航

注册复用公共 `useRegistrationFlow` 的 phase/start/retryFinalization，按 [当前流程接线](password-flow.md) 绑定真实资料写入，不另建重复状态机。basic_auth 注册不增加验证码步骤；注册动作成功返回有效 Session 后按需要核对身份、完成写入，再进入 success。邮箱／短信注册确认沿用 [共同流程](verification-flow.md)，不能用有 Session 代替验证码和身份检查。

start/retryFinalization 返回 true 才进入成功导航；失败保留 Hook 当前 phase 及反馈。finally 仅结束按钮 loading。Web 成功步骤使用 TanStack Router 的声明式 Navigate；动态完整路径按项目路由类型适配：

```tsx
// RegisterFlow 内；Navigate 为 RouterNavigate<AnyRouter, string, string>。
if (flow.phase === 'completed') {
  return (
    <AuthGate status={status} loginPath={buildLoginPath(returnTo)}>
      <Navigate href={resolveSafeReturnTo(returnTo)} replace />
    </AuthGate>
  );
}
```

完成后 Session 失效由 AuthGate 引导重新登录，不能退回已消费的验证码步骤。身份已确认但业务写入失败时留在 finalize，仅重试写入；注册步骤和祖先均不使用固定为 login 的 AuthEntryGate。只有 flow.phase === 'idle' 且已登录直接进入注册页时，才展示已有身份继续入口。本次提交开始后的任何阶段（包括 submitting、confirmation-required、finalization-failed）都优先显示注册流程，不能被 authenticated 分支覆盖；不自动创建或切换账号。

## 无 Session 与收尾失败

signUp 返回用户但没有 Session，不等于注册请求未执行。保留已提交状态，不提示重新注册。basic_auth 使用虚拟邮箱时无法完成收信确认，应显示模式与 Auth 配置不兼容并报告阻塞；不得假造 Session、伪造验证码或自动更改认证配置。真实邮箱/短信 SOP 使用其确认流程。

业务收尾按本次 await 的结果判断：资料 service 必须检查 error、非空回执与身份归属，失败抛错，由 Hook 留在 finalization-failed。仅重试 retryFinalization，不能重复 signUp；按本次返回 boolean 导航，不读取闭包旧 phase 判断成功。
