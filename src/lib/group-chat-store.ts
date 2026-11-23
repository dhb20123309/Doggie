// 群聊数据层：群列表持久化 + 群聊天记录 + 历史记忆互通（群消息不写入私聊界面，靠摘要桥互相记得）
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
 * 历史记忆互通·群侧摘要：把该成员所在群的最近消息压成摘要（喂私聊 system）。
 * 群消息只存在群 log 里，绝不写入私聊记录；私聊时模型靠这段摘要"记得"群里发生过什么。
 * characters 用于把 senderId 映射成名字/备注。
 */
export function groupDigestFor(charId: string, characters?: Character[], n = 8): string {
  try {
    const groups = readGroups().filter((g) => g.memberIds.includes(charId));
    if (!groups.length) return "";
    const names = new Map((characters ?? []).map((c) => [c.id, displayName(c)]));
    const parts: string[] = [];
    for (const g of groups) {
      // 发言人名字优先用当前角色数据里的备注（displayName），查不到回落 id
      const log = (readGroupLog(g.id) as ChatEntry[])
        .filter((e) => !e.failed && !e.groupTip)
        .slice(-n);
      if (!log.length) continue;
      const lines = log.map((e) => {
        const t = e.content.replace(/\s+/g, " ").slice(0, 40);
        if (e.role === "user") return `- 你在群里说：${t}`;
        const who = e.senderId ? names.get(e.senderId) ?? e.senderId : "";
        return `- ${who ? `${who}在群里说` : "群里"}：${t}`;
      });
      parts.push(`【群「${g.name}」】\n${lines.join("\n")}`);
    }
    if (!parts.length) return "";
    return "\n【你们最近的群聊记录（私聊时可以自然提起，但别逐句复述，也不要在私聊里假装这些消息发在这里）】\n" + parts.join("\n");
  } catch {
    return "";
  }
}

/**
 * 历史记忆互通·私聊摘要：某成员与该用户的私聊最近 n 条（喂群聊 system，让群里接得住私聊话题）。
 */
export function privateDigestFor(charId: string, n = 6): string {
  try {
    const log = (JSON.parse(localStorage.getItem(`${LOG_PREFIX}${charId}`) || "[]") as ChatEntry[])
      .filter((e) => !e.failed && !e.queued && !e.groupTip)
      .slice(-n);
    if (!log.length) return "";
    const lines = log.map((e) => {
      const t = e.content.replace(/\s+/g, " ").slice(0, 40);
      return e.role === "user" ? `- 你说：${t}` : `- 我说：${t}`;
    });
    return "\n【你和对方最近的私聊（群里可以自然提起，但别逐句复述）】\n" + lines.join("\n");
  } catch {
    return "";
  }
}
