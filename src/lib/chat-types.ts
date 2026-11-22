// 共享契约扩展：单角色聊天（角色设定 + 聊天记录）

export interface Character {
  name: string;
  /** 头像：emoji 或上传图的数据 URL */
  avatar: string;
  persona: string;
}

export const DEFAULT_CHARACTER: Character = {
  name: "小灵",
  avatar: "🌙",
  persona:
    "你叫小灵，是住在这台虚拟手机里的陪伴型 AI 好友。性格温柔、有点俏皮，喜欢用生活化的比喻。说话自然口语化，不使用列表和标题格式；每次回复控制在两三句话内，除非对方明确要求详细展开。",
};

/** 聊天页内的消息：assistant 一条回复可拆成多个气泡 */
export interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 发送/生成失败标记，用于展示重试按钮 */
  failed?: boolean;
  at: number;
}

/** 按真实换行拆分回复为气泡，去掉空行；整段一行时即一个气泡 */
export function splitBubbles(text: string): string[] {
  const bubbles = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return bubbles.length > 0 ? bubbles : [text.trim() || "…"];
}

/** 组装发给模型的上下文：人设 system + 最近 20 条记录 + 新消息 */
export function buildHistory(
  character: Character,
  entries: ChatEntry[]
): { role: string; content: string }[] {
  const recent = entries.filter((e) => !e.failed).slice(-20);
  return [
    {
      role: "system",
      content: `你现在扮演以下角色，请始终以该身份第一人称回复，不要跳出角色。\n名字：${
        character.name || "无名角色"
      }\n人设：${character.persona || "无额外设定"}`,
    },
    ...recent.map((e) => ({ role: e.role, content: e.content })),
  ];
}
