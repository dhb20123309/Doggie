# 登录与注册共页的业务接线

固定模板继续原样使用 `AuthEntryGate`、`useAuthSubmit` 和唯一 `authActions`。路由、表单字段、注册资料写入属于当前业务接线。

同页标签切换时，拥有标签状态的组件必须也拥有外层 Gate 的 mode，不能在 `mode="login"` 的 Gate 子组件内部才切到注册。从点击注册标签起使用 register，Session 提前到达仍保留整个注册流程。独立注册路由从进入起固定 register。

```tsx
const [mode, setMode] = useState<'login' | 'register'>('login');
return <AuthEntryGate status={status} mode={mode} authenticatedPath={safeTarget}>
  <AuthForm mode={mode} onModeChange={setMode} />
</AuthEntryGate>;
```

`AuthForm` 使用传入 mode，不另建第二个 tab 状态。提交中禁用切换，防止离开未完成步骤。普通登录仍由 Gate 随身份状态导航。

注册只复用 [唯一接线合同](password-flow.md) 中的 useRegistrationFlow，不使用 execute('signUp')，也不再手写步骤/锁。父组件的切换按钮及子表单返回登录入口在提交期间统一禁用。仅在 flow.phase === 'idle' 且已有身份时展示继续入口；一旦本次提交开始，submitting、confirmation-required、finalization-failed 等全部由 flow.phase 渲染，不能用已登录分支遮挡资料重试。只有 start/retryFinalization 返回 true 才导航；必要资料写入失败不导航，不重新 signUp。

验收 Session 比 signUp await 返回更早到达的情况，确认页面不被提前卸载、必要资料存在、失败可重试且 signUp 未重复发送。源码检查与模块测试不能代替实际注册页面验收。
