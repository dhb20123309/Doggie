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

export function removePhoto(prev: Photo[], id: string): Photo[] {
  return prev.filter((p) => p.id !== id);
}
