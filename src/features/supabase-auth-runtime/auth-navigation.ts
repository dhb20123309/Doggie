// 只允许站内 returnTo，避免开放重定向和认证入口循环。
const AUTH_ENTRY_PATHS = new Set([
  '/login',
  '/register',
  '/auth/callback',
  '/reset-password',
]);

function getPathname(path: string): string {
  const boundary = path.search(/[?#]/);
  const pathname = boundary >= 0 ? path.slice(0, boundary) : path;
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export function resolveSafeReturnTo(
  returnTo: string | null | undefined,
  fallback = '/'
): string {
  const candidate = returnTo?.trim();
  if (
    !candidate ||
    !candidate.startsWith('/') ||
    candidate.startsWith('//') ||
    candidate.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return fallback;
  }

  return AUTH_ENTRY_PATHS.has(getPathname(candidate)) ? fallback : candidate;
}

export function buildLoginPath(returnTo: string, loginPath = '/login'): string {
  const safeReturnTo = resolveSafeReturnTo(returnTo);
  return `${loginPath}?returnTo=${encodeURIComponent(safeReturnTo)}`;
}
