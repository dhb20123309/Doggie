# 恢复流程接线

邮箱／短信密码恢复统一使用项目中的 `optional/usePasswordRecoveryFlow.ts`，不在页面另写恢复状态机；参数与返回值见 [Hook 契约](runtime-api.md#7-可选恢复流程-hook)。入口缺失时按主 Skill 的模板补齐规则处理。

下面展示 Web 业务表单的完整步骤，按项目替换字段标签、样式和格式校验。`authActions` 是项目已确认的唯一动作对象；短信号码由模板 Hook 和动作统一归一为 E.164，邮箱传真实邮箱。不要另建 Client，也不要修改 Provider 事件语义。

## 按钮接线契约

替换为项目按钮组件时，保留以下步骤与动作的对应关系；`busy` 时禁用操作，避免重复请求。

| 状态 | 用户操作 | 必须执行 |
| --- | --- | --- |
| `request / invalid` | 发送重置验证码 | `flow.request(identity)` |
| `verify` | 验证并设置新密码 | `flow.verify(token)` |
| `verify` | 重新发送 | `flow.request(flow.pendingIdentity)`，成功后清空验证码 |
| `checkingIdentity` 且有错误 | 重试身份核对 | `flow.retryIdentity()` |
| `password` | 保存新密码 | 校验通过后 `flow.save(password)` |
| `signingOut` | 退出并返回登录 | `flow.finish()` 返回成功后才调用 `onExit()` |
| `done` | 返回登录 | 直接调用 `onExit()` |
| `request / invalid / verify / checkingIdentity / password` | 取消并返回登录 | `flow.cancel()` 返回成功后才调用 `onExit()` |

退出、返回、取消默认使用 `type="button"` 并显式绑定处理函数。若退出／返回统一使用提交按钮，表单 `onSubmit` 必须覆盖 `signingOut / done`，并调用下方的 `exit()`；只保留文案或只定义 `exit()` 而未绑定事件都不算接线完成。不要同时在 `onClick` 和 `onSubmit` 重复执行同一动作。退出失败保留可见错误和重试入口，不导航、不重复保存密码。

## Web 接线示例

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { usePasswordRecoveryFlow } from '@/features/supabase-auth-runtime/optional/usePasswordRecoveryFlow';
import { authActions } from '@/auth/actions';

export function RecoveryFlow({ onExit }: { onExit: () => void | Promise<void> }) {
  const flow = usePasswordRecoveryFlow(authActions);
  const [identity, setIdentity] = useState('');
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [inputError, setInputError] = useState('');

  useEffect(() => {
    if (flow.step === 'signingOut' || flow.step === 'done' || flow.step === 'invalid') {
      setPassword('');
      setConfirmation('');
      setToken('');
    }
  }, [flow.step]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setInputError('');
    if (flow.step === 'request' || flow.step === 'invalid') {
      // 短信模板兼容无区号的大陆手机号，Hook 内统一归一并校验。
      await flow.request(identity);
    } else if (flow.step === 'verify') {
      await flow.verify(token);
    } else if (flow.step === 'password') {
      if (password !== confirmation) {
        setInputError('两次输入的密码不一致');
        return;
      }
      await flow.save(password);
    }
  }

  async function exit() {
    const completed = flow.step === 'done' || (flow.step === 'signingOut'
      ? await flow.finish() : await flow.cancel());
    if (completed) await onExit();
  }

  return <form onSubmit={submit} aria-busy={flow.busy}>
    <fieldset disabled={flow.busy}>
      {(flow.step === 'request' || flow.step === 'invalid') && <>
        {flow.step === 'invalid' && <p role="alert">本次验证已失效，请重新发起。</p>}
        <label>账号<input autoComplete="username" required value={identity}
          onChange={event => setIdentity(event.target.value)} /></label>
        <button type="submit">发送重置验证码</button>
      </>}
      {flow.step === 'verify' && <>
        <p>请填写本次账号收到的验证码</p>
        <label>验证码<input required autoComplete="one-time-code" value={token}
          onChange={event => setToken(event.target.value)} /></label>
        <button type="submit">验证并设置新密码</button>
        <button type="button" onClick={async () => {
          if (await flow.request(flow.pendingIdentity)) setToken('');
        }}>重新发送</button>
      </>}
      {flow.step === 'checkingIdentity' && <>
        <p role="status">正在核对恢复身份</p>
        {flow.error && <button type="button" onClick={() => void flow.retryIdentity()}>重试身份核对</button>}
      </>}
      {flow.step === 'password' && <>
        <label>新密码<input type="password" required autoComplete="new-password" value={password}
          onChange={event => setPassword(event.target.value)} /></label>
        <label>确认新密码<input type="password" required autoComplete="new-password" value={confirmation}
          onChange={event => setConfirmation(event.target.value)} /></label>
        <button type="submit">保存新密码</button>
      </>}
      {flow.step === 'saving' && <p role="status">正在保存新密码</p>}
      {flow.step === 'signingOut' && <>
        <p role="status">{flow.passwordSaved
          ? '密码已保存，退出恢复会话后可使用新密码登录。'
          : '正在取消恢复，请退出本次恢复会话。'}</p>
        <button type="button" onClick={() => void exit()}>退出并返回登录</button>
      </>}
      {flow.step === 'done' && <button type="button" onClick={() => void exit()}>返回登录</button>}
      {flow.step !== 'saving' && flow.step !== 'signingOut' && flow.step !== 'done' &&
        <button type="button" onClick={() => void exit()}>取消并返回登录</button>}
    </fieldset>
    {(inputError || flow.error) && <p role="alert">{inputError || flow.error}</p>}
  </form>;
}
```

Hook 不保存密码、验证码或额外 Session；页面在保存成功／失效后清空敏感输入。示例将保存、退出呈现为独立步骤；若产品要求保存后自动返回，保存成功后调用 finish，仅在成功时 onExit，退出失败仍展示上述退出重试入口。

页面按实例配置／服务端响应显示密码规则和重发等待，不凭示例编造期限或限流时间。刷新从 request 开始，提示重新申请验证码；切换流程按钮在 busy 时禁用。卸载只能阻止旧结果推进 UI，不能撤回已经发送的认证请求。

入口使用 `AuthEntryGate(mode="recovery")` 保留整个页面；Hook 只在本次验证与身份核对通过后进入 password，保存前再次核对当前身份与恢复状态。页面只按 flow.step 渲染，不再按 status/authFlow 增加展示条件；saving/signingOut/done 在恢复标记清除后仍须可见。注册保留独立 finalize 步骤处理业务资料，不能复用恢复流程改密或把登录态当作资料写入完成。

## 交互验收

验收使用包含项目自定义按钮组件的最终页面、真实路由及祖先布局；实际点击按钮验证，不能只直接调用 Hook 方法、检查 API 或以构建通过代替。

- 保存成功进入 `signingOut` 后，点击“退出并返回登录”，验证退出恢复会话成功后到达登录页。
- 退出失败时，验证错误可见且仍停留在退出步骤；再次点击只重试退出，不再次调用改密，也不提前导航。
- `done` 状态点击“返回登录”，验证触发导航并到达登录页。

同时覆盖事件先到、验证／getUser 延迟、USER_UPDATED 先到、重发、刷新和账号切换。模拟交互只证明 UI 接线和状态机；真实短信／邮件送达与新密码登录另行验证，未执行的验收项如实标记未验证。
