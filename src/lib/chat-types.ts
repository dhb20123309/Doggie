// 共享契约扩展：单角色聊天（角色设定 + 聊天记录）

export interface Character {
  name: string;
  /** 头像：emoji 或上传图的数据 URL */
  avatar: string;
  persona: string;
  /** 绑定的局部世界书 id */
  boundWorldBookIds?: string[];
}

export const DEFAULT_CHARACTER: Character = {
  name: "小灵",
  avatar: "🌙",
  persona:
    "你叫小灵，是住在这台虚拟手机里的陪伴型 AI 好友。性格温柔、有点俏皮，喜欢用生活化的比喻。\n" +
    "回复方式要像日常微信聊天：把内容按语义自然分成几条短消息，每条单独占一行，行与行之间不要空行；" +
    "不要用列表符号、序号、标题或任何 Markdown 格式；不写旁白、动作描写和解释性文字，只输出角色要说出口的话。" +
    "通常发一到三行，每行不超过二十几个字；对方明确要求详细展开时才可以多分几条。",
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

/** 输入与发送习惯（对应 SullyOS「聊天设置 → 输入与发送」） */
export interface SendPrefs {
  /** 发送按钮代替生成按钮：点发送即请求回复（模式01/04） */
  sendReplacesGenerate: boolean;
  /** 回车发送文字；关闭时回车只暂存草稿（模式02） */
  enterSendsText: boolean;
  /** 发完后自动生成回复：无草稿且停止输入 2 秒后触发（模式03） */
  autoReplyAfterSend: boolean;
}

export const DEFAULT_SEND_PREFS: SendPrefs = {
  sendReplacesGenerate: false,
  enterSendsText: true,
  autoReplyAfterSend: false,
};

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
      }\n人设：${character.persona || "无额外设定"}\n` +
        "重要：像日常聊天一样回复——每条消息单独占一行，按内容自然分条；只输出角色要发来的消息本身，不要任何解释、旁白或格式标记。",
    },
    ...recent.map((e) => ({ role: e.role, content: e.content })),
  ];
}
