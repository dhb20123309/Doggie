// 来源 Skill：file-upload。接入先加载/复用该 Skill，按 skills/file-upload/SKILL.md 阅读接入说明。
import { FileUploadError } from './types';

const EXTENSION_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const BIDI_CONTROL_PATTERN = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

export function normalizeAllowedExtensions(
  value?: readonly string[],
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new FileUploadError('INVALID_CONFIGURATION', '文件扩展名策略不能为空。');
  }

  const normalized = Array.from(value, extension => {
    if (typeof extension !== 'string') {
      throw new FileUploadError('INVALID_CONFIGURATION', '文件扩展名策略无效。');
    }
    const withoutOneDot = extension.startsWith('.') ? extension.slice(1) : extension;
    const candidate = withoutOneDot.toLowerCase();
    if (!EXTENSION_PATTERN.test(candidate)) {
      throw new FileUploadError('INVALID_CONFIGURATION', '文件扩展名策略无效。');
    }
    return candidate;
  });

  return Object.freeze(Array.from(new Set(normalized)));
}

export function getFileExtension(fileName: string): string | null {
  const trimmedName = fileName.trim();
  const baseName = trimmedName.split(/[\\/]/).pop() ?? trimmedName;
  const dot = baseName.lastIndexOf('.');
  if (dot < 0 || dot === baseName.length - 1) return null;
  return baseName.slice(dot + 1).toLowerCase();
}

export function assertAllowedExtension(
  extension: string | null,
  allowedExtensions?: readonly string[],
): void {
  if (allowedExtensions === undefined) return;
  if (!extension || !allowedExtensions.includes(extension)) {
    throw new FileUploadError(
      'INVALID_FILE_TYPE',
      '当前文件扩展名不在允许的上传类型中。',
      { recoverable: false },
    );
  }
}


export function sanitizeDownloadName(name: string): string {
  const sanitized = name
    // eslint-disable-next-line no-control-regex -- Download names must not carry control bytes.
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
    .replace(/[\\/]/g, '_')
    .replace(BIDI_CONTROL_PATTERN, '')
    .trim();
  return (sanitized || 'download').slice(0, 255);
}

export function normalizeAllowedMimeTypes(
  value?: readonly string[],
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new FileUploadError('INVALID_CONFIGURATION', '文件 MIME 类型策略不能为空。');
  }
  const normalized = value.map(mime => {
    if (typeof mime !== 'string' || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(mime.trim())) {
      throw new FileUploadError('INVALID_CONFIGURATION', '文件 MIME 类型策略无效。');
    }
    return mime.trim().toLowerCase();
  });
  return Object.freeze(Array.from(new Set(normalized)));
}

export function sanitizeObjectName(name: string): string {
  const printable = sanitizeDownloadName(name)
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .trim();
  return (printable || 'upload').slice(0, 120);
}
