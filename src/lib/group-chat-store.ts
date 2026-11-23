// 群聊数据层：群列表持久化 + 群聊天记录 + 私聊记忆双向同步（群→私镜像双写、私→群摘要读取）
import type { ChatEntry, Character } from "./chat-types";
import { displayName } from "./chat-types";
import { usePersisted } from "./chat-store";

export interface GroupChat {
  id: string;
  name: string;
  /** 成员角色 id（顺序即头像展示序） */
  memberIds: string[];
  createdAt: number;
  /** 群剧情模式：开启后回复为叙事段落而非碎句气泡 */
  storyMode?: boolean;
}

const GROUPS_KEY = "vp-phone:groups:v1";
const GLOG_PREFIX = "vp-phone:groupchat-log:";
const LOG_PREFIX = "vp-phone:rolechat-log:";

export function useGroups(): [GroupChat[], (next: GroupChat[] | ((prev: GroupChat[]) => GroupChat[])) => void] {
  return usePersisted<GroupChat[]>(GROUPS_KEY, []);
}

export function readGroups(): GroupChat[] {
  try {
    return JSON.parse(localStorage.getItem(GROUPS_KEY) || "[]") as GroupChat[];
  } catch {
    return [];
  }
}

export function groupLogKey(groupId: string): string {
  return `${GLOG_PREFIX}${groupId}`;
}

/** 群聊天记录 hook（与私聊 useChatLog 同构，key 变化自动重读） */
export function useGroupLog(groupId: string): [ChatEntry[], (next: ChatEntry[] | ((prev: ChatEntry[]) => ChatEntry[])) => void] {
  return usePersisted<ChatEntry[]>(groupLogKey(groupId), []);
}

export function readGroupLog(groupId: string): ChatEntry[] {
  try {
    return JSON.parse(localStorage.getItem(groupLogKey(groupId)) || "[]") as ChatEntry[];
  } catch {
    return [];
  }
}

export function writeGroupLog(groupId: string, entries: ChatEntry[]): void {
  try {
    localStorage.setItem(groupLogKey(groupId), JSON.stringify(entries));
  } catch {
    /* 隐私模式忽略 */
  }
}

/** 会话列表排序/预览用：群最后一条非提示消息 */
export function readGroupLast(groupId: string): ChatEntry | null {
  const log = readGroupLog(groupId).filter((e) => !e.groupTip);
  return log.length ? log[log.length - 1] : null;
}

export function clearGroupLog(groupId: string): void {
  writeGroupLog(groupId, []);
}

export function newGroupId(): string {
  return `g${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

/** 群聊协议：拼入群内每位角色的 system——多人场景文体约束 */
export const GROUP_PROTOCOL =
  "\n【群聊场景】你现在在一个多人小群里，群里有你和别的角色，还有对方（用户）。规则：" +
  "只扮演你自己，绝对不许替其他角色说话、也不许描写他们的神情动作；" +
  "群里说的话所有人都看得见，你可以自然接住别人刚说的话（吐槽、拆台、护短都行，符合你的性格）；" +
  "对方（用户）在群里 @ 你时优先回应她；没点到你时你也可以插话，但要克制，一轮最多发你要表达的一件事；" +
  "保持你自己的说话习惯和条数节奏，不同人风格必须明显不同。";

/**
 * 群消息 → 各成员私聊记忆镜像（方案A双写）：
 * - 某角色在群里说的话 → 原样进她的私聊 log（她记得自己说过什么）
 * - 用户在群里说的话 → 「[群聊] 你在「群名」说：…」进每位在场成员私聊
 * - 其他角色在群里说的话 → 「[群聊] ${名字}说：…」第三人称旁白进该成员之外的人的私聊？不——
 *   统一策略：每位成员的私聊里，自己的话第一人称原样、用户的话带前缀、别的角色话写成旁白。
 * 幂等：同一 entry.id 在某成员私聊已存在镜像则跳过；镜像条目自身不再二次镜像。
 */
export function mirrorToMembers(group: GroupChat, entry: ChatEntry, members: Character[]): void {
  for (const ch of members) {
    if (!ch || ch.blocked) continue;
    const key = `${LOG_PREFIX}${ch.id}`;
    let prev: ChatEntry[];
    try {
      prev = JSON.parse(localStorage.getItem(key) || "[]") as ChatEntry[];
    } catch {
      continue;
    }
    // 幂等：同 id 镜像已存在则跳过
    if (prev.some((e) => e.mirroredFrom === group.id && e.id === entry.id)) continue;
    const who = entry.senderId ? members.find((m) => m.id === entry.senderId) : null;
    const speakerName = who ? displayName(who) : "";
    let mirrored: ChatEntry | null = null;
    if (entry.role === "assistant" && entry.senderId === ch.id) {
      // 她自己说的：第一人称原样进她的私聊
      mirrored = { ...entry, senderId: undefined, mirroredFrom: group.id };
    } else if (entry.role === "user") {
      const text = entry.transfer
        ? `[群聊] 你在「${group.name}」给${speakerName || "大家"}转了账 ¥${entry.transfer.amount.toFixed(2)}（备注：${entry.transfer.note}）`
        : entry.order
          ? `[群聊] 你在「${group.name}」点了${entry.order.kind === "gift" ? "礼物" : "外卖"}：${entry.order.shop}`
          : entry.location
            ? `[群聊] 你在「${group.name}」分享了位置：${entry.location.place}`
            : `[群聊] 你在「${group.name}」说：${entry.content}`;
      mirrored = { id: entry.id, role: "user", content: text, at: entry.at, mirroredFrom: group.id };
    } else if (entry.role === "assistant" && entry.senderId && entry.senderId !== ch.id) {
      // 别家角色说的：第三人称旁白，让她知道群里发生过
      mirrored = {
        id: entry.id,
        role: "user",
        content: `[群聊] ${group.name}里 ${speakerName}说：${entry.content}`,
        at: entry.at,
        mirroredFrom: group.id,
      };
    }
    if (!mirrored) continue;
    try {
      localStorage.setItem(key, JSON.stringify([...prev, mirrored]));
      console.log(`[group] mirror → char=${ch.id} entry=${entry.id} kind=${entry.role}`);
    } catch {
      /* 配额满忽略 */
    }
  }
}

/** 私→群记忆桥：某成员与该用户的私聊最近 n 条摘要（喂群聊 system，让群里接得住私聊话题） */
export function privateDigestFor(charId: string, n = 6): string {
  try {
    const log = (JSON.parse(localStorage.getItem(`${LOG_PREFIX}${charId}`) || "[]") as ChatEntry[])
      .filter((e) => !e.failed && !e.queued && !e.groupTip)
      .slice(-n);
    if (!log.length) return "";
    const lines = log.map((e) => {
      const t = e.content.replace(/\s+/g, " ").slice(0, 40);
      if (e.mirroredFrom) return `- ${t}`;
      return e.role === "user" ? `- 你说：${t}` : `- 我说：${t}`;
    });
    return "\n【你和对方最近的私聊（群里可以自然提起，但别逐句复述）】\n" + lines.join("\n");
  } catch {
    return "";
  }
}
