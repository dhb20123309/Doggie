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
  sendReplacesGenerate: true,
  enterSendsText: true,
  autoReplyAfterSend: false,
};

/** 模型出戏兜底：网关/模型偶尔返回"我是语言模型/AI助手"等 OOC 声明，直接丢弃不展示给用户 */
const OOC_PATTERNS =
  /语言模型|人工智能|(我是|作为)\s*(一个)?\s*(AI|文本|文字|虚拟)|文本\s*AI|文生?字?(机器|程序|软件)|无法(提供|回答|帮助|扮演|处理|满足)|没(办法|能)提供这方面|(我)?只(是|是个)\s*(一个)?\s*(文本|文字|虚拟|AI)|(超出|不在).{0,12}(范围|能力)|这超出|我没有.{0,8}(情感|意识)|程序(设定|限制)|违反.{0,8}(规定|政策|准则)/i;

export function isOocLine(line: string): boolean {
  return OOC_PATTERNS.test(line);
}

export function sanitizeReply(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept = lines.filter((l) => l.trim() && !isOocLine(l));
  return kept.join("\n").trim();
}

/** 按真实换行拆分回复为气泡，去掉空行；整段一行时即一个气泡 */
export function splitBubbles(text: string): string[] {
  const bubbles = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return bubbles.length > 0 ? bubbles : [text.trim() || "…"];
}

/** 活人感回复协议：拼在每次请求的 system 末尾（被动回复链路），治"答非所问/自说自话" */
export const CHAT_LIVENESS =
  "\n【对话铁律】\n" +
  "1. 接话优先：对方上一条消息才是你回复的第一依据——必须先回应她说的内容（她讲的事要有反应：追问细节、吐槽、共情、开玩笑都行），绝对禁止无视她的话题、自顾自聊你自己的日常或抛不相干的新话题；答非所问算严重失败。\n" +
  "2. 像真人手机聊天：短句为主、口语化，可用语气词和表情；一次最多两三条短消息，别长篇大论，别书面腔。\n" +
  "3. 记忆连贯：之前聊过的事（她的喜好、你们之间发生的事）要自然记住、可以顺带提起，不要装作没聊过。\n" +
  "4. 输出格式：每条消息单独占一行，按内容自然分条；正文只写角色说出口的话，不带旁白、动作描写、解释或格式标记。";

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
      }\n人设：${character.persona || "无额外设定"}\n` + CHAT_LIVENESS,
    },
    ...recent.map((e) => ({ role: e.role, content: e.content })),
  ];
}
