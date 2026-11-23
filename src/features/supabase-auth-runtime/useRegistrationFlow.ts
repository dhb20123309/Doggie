import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { resolveAuthFeedback, type AuthFeedback } from './auth-error';

export interface RegistrationIdentity { id: string }
export interface RegistrationData {
  user: RegistrationIdentity | null;
  session: { user: RegistrationIdentity } | null;
}
export interface RegistrationState {
  phase: 'idle' | 'submitting' | 'signup-failed' | 'no-identity' | 'confirmation-required'
    | 'finalizing' | 'finalization-failed' | 'completed';
  busy: boolean;
  /** Captured before signUp; editing the form cannot change the submitted identity. */
  submittedLabel: string | null;
  userId: string | null;
  feedback: AuthFeedback | null;
}
const initial = (): RegistrationState => ({ phase: 'idle', busy: false, submittedLabel: null, userId: null, feedback: null });
export interface RegistrationFinalizationScope {
  /** Check after async preflight and before each new business write. */
  isCurrent(): boolean;
  assertCurrent(): void;
}
type Finalize = (identity: RegistrationIdentity, scope: RegistrationFinalizationScope) => Promise<void>;

/** Identity flow only: no SDK instance, business schema, seed data or navigation. */
export function useRegistrationFlow(scopeKey: string) {
  const [view, setView] = useState<{ scope: string; epoch: number; state: RegistrationState }>({ scope: scopeKey, epoch: 0, state: initial() });
  const scope = useRef(scopeKey), generation = useRef(0), mounted = useRef(false), locked = useRef(false);
  const phase = useRef<RegistrationState['phase']>('idle');
  const confirmed = useRef<{ identity: RegistrationIdentity; label: string } | null>(null);
  // Only a committed scope change may discard an existing registration identity.
  useLayoutEffect(() => {
    if (scope.current !== scopeKey) {
      scope.current = scopeKey; generation.current++; locked.current = false;
      confirmed.current = null; phase.current = 'idle';
    }
  }, [scopeKey]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; locked.current = false; confirmed.current = null; };
  }, []);
  const begin = useCallback(() => {
    const ticket = generation.current;
    const current = () => mounted.current && scope.current === scopeKey && generation.current === ticket;
    const commit = (state: RegistrationState) => {
      if (!current()) return;
      phase.current = state.phase;
      setView({ scope: scopeKey, epoch: ticket, state });
    };
    return { current, commit };
  }, [scopeKey]);

  const finish = useCallback(async (finalize: Finalize, guard: ReturnType<typeof begin>) => {
    const saved = confirmed.current;
    if (!saved || !guard.current()) return false;
    const state: RegistrationState = { ...initial(), phase: 'finalizing', busy: true, submittedLabel: saved.label, userId: saved.identity.id };
    guard.commit(state);
    try {
      await finalize(saved.identity, {
        isCurrent: guard.current,
        assertCurrent() {
          if (guard.current()) return;
          const error = new Error('注册流程已失效');
          error.name = 'AbortError';
          throw error;
        },
      });
      if (!guard.current()) return false;
      guard.commit({ ...state, phase: 'completed', busy: false });
      return true;
    } catch (error) {
      guard.commit({ ...state, phase: 'finalization-failed', busy: false, feedback: resolveAuthFeedback(error, { operation: 'signUp' }) });
      return false;
    }
  }, []);

  const start = useCallback(async (
    submittedLabel: string,
    signUp: () => PromiseLike<{ data: RegistrationData; error: unknown }>,
    finalize: Finalize = async () => {},
  ): Promise<boolean> => {
    // A confirmed/pending identity must never fall back to a second signUp.
    const guard = begin(), label = submittedLabel;
    if (!guard.current() || locked.current || !['idle', 'signup-failed'].includes(phase.current)) return false;
    locked.current = true;
    const state = { ...initial(), phase: 'submitting' as const, busy: true, submittedLabel: label };
    guard.commit(state);
    try {
      const result = await signUp();
      if (!guard.current()) return false;
      if (result.error) throw result.error;
      const identity = result.data?.user;
      if (!identity?.id) {
        guard.commit({ ...state, phase: 'no-identity', busy: false });
        return false;
      }
      confirmed.current = { identity: Object.freeze({ id: identity.id }), label };
      if (!result.data.session || result.data.session.user.id !== identity.id) {
        guard.commit({ ...state, phase: 'confirmation-required', busy: false, userId: identity.id });
        return false;
      }
      return await finish(finalize, guard);
    } catch (error) {
      guard.commit({ ...state, phase: 'signup-failed', busy: false, feedback: resolveAuthFeedback(error, { operation: 'signUp' }) });
      return false;
    } finally {
      if (guard.current()) locked.current = false;
    }
  }, [begin, finish]);

  const completeConfirmation = useCallback(async (data: RegistrationData, finalize: Finalize = async () => {}): Promise<boolean> => {
    const guard = begin();
    const saved = confirmed.current;
    if (!guard.current() || locked.current || phase.current !== 'confirmation-required' || !saved
      || data.user?.id !== saved.identity.id || data.session?.user.id !== saved.identity.id) return false;
    locked.current = true;
    try { return await finish(finalize, guard); }
    finally { if (guard.current()) locked.current = false; }
  }, [begin, finish]);

  const retryFinalization = useCallback(async (finalize: Finalize): Promise<boolean> => {
    const guard = begin();
    if (!guard.current() || locked.current || phase.current !== 'finalization-failed' || !confirmed.current) return false;
    locked.current = true;
    try { return await finish(finalize, guard); }
    finally { if (guard.current()) locked.current = false; }
  }, [begin, finish]);
  return { ...(view.scope === scopeKey && view.epoch === generation.current ? view.state : initial()), start, completeConfirmation, retryFinalization };
}
