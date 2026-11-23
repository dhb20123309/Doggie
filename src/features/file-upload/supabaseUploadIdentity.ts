// 来源 Skill：file-upload。接入先加载/复用该 Skill，按 skills/file-upload/SKILL.md 阅读接入说明。

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  FileUploadError,
  type UploadIdentity,
  type UploadIdentityProvider,
} from './types';

/**
 * Small auth snapshot guard used by the storage core. It never performs work
 * inside Supabase's auth callback; the callback only advances an epoch. Every
 * async upload/access operation checks that epoch before and after I/O.
 */
export function createSupabaseUploadIdentityProvider(
  client: SupabaseClient,
): UploadIdentityProvider {
  let currentUserId: string | null = null;
  let initialized = false;
  let identityEpoch = 0;
  let eventRevision = 0;
  let readSequence = 0;
  let appliedReadSequence = 0;
  let disposed = false;

  const invalidate = (nextUserId: string | null): void => {
    if (nextUserId === currentUserId) return;
    currentUserId = nextUserId;
    identityEpoch += 1;
  };

  const subscription = client.auth.onAuthStateChange((event, session) => {
    eventRevision += 1;
    const nextUserId = session?.user?.id ?? null;
    if (!initialized) {
      initialized = true;
      currentUserId = nextUserId;
      if (event !== 'INITIAL_SESSION') identityEpoch += 1;
      return;
    }
    invalidate(nextUserId);
  }).data.subscription;

  const assertUsable = (): void => {
    if (disposed) throw new FileUploadError('AUTH_CHANGED', '上传身份已失效。');
  };

  type SessionRead = {
    data: { session: { user?: { id?: string } } | null };
    error: unknown;
    sequence: number;
    startEpoch: number;
    startRevision: number;
  };

  const readSession = async (): Promise<SessionRead> => {
    assertUsable();
    const sequence = ++readSequence;
    const startEpoch = identityEpoch;
    const startRevision = eventRevision;
    const result = await client.auth.getSession();
    if (disposed) throw new FileUploadError('AUTH_CHANGED', '上传身份已失效。');
    return {
      data: result.data,
      error: result.error,
      sequence,
      startEpoch,
      startRevision,
    };
  };

  const merge = (read: SessionRead): UploadIdentity => {
    if (disposed || identityEpoch !== read.startEpoch) {
      throw new FileUploadError('AUTH_CHANGED', '登录用户已变化，请重新检查上传状态。');
    }
    const nextUserId = read.data.session?.user?.id ?? null;
    if (eventRevision !== read.startRevision) {
      return { userId: currentUserId, epoch: identityEpoch };
    }
    if (!initialized) {
      initialized = true;
      currentUserId = nextUserId;
      appliedReadSequence = read.sequence;
    } else if (read.sequence >= appliedReadSequence) {
      appliedReadSequence = read.sequence;
      invalidate(nextUserId);
    } else if (nextUserId !== currentUserId) {
      throw new FileUploadError('AUTH_CHANGED', '登录用户已变化，请重新检查上传状态。');
    }
    if (identityEpoch !== read.startEpoch) {
      throw new FileUploadError('AUTH_CHANGED', '登录用户已变化，请重新检查上传状态。');
    }
    return { userId: currentUserId, epoch: identityEpoch };
  };

  return {
    async capture(): Promise<UploadIdentity> {
      const read = await readSession();
      if (read.error) {
        throw new FileUploadError('AUTH_REQUIRED', '无法读取当前登录用户。', { cause: read.error });
      }
      return merge(read);
    },
    async assertCurrent(identity: UploadIdentity): Promise<void> {
      const read = await readSession();
      if (read.error) {
        throw new FileUploadError('AUTH_CHANGED', '无法确认当前登录用户，上传状态未知。', { cause: read.error });
      }
      const current = merge(read);
      if (current.epoch !== identity.epoch || current.userId !== identity.userId) {
        throw new FileUploadError('AUTH_CHANGED', '登录用户已变化，请重新检查上传状态。');
      }
    },
    getEpoch(): number {
      return identityEpoch;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      readSequence += 1;
      identityEpoch += 1;
      currentUserId = null;
      subscription.unsubscribe();
    },
  };
}
