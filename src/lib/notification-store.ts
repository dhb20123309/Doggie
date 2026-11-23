// 消息通知：设置开关持久化 + 跨组件横幅事件总线（角色发消息时由聊天页发事件，手机壳顶层订阅弹横幅）
import { useEffect, useState } from "react";

const ON_KEY = "vp-phone:notify-on:v1";

/** 通知开关（默认开） */
export function useNotifyOn(): [boolean, (next: boolean | ((p: boolean) => boolean)) => void] {
  const [on, setOn] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ON_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const update = (next: boolean | ((p: boolean) => boolean)) => {
    setOn((prev) => {
      const resolved = next instanceof Function ? next(prev) : next;
      try {
        localStorage.setItem(ON_KEY, resolved ? "1" : "0");
      } catch {
        /* 隐私模式忽略 */
      }
      return resolved;
    });
  };
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === ON_KEY) setOn(localStorage.getItem(ON_KEY) !== "0");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return [on, update];
}

export interface NotifyPayload {
  charId: string;
  name: string;
  /** 头像：emoji 或图片 URL（角色 avatar 原样传入） */
  avatar: string;
  text: string;
  /** 主动消息 / 外卖礼物等富卡片来源标记 */
  tag?: string;
}

const EVT_SHOW = "vp-notify:show";
const EVT_OPEN = "vp-notify:open";

/** 聊天页调用：请求弹出横幅（PhoneShell 未挂载/关闭通知时无人订阅，静默丢弃即可） */
export function emitNotify(p: NotifyPayload) {
  try {
    window.dispatchEvent(new CustomEvent(EVT_SHOW, { detail: p }));
  } catch {
    /* ignore */
  }
}

/** PhoneShell 订阅：收到通知事件时回调 */
export function onNotify(cb: (p: NotifyPayload) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<NotifyPayload>).detail);
  window.addEventListener(EVT_SHOW, h);
  return () => window.removeEventListener(EVT_SHOW, h);
}

/** 点横幅跳转会话：先设活跃角色再请求切屏（RoleChatApp 挂载时读 active-character:v1） */
export function requestOpenChat(charId: string) {
  try {
    localStorage.setItem("vp-phone:active-character:v1", charId);
    window.dispatchEvent(new CustomEvent(EVT_OPEN, { detail: { charId } }));
  } catch {
    /* ignore */
  }
}

/** PhoneShell 订阅：横幅被点击，需要跳到 rolechat 屏幕 */
export function onOpenChat(cb: (charId: string) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<{ charId: string }>).detail.charId);
  window.addEventListener(EVT_OPEN, h);
  return () => window.removeEventListener(EVT_OPEN, h);
}
