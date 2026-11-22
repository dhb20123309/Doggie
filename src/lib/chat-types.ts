// 共享契约扩展：多角色聊天（角色设定 + 分角色聊天记录 + 语音/照片绑定）

export interface Character {
  id: string;
  name: string;
  /** 头像：emoji 或上传图的数据 URL */
  avatar: string;
  persona: string;
  /** 绑定的局部世界书 id */
  boundWorldBookIds?: string[];
  /** 绑定的外部语音音色 id（VoiceConfig.voices 里的 id） */
  voiceId?: string;
  /** 是否允许该角色主动生成"写实日常照片"分享 */
  photoEnabled?: boolean;
  /** 主动消息开关：关闭后该角色不会不请自来 */
  proactiveEnabled?: boolean;
}

/** 聊天页内的消息：assistant 一条回复可拆成多个气泡 */
export interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 发送/生成失败标记，用于展示重试按钮 */
  failed?: boolean;
  at: number;
  /** 角色主动生成的日常照片 URL */
  photoUrl?: string;
  /** 用户手动发送的表情包图片 URL */
  stickerUrl?: string;
  /** 角色主动发来的消息（未打开的会话计未读） */
  proactive?: boolean;
}

/** 会话已读水位：charId → 最后查看时间戳 */
export type ReadMarks = Record<string, number>;

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
