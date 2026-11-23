import { useRef, useState, type FormEvent } from 'react';
import { useRegistrationFlow, type RegistrationFinalizationScope } from './useRegistrationFlow';
import { useAuthSubmit } from './useAuthSubmit';
import './password-auth-forms.css';

type Identity = { id: string };
type SignupResult = { data: { user: Identity | null; session: { user: Identity } | null }; error: unknown };
export type PasswordRegistrationFormProps = {
  status: 'loading' | 'authenticated' | 'anonymous' | 'error';
  signUp: (values: { username: string; password: string }) => PromiseLike<SignupResult>;
  saveProfile: (id: string, profile: { name: string }, scope: RegistrationFinalizationScope) => Promise<void>;
  onComplete: () => void;
  className?: string;
};
export function PasswordRegistrationForm({ status, signUp, saveProfile, onComplete, className }: PasswordRegistrationFormProps) {
  const flow = useRegistrationFlow('register-entry');
  const [values, setValues] = useState({ username: '', password: '', name: '' });
  const submitted = useRef<{ name: string } | null>(null);
  async function finalize(identity: Identity, scope: RegistrationFinalizationScope) {
    const profile = submitted.current;
    if (!profile) throw new Error('缺少本次提交资料');
    scope.assertCurrent();
    await saveProfile(identity.id, profile, scope);
  }
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (flow.busy) return;
    let completed = false;
    if (flow.phase === 'finalization-failed') {
      completed = await flow.retryFinalization(finalize);
    } else if (flow.phase === 'idle' || flow.phase === 'signup-failed') {
      if (!values.username.trim() || !values.password || !values.name.trim()) return;
      const account = { username: values.username, password: values.password };
      submitted.current = { name: values.name.trim() };
      completed = await flow.start(account.username, () => signUp(account), finalize);
    }
    if (completed) onComplete();
  }
  if (flow.phase === 'completed') return <p data-meoo-password-status role="status">注册与资料保存已完成</p>;
  if (flow.phase === 'idle' && status === 'authenticated')
    return <button data-meoo-password-action type="button" onClick={onComplete}>使用已有身份继续</button>;
  if (flow.phase === 'no-identity' || flow.phase === 'confirmation-required')
    return <p data-meoo-password-status role="status">已提交 {flow.submittedLabel}，{flow.phase === 'no-identity'
      ? '身份结果待确认，请勿重复注册'
      : '尚无可用Session；按当前认证模式完成确认或报告配置不兼容，请勿重复注册'}</p>;
  return <form data-meoo-password-form className={className} onSubmit={onSubmit} aria-busy={flow.busy}>
    {flow.phase !== 'finalization-failed' && <fieldset disabled={flow.busy}>
      <label>用户名<input name="username" required autoComplete="username" value={values.username}
        onChange={e => setValues(v => ({ ...v, username: e.target.value }))} /></label>
      <label>密码<input name="password" required type="password" autoComplete="new-password" value={values.password}
        onChange={e => setValues(v => ({ ...v, password: e.target.value }))} /></label>
      <label>姓名<input name="name" required value={values.name}
        onChange={e => setValues(v => ({ ...v, name: e.target.value }))} /></label>
    </fieldset>}
    {flow.feedback && <p role="alert">{flow.feedback.message}</p>}
    <button data-meoo-password-action type="submit" disabled={flow.busy}>{flow.busy ? '提交中…'
      : flow.phase === 'finalization-failed' ? '仅重试资料' : '注册'}</button>
  </form>;
}

export type PasswordLoginFormProps = {
  signIn: (values: { username: string; password: string }) => PromiseLike<{ data: unknown; error: unknown }>;
  className?: string;
};

/** Identity-driven navigation belongs to the surrounding login AuthEntryGate. */
export function PasswordLoginForm({ signIn, className }: PasswordLoginFormProps) {
  const { busy, feedback, execute } = useAuthSubmit();
  const [values, setValues] = useState({ username: '', password: '' });
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !values.username.trim() || !values.password) return;
    const account = { ...values };
    await execute('signIn', () => signIn(account));
  }
  return <form data-meoo-password-form className={className} onSubmit={onSubmit} aria-busy={busy}>
    <fieldset disabled={busy}>
      <label>用户名<input name="username" required autoComplete="username" value={values.username}
        onChange={e => setValues(v => ({ ...v, username: e.target.value }))} /></label>
      <label>密码<input name="password" required type="password" autoComplete="current-password" value={values.password}
        onChange={e => setValues(v => ({ ...v, password: e.target.value }))} /></label>
    </fieldset>
    {feedback && <p role="alert">{feedback.message}</p>}
    <button data-meoo-password-action type="submit" disabled={busy}>{busy ? '登录中…' : '登录'}</button>
  </form>;
}
