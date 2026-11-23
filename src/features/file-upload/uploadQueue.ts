// 来源 Skill：file-upload。接入说明见 skills/file-upload/SKILL.md，固定队列无需业务改写。
import { FileUploadError } from './types';
import type { FileUploadService, UploadFile, UploadedFile, UploadProgress } from './types';

export interface UploadQueueScope { readonly ownerId: string; readonly parentId: string }
export type UploadQueueMetadata = Readonly<Record<string, string | number | boolean | null>>;
export interface UploadQueueContext<T extends UploadQueueMetadata> extends UploadQueueScope { readonly data: Readonly<T> }
export type UploadQueueState = 'queued' | 'uploading' | 'upload-unknown' | 'associating' | 'association-pending' | 'confirmed' | 'failed';
export interface UploadQueueItem<T extends UploadQueueMetadata> {
  readonly id: string;
  readonly file: UploadFile;
  readonly context: UploadQueueContext<T>;
  readonly state: UploadQueueState;
  readonly ref?: UploadedFile;
  readonly progress?: UploadProgress;
  readonly message?: string;
  readonly refreshError?: string;
}
export interface UploadQueueSnapshot<T extends UploadQueueMetadata> {
  readonly items: readonly UploadQueueItem<T>[];
  readonly busy: boolean;
  readonly blocked: boolean;
}
/** Guard business async preflights/readbacks before new side effects; already-sent requests are not cancelled. */
export interface UploadCallbackScope {
  isCurrent(): boolean;
  assertCurrent(): void;
}
export interface UploadQueueOptions<T extends UploadQueueMetadata> {
  readonly service: FileUploadService;
  readonly scope: UploadQueueScope | null;
  /** Resolve only after the exact business receipt is confirmed. Throw for any unconfirmed result. */
  readonly associate: (ref: UploadedFile, context: UploadQueueContext<T>, scope: UploadCallbackScope) => Promise<void>;
  readonly onConfirmed?: (ref: UploadedFile, context: UploadQueueContext<T>, scope: UploadCallbackScope) => Promise<void> | void;
}
export interface UploadQueue<T extends UploadQueueMetadata> {
  getSnapshot(): UploadQueueSnapshot<T>;
  subscribe(listener: () => void): () => void;
  setScope(scope: UploadQueueScope | null): void;
  /** Invalidate pending callbacks without disposing the caller-owned shared upload service. */
  invalidate(): void;
  enqueue(files: readonly UploadFile[], data: Readonly<T>): Promise<boolean>;
  verify(id: string): Promise<boolean>;
  retryAssociation(id: string): Promise<boolean>;
  /** Only clears idle confirmed/pre-write failures; cannot discard an uncertain upload/association. */
  clear(): boolean;
  dispose(): void;
}

type InternalItem<T extends UploadQueueMetadata> = { -readonly [K in keyof UploadQueueItem<T>]: UploadQueueItem<T>[K] } & { originalError?: FileUploadError };
const messageOf = (error: unknown): string => error instanceof Error ? error.message : '操作尚未确认，请保留当前记录';

/** Fixed queue protocol; business tables, parent authorization and presentation stay outside. */
export function createUploadQueue<T extends UploadQueueMetadata>(options: UploadQueueOptions<T>): UploadQueue<T> {
  let scope: UploadQueueScope | null = options.scope ? Object.freeze({ ...options.scope }) : null;
  let epoch = 0;
  let disposed = false;
  let active: object | null = null;
  let items: InternalItem<T>[] = [];
  let sequence = 0;
  const listeners = new Set<() => void>();
  let snapshot: UploadQueueSnapshot<T> = Object.freeze({ items: Object.freeze([]), busy: false, blocked: false });
  const current = (generation: number): boolean => !disposed && scope !== null && generation === epoch;
  const pending = (): boolean => items.some(item => item.state !== 'confirmed');
  const emit = (): void => {
    snapshot = Object.freeze({
      items: Object.freeze(items.map(({ originalError: _originalError, ...item }) => Object.freeze({ ...item }))),
      busy: active !== null,
      blocked: items.some(item => ['upload-unknown', 'association-pending', 'failed'].includes(item.state)),
    });
    for (const listener of listeners) { try { listener(); } catch { /* Consumer notification cannot change the queue receipt. */ } }
  };
  const invalidate = (): void => { epoch++; active = null; items = []; scope = null; emit(); };
  const associate = async (item: InternalItem<T>, generation: number): Promise<boolean> => {
    if (!current(generation) || !item.ref) return false;
    item.state = 'associating'; item.message = undefined; emit();
    if (!current(generation)) return false;
    const callbackScope: UploadCallbackScope = {
      isCurrent: () => current(generation),
      assertCurrent: () => {
        if (!current(generation)) {
          const error = new Error('Upload callback scope is no longer current');
          error.name = 'AbortError';
          throw error;
        }
      },
    };
    try {
      await options.associate(item.ref, item.context, callbackScope);
    } catch (error) {
      if (current(generation)) { item.state = 'association-pending'; item.message = messageOf(error); emit(); }
      return false;
    }
    if (!current(generation)) return false;
    item.state = 'confirmed'; item.originalError = undefined; emit();
    if (!current(generation)) return false;
    try { await options.onConfirmed?.(item.ref, item.context, callbackScope); }
    catch (error) { if (current(generation)) { item.refreshError = messageOf(error); emit(); } }
    return current(generation);
  };
  const upload = async (item: InternalItem<T>, generation: number): Promise<boolean> => {
    if (!current(generation)) return false;
    item.state = 'uploading'; emit();
    if (!current(generation)) return false;
    try {
      const ref = await options.service.upload(item.file, {
        onProgress: progress => { if (current(generation)) { item.progress = progress; emit(); } },
      });
      if (!current(generation)) return false;
      item.ref = ref;
    } catch (error) {
      if (current(generation)) {
        item.message = messageOf(error);
        if (error instanceof FileUploadError && error.resultUnknown) { item.state = 'upload-unknown'; item.originalError = error; }
        else item.state = 'failed';
        emit();
      }
      return false;
    }
    return associate(item, generation);
  };
  const drain = async (generation: number): Promise<boolean> => {
    while (current(generation)) {
      const item = items.find(value => value.state !== 'confirmed');
      if (!item) return true;
      if (item.state !== 'queued' || !(await upload(item, generation))) return false;
    }
    return false;
  };
  const run = async (action: (generation: number) => Promise<boolean>): Promise<boolean> => {
    if (disposed || !scope || active) return false;
    const generation = epoch, token = {};
    active = token; emit();
    try { return await action(generation); }
    finally { if (active === token) { active = null; emit(); } }
  };
  const recover = async (id: string, verify: boolean): Promise<boolean> => {
    const item = items.find(value => value.id === id);
    if (!item || item.state !== (verify ? 'upload-unknown' : 'association-pending')) return false;
    return run(async generation => {
      if (!current(generation)) return false;
      if (verify) {
        if (!item.originalError) return false;
        try {
          const ref = await options.service.verifyUpload(item.originalError);
          if (!current(generation)) return false;
          item.ref = ref;
        } catch (error) {
          if (current(generation)) { item.message = messageOf(error); emit(); }
          return false; // Keep the original error; a verification error is not the upload error.
        }
      }
      return (await associate(item, generation)) && drain(generation);
    });
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    setScope: next => {
      if (disposed) return;
      if (scope?.ownerId === next?.ownerId && scope?.parentId === next?.parentId) return;
      invalidate(); scope = next ? Object.freeze({ ...next }) : null; emit();
    },
    invalidate,
    enqueue: async (files, data) => {
      if (disposed || !scope?.ownerId || !scope.parentId || active || pending() || files.length === 0) return false;
      const context: UploadQueueContext<T> = Object.freeze({ ...scope, data: Object.freeze({ ...data }) });
      items = files.map(file => ({ id: String(++sequence), file, context, state: 'queued' }));
      return run(drain);
    },
    verify: id => recover(id, true),
    retryAssociation: id => recover(id, false),
    clear: () => {
      if (active || items.some(item => ['upload-unknown', 'association-pending', 'associating'].includes(item.state))) return false;
      items = []; emit(); return true;
    },
    dispose: () => { if (!disposed) { invalidate(); disposed = true; listeners.clear(); } },
  };
}
