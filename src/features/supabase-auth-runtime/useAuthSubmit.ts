import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveAuthFeedback, type AuthFeedback, type AuthFeedbackOperation } from './auth-error';

/** 只负责提交互斥和错误反馈；原样保留 SDK data，不推断 Session 或导航。 */
export function useAuthSubmit() {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<AuthFeedback | null>(null);
  const locked = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; locked.current = false; };
  }, []);
  // Infer the whole SDK response union before projecting data; success/error branches may differ.
  const execute = useCallback(async <Result extends { data: unknown; error: unknown },>(
    operation: AuthFeedbackOperation,
    action: () => PromiseLike<Result>,
  ): Promise<Result['data'] | null> => {
    if (!mounted.current || locked.current) return null;
    locked.current = true;
    const ticket = generation.current;
    const current = () => mounted.current && generation.current === ticket;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await action();
      if (result.error) throw result.error;
      return current() ? result.data : null;
    } catch (error) {
      if (current()) setFeedback(resolveAuthFeedback(error, { operation }));
      return null;
    } finally {
      if (current()) { locked.current = false; setBusy(false); }
    }
  }, []);
  return { busy, feedback, execute };
}
