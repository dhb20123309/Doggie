/**
 * hash 路由下的 URL 参数统一读取。
 * GitHub Pages 无 SPA fallback，应用改用 hash history（#/...）后，
 * 直达参数既可能在 ?vpApp=...（search），也可能挂在 #/Doggie/?vpApp=...（hash 内）。
 * 截图验收与 OAuth 回调清理地址栏都依赖这里，避免只读 search 丢参数。
 */
export function readVpParam(key: string): string | null {
  try {
    const sp = new URLSearchParams(window.location.search);
    const v = sp.get(key);
    if (v !== null) return v;
    const h = window.location.hash;
    const q = h.indexOf("?");
    if (q >= 0) return new URLSearchParams(h.slice(q + 1)).get(key);
  } catch {
    /* ignore */
  }
  return null;
}

/** 当前页面是否携带了指定参数（存在即为真，不关心值） */
export function hasVpParam(key: string): boolean {
  return readVpParam(key) !== null;
}
