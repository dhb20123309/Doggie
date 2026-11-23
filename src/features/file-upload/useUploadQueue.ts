// 来源 Skill：file-upload。接入说明见 skills/file-upload/SKILL.md，固定生命周期无需业务改写。
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createUploadQueue } from './uploadQueue';
import type { UploadQueueMetadata, UploadQueueOptions } from './uploadQueue';

/** Owns page scope only. The shared upload service remains caller-owned across page changes. */
export function useUploadQueue<T extends UploadQueueMetadata>(options: UploadQueueOptions<T>) {
  const callbacks = useRef(options);
  callbacks.current = options;
  const queue = useMemo(() => createUploadQueue<T>({
    service: options.service,
    scope: null,
    associate: (ref, context, scope) => callbacks.current.associate(ref, context, scope),
    onConfirmed: (ref, context, scope) => callbacks.current.onConfirmed?.(ref, context, scope),
  }), [options.service]);
  useLayoutEffect(() => {
    queue.setScope(options.scope);
    return () => queue.invalidate(); // Also safe when React replays setup/cleanup in StrictMode.
  }, [queue, options.scope?.ownerId, options.scope?.parentId]);
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  return { ...snapshot, enqueue: queue.enqueue, verify: queue.verify, retryAssociation: queue.retryAssociation, clear: queue.clear };
}
