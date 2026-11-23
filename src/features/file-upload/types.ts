// 来源 Skill：file-upload。接入先加载/复用该 Skill，按 skills/file-upload/SKILL.md 阅读接入说明。

import type { SupabaseClient } from '@supabase/supabase-js';

/** The built-in core accepts final files up to 50 MiB. */
export const DEFAULT_MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;
export const DEFAULT_SIGNED_URL_EXPIRE_SECONDS = 300;
export const MAX_SIGNED_URL_EXPIRE_SECONDS = 3600;

export type UploadVisibility = 'public' | 'private';
export type UploadOwnership = 'none' | 'user';

export interface UploadProgress {
  uploadedBytes: number;
  totalBytes: number;
  percentage: number;
}

/** A browser File or a compatible attachment object used by Node consumers. */
export interface UploadFile {
  readonly name: string;
  readonly size: number;
  readonly type?: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** Stable metadata returned after the object write is confirmed. */
export interface UploadedFile {
  readonly bucket: string;
  readonly objectPath: string;
  readonly originalName: string;
  readonly size: number;
  readonly mimeType: string;
  readonly visibility: UploadVisibility;
  readonly ownerId?: string;
}

export interface UploadOptions {
  onProgress?: (progress: UploadProgress) => void;
  /** Optional Storage metadata. The core does not derive a checksum or business fields. */
  metadata?: Readonly<Record<string, string>>;
}

export interface AccessUrlOptions {
  download?: boolean;
  expiresIn?: number;
}

export interface SupabaseUploadServiceConfig {
  /** Reuse the generated project client; this module does not create one. */
  supabase: SupabaseClient;
  bucket: string;
  /** Stable technical path prefix. It is not a business record or ACL. */
  pathPrefix?: string;
  ownership?: UploadOwnership;
  visibility?: UploadVisibility;
  /** Per-project limit may be lower, but never higher than 50 MiB. */
  maxFileSizeBytes?: number;
  allowedExtensions?: readonly string[];
  allowedMimeTypes?: readonly string[];
}

export type FileUploadErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'INVALID_FILE'
  | 'INVALID_FILE_TYPE'
  | 'FILE_TOO_LARGE'
  | 'STORAGE_UPLOAD_FAILED'
  | 'UPLOAD_VERIFICATION_FAILED'
  | 'ACCESS_URL_FAILED'
  | 'AUTH_REQUIRED'
  | 'AUTH_CHANGED'
  // Used only by the explicitly copied image processing source.
  | 'CHECKSUM_UNAVAILABLE'
  | 'IMAGE_PROCESSING_FAILED';

export interface FileUploadErrorOptions {
  recoverable?: boolean;
  bucket?: string;
  objectPath?: string;
  /** The request may have reached Storage; callers must retain the reference. */
  resultUnknown?: boolean;
  cause?: unknown;
}

export class FileUploadError extends Error {
  readonly code: FileUploadErrorCode;
  readonly recoverable: boolean;
  readonly bucket?: string;
  readonly objectPath?: string;
  readonly resultUnknown: boolean;

  constructor(
    code: FileUploadErrorCode,
    message: string,
    options: FileUploadErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'FileUploadError';
    this.code = code;
    this.recoverable = options.recoverable ?? false;
    this.bucket = options.bucket;
    this.objectPath = options.objectPath;
    this.resultUnknown = options.resultUnknown ?? false;
  }
}

export interface UploadIdentity {
  readonly userId: string | null;
  readonly epoch: number;
}

export interface UploadIdentityProvider {
  capture(): Promise<UploadIdentity>;
  assertCurrent(identity: UploadIdentity): Promise<void>;
  getEpoch(): number;
  dispose(): void;
}

export interface FileUploadService {
  upload(file: UploadFile, options?: UploadOptions): Promise<UploadedFile>;
  /** Read-only verification of this instance's retained unknown upload; never writes. */
  verifyUpload(error: FileUploadError): Promise<UploadedFile>;
  getAccessUrl(reference: UploadedFile, options?: AccessUrlOptions): Promise<string>;
  dispose(): void;
}
