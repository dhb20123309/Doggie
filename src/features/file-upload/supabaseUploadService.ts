// 来源 Skill：file-upload。接入先加载/复用该 Skill，按 skills/file-upload/SKILL.md 阅读接入说明。

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  assertAllowedExtension,
  getFileExtension,
  normalizeAllowedExtensions,
  normalizeAllowedMimeTypes,
  sanitizeDownloadName,
  sanitizeObjectName,
} from './filePolicy';
import { createSupabaseUploadIdentityProvider } from './supabaseUploadIdentity';
import {
  DEFAULT_MAX_FILE_SIZE_BYTES,
  DEFAULT_SIGNED_URL_EXPIRE_SECONDS,
  FileUploadError,
  MAX_SIGNED_URL_EXPIRE_SECONDS,
  type AccessUrlOptions,
  type FileUploadService,
  type SupabaseUploadServiceConfig,
  type UploadFile,
  type UploadIdentity,
  type UploadOptions,
  type UploadedFile,
  type UploadOwnership,
  type UploadProgress,
  type UploadVisibility,
} from './types';

interface NormalizedConfig {
  supabase: SupabaseClient;
  bucket: string;
  pathPrefix: string;
  ownership: UploadOwnership;
  visibility: UploadVisibility;
  maxFileSizeBytes: number;
  allowedExtensions: readonly string[] | undefined;
  allowedMimeTypes: readonly string[] | undefined;
}

function invalid(message: string, cause?: unknown): FileUploadError {
  return new FileUploadError('INVALID_CONFIGURATION', message, { cause });
}

function normalizePathPrefix(value: string | undefined): string {
  const prefix = (value ?? 'uploads').trim().replace(/^\/+|\/+$/g, '');
  if (
    !prefix
    || prefix.length > 128
    || prefix.includes('..')
    || prefix.split('/').some(segment => !/^[A-Za-z0-9_-]{1,64}$/.test(segment))
  ) {
    throw invalid('对象路径前缀无效。');
  }
  return prefix;
}

function normalizeConfig(config: SupabaseUploadServiceConfig): NormalizedConfig {
  if (!config || typeof config !== 'object' || !config.supabase) {
    throw invalid('上传必须复用已创建的 Supabase Client。');
  }
  const bucket = config.bucket.trim();
  const ownership = config.ownership ?? 'none';
  const visibility = config.visibility ?? 'public';
  const maxFileSizeBytes = config.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE_BYTES;
  if (
    !/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(bucket)
    || !['none', 'user'].includes(ownership)
    || !['public', 'private'].includes(visibility)
    || (visibility === 'private' && ownership !== 'user')
    || !Number.isSafeInteger(maxFileSizeBytes)
    || maxFileSizeBytes <= 0
    || maxFileSizeBytes > DEFAULT_MAX_FILE_SIZE_BYTES
  ) {
    throw invalid('文件上传配置无效。');
  }
  return {
    supabase: config.supabase,
    bucket,
    pathPrefix: normalizePathPrefix(config.pathPrefix),
    ownership,
    visibility,
    maxFileSizeBytes,
    allowedExtensions: normalizeAllowedExtensions(config.allowedExtensions),
    allowedMimeTypes: normalizeAllowedMimeTypes(config.allowedMimeTypes),
  };
}

let fallbackSequence = 0;

function createUniqueSegment(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid.toLowerCase();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  }
  const sequence = (fallbackSequence++).toString(36);
  return `${Date.now().toString(36)}-${sequence}-${Math.random().toString(36).slice(2)}`;
}

function createObjectPath(
  config: NormalizedConfig,
  identity: UploadIdentity,
  originalName: string,
): string {
  const segment = `${createUniqueSegment()}-${sanitizeObjectName(originalName)}`;
  return config.ownership === 'user'
    ? `users/${identity.userId}/${config.pathPrefix}/${segment}`
    : `${config.pathPrefix}/${segment}`;
}

function safeObjectPath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 1024
    && !value.startsWith('/')
    && !value.endsWith('/')
    && !value.includes('\\')
    && !value.includes('..')
    && !value.includes('//')
    && !/[\u0000-\u001f\u007f]/.test(value)
    && value.split('/').every(segment => segment.length > 0);
}

function normalizeMetadata(
  value: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid('Storage 元数据配置无效。');
  }
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(key) || typeof item !== 'string' || item.length > 1024) {
      throw invalid('Storage 元数据配置无效。');
    }
    result[key] = item;
  }
  return Object.freeze(result);
}

function normalizeMimeType(file: UploadFile): string {
  const mimeType = (file.type ?? '').trim().toLowerCase() || 'application/octet-stream';
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mimeType)) {
    throw new FileUploadError('INVALID_FILE_TYPE', '文件 MIME 类型无效。');
  }
  return mimeType;
}

function progress(
  uploadedBytes: number,
  totalBytes: number,
): UploadProgress {
  const total = Math.max(1, totalBytes);
  const uploaded = Math.min(Math.max(0, uploadedBytes), total);
  return {
    uploadedBytes: uploaded,
    totalBytes: total,
    percentage: Math.round((uploaded / total) * 100),
  };
}

function withObjectContext(
  error: unknown,
  code: 'STORAGE_UPLOAD_FAILED' | 'ACCESS_URL_FAILED' | 'AUTH_CHANGED',
  bucket: string,
  objectPath: string,
  resultUnknown: boolean,
): FileUploadError {
  if (error instanceof FileUploadError && error.code === code) {
    return new FileUploadError(error.code, error.message, {
      recoverable: error.recoverable,
      bucket,
      objectPath,
      resultUnknown: error.resultUnknown || resultUnknown,
      cause: error,
    });
  }
  if (error instanceof FileUploadError && error.code === 'AUTH_CHANGED') {
    return new FileUploadError('AUTH_CHANGED', error.message, {
      recoverable: true,
      bucket,
      objectPath,
      resultUnknown,
      cause: error,
    });
  }
  return new FileUploadError(
    code,
    code === 'ACCESS_URL_FAILED' ? '无法生成文件访问地址。' : '文件对象写入结果未知；请保留对象引用并核验。',
    { recoverable: true, bucket, objectPath, resultUnknown, cause: error },
  );
}

function assertReference(
  config: NormalizedConfig,
  identity: UploadIdentity,
  reference: UploadedFile,
): void {
  if (
    !reference
    || reference.bucket !== config.bucket
    || reference.visibility !== config.visibility
    || !safeObjectPath(reference.objectPath)
  ) {
    throw new FileUploadError('ACCESS_URL_FAILED', '文件引用不属于当前上传配置。');
  }
  const prefix = config.ownership === 'user'
    ? `users/${identity.userId}/${config.pathPrefix}/`
    : `${config.pathPrefix}/`;
  if (!reference.objectPath.startsWith(prefix)) {
    throw new FileUploadError('ACCESS_URL_FAILED', '文件引用不属于当前用户或路径范围。');
  }
  if (config.ownership === 'user' && reference.ownerId !== identity.userId) {
    throw new FileUploadError('ACCESS_URL_FAILED', '文件引用不属于当前用户。');
  }
}

export function createSupabaseUploadService(
  rawConfig: SupabaseUploadServiceConfig,
): FileUploadService {
  const config = normalizeConfig(rawConfig);
  const identityProvider = createSupabaseUploadIdentityProvider(config.supabase);
  let disposed = false;
  let unknownUploads = new WeakMap<FileUploadError, {
    bytes: Uint8Array;
    identity: UploadIdentity;
    reference: UploadedFile;
  }>();

  const captureIdentity = async (): Promise<UploadIdentity> => {
    if (disposed) throw new FileUploadError('AUTH_CHANGED', '上传服务已释放。');
    const identity = await identityProvider.capture();
    if (config.ownership === 'user' && !identity.userId) {
      throw new FileUploadError('AUTH_REQUIRED', '当前上传需要已登录用户。');
    }
    return identity;
  };

  const assertIdentity = async (identity: UploadIdentity): Promise<void> => {
    if (disposed) throw new FileUploadError('AUTH_CHANGED', '上传服务已释放。');
    await identityProvider.assertCurrent(identity);
    if (config.ownership === 'user' && !identity.userId) {
      throw new FileUploadError('AUTH_REQUIRED', '当前上传需要已登录用户。');
    }
  };

  const notify = (
    callback: UploadOptions['onProgress'],
    value: UploadProgress,
    context?: { bucket: string; objectPath: string },
  ): void => {
    if (!callback) return;
    try {
      callback(value);
    } catch (error) {
      if (context) {
        throw withObjectContext(
          error,
          'STORAGE_UPLOAD_FAILED',
          context.bucket,
          context.objectPath,
          true,
        );
      }
      throw new FileUploadError('INVALID_FILE', '上传进度回调执行失败。', { cause: error });
    }
  };

  return {
    async upload(file: UploadFile, options: UploadOptions = {}): Promise<UploadedFile> {
      if (!file || typeof file !== 'object' || typeof file.arrayBuffer !== 'function') {
        throw new FileUploadError('INVALID_FILE', '文件对象无效。');
      }
      if (!Number.isSafeInteger(file.size) || file.size <= 0) {
        throw new FileUploadError('INVALID_FILE', '不能上传空文件。');
      }
      if (file.size > config.maxFileSizeBytes) {
        throw new FileUploadError('FILE_TOO_LARGE', '文件超过允许的大小上限。');
      }
      const identity = await captureIdentity();
      const originalName = sanitizeDownloadName(typeof file.name === 'string' ? file.name : 'upload');
      const extension = getFileExtension(originalName);
      assertAllowedExtension(extension, config.allowedExtensions);
      const mimeType = normalizeMimeType(file);
      if (config.allowedMimeTypes && !config.allowedMimeTypes.includes(mimeType)) {
        throw new FileUploadError('INVALID_FILE_TYPE', '当前文件 MIME 类型不在允许范围内。');
      }
      const objectPath = createObjectPath(config, identity, originalName);
      const context = { bucket: config.bucket, objectPath };
      const metadata = normalizeMetadata(options.metadata);
      let bytes: ArrayBuffer;
      try {
        bytes = await file.arrayBuffer();
      } catch (error) {
        throw new FileUploadError('INVALID_FILE', '读取文件内容失败。', { cause: error });
      }
      if (bytes.byteLength !== file.size) {
        throw new FileUploadError('INVALID_FILE', '文件内容大小在读取前后不一致。');
      }
      await assertIdentity(identity);

      notify(options.onProgress, progress(0, bytes.byteLength));
      await assertIdentity(identity);

      const reference: UploadedFile = Object.freeze({
        bucket: config.bucket,
        objectPath,
        originalName,
        size: bytes.byteLength,
        mimeType,
        visibility: config.visibility,
        ...(identity.userId ? { ownerId: identity.userId } : {}),
      });
      const originalBytes = new Uint8Array(bytes.slice(0));
      try {
        const { data, error } = await config.supabase.storage
          .from(config.bucket)
          .upload(objectPath, bytes, {
            contentType: mimeType,
            upsert: false,
            metadata,
          });
        if (error || !data || data.path !== objectPath) {
          throw withObjectContext(
            error ?? new Error('Storage did not return the uploaded path'),
            'STORAGE_UPLOAD_FAILED',
            config.bucket,
            objectPath,
            true,
          );
        }
        await assertIdentity(identity);
        notify(options.onProgress, progress(bytes.byteLength, bytes.byteLength), context);
        await assertIdentity(identity);
      } catch (error) {
        const failure = error instanceof FileUploadError
          ? new FileUploadError(error.code, error.message, {
            recoverable: error.recoverable,
            bucket: config.bucket,
            objectPath,
            resultUnknown: true,
            cause: error,
          })
          : withObjectContext(error, 'STORAGE_UPLOAD_FAILED', config.bucket, objectPath, true);
        unknownUploads.set(failure, { bytes: originalBytes, identity, reference });
        throw failure;
      }

      return reference;
    },

    async verifyUpload(error: FileUploadError): Promise<UploadedFile> {
      if (disposed) throw new FileUploadError('AUTH_CHANGED', '上传服务已释放。');
      const retained = unknownUploads.get(error);
      if (!retained) {
        throw new FileUploadError('UPLOAD_VERIFICATION_FAILED', '缺少本次上传核验现场，请保持未确认状态。');
      }
      await assertIdentity(retained.identity);
      try {
        const result = await config.supabase.storage.from(config.bucket).download(retained.reference.objectPath);
        if (result.error || !result.data) throw result.error ?? new Error('Storage did not return object bytes');
        const actual = new Uint8Array(await result.data.arrayBuffer());
        await assertIdentity(retained.identity);
        if (actual.length !== retained.bytes.length || actual.some((value, index) => value !== retained.bytes[index])) {
          throw new Error('Stored bytes differ from the original upload');
        }
        return retained.reference;
      } catch (cause) {
        if (cause instanceof FileUploadError && cause.code === 'AUTH_CHANGED') throw cause;
        // A failed read cannot prove whether the original write happened.
        await assertIdentity(retained.identity);
        throw new FileUploadError('UPLOAD_VERIFICATION_FAILED', '上传尚未确认；保留原现场，只读核验失败。', {
          bucket: config.bucket, objectPath: retained.reference.objectPath,
          resultUnknown: true, recoverable: true, cause,
        });
      }
    },

    async getAccessUrl(reference: UploadedFile, options: AccessUrlOptions = {}): Promise<string> {
      const identity = await captureIdentity();
      assertReference(config, identity, reference);
      await assertIdentity(identity);
      try {
        if (config.visibility === 'public') {
          const { data } = config.supabase.storage.from(config.bucket).getPublicUrl(
            reference.objectPath,
            options.download
              ? { download: sanitizeDownloadName(reference.originalName) }
              : undefined,
          );
          if (!data?.publicUrl) throw new Error('Storage did not return a public URL');
          await assertIdentity(identity);
          return data.publicUrl;
        }

        const expiresIn = options.expiresIn ?? DEFAULT_SIGNED_URL_EXPIRE_SECONDS;
        if (
          !Number.isSafeInteger(expiresIn)
          || expiresIn < 1
          || expiresIn > MAX_SIGNED_URL_EXPIRE_SECONDS
        ) {
          throw new FileUploadError('INVALID_CONFIGURATION', '私有文件访问地址有效期必须是 1 到 3600 秒的整数。');
        }
        if (!identity.userId) throw new FileUploadError('AUTH_REQUIRED', '访问私有文件需要当前登录用户。');
        const { data, error } = await config.supabase.storage
          .from(config.bucket)
          .createSignedUrl(
            reference.objectPath,
            expiresIn,
            options.download
              ? { download: sanitizeDownloadName(reference.originalName) }
              : undefined,
          );
        if (error || !data?.signedUrl) {
          throw error ?? new Error('Storage did not return a signed URL');
        }
        await assertIdentity(identity);
        return data.signedUrl;
      } catch (error) {
        if (error instanceof FileUploadError) {
          if (error.code === 'AUTH_CHANGED' || error.code === 'AUTH_REQUIRED') throw error;
          if (error.code === 'INVALID_CONFIGURATION') throw error;
        }
        throw withObjectContext(
          error,
          'ACCESS_URL_FAILED',
          config.bucket,
          reference.objectPath,
          false,
        );
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      unknownUploads = new WeakMap();
      identityProvider.dispose();
    },
  };
}
