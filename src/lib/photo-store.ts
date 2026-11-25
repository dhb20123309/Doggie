// 相册照片的本地持久化（base64 data URL，刷新保留）
import { usePersisted } from "./chat-store";

export interface Photo {
  id: string;
  url: string;
  at: number;
}

const KEY = "vp-phone:photos:v1";

export function usePhotos() {
  return usePersisted<Photo[]>(KEY, []);
}

export function addPhoto(prev: Photo[], url: string): Photo[] {
  return [{ id: `p${Date.now()}${Math.random().toString(36).slice(2, 6)}`, url, at: Date.now() }, ...prev];
}

/** 批量导入：一次写入多张（urls 按选择顺序传入，倒序展开保证最新在前） */
export function addPhotos(prev: Photo[], urls: string[]): Photo[] {
  const now = Date.now();
  const items = urls.map((url, i) => ({ id: `p${now}${i}${Math.random().toString(36).slice(2, 6)}`, url, at: now - (urls.length - 1 - i) }));
  return [...items.reverse(), ...prev];
}

export function removePhoto(prev: Photo[], id: string): Photo[] {
  return prev.filter((p) => p.id !== id);
}
