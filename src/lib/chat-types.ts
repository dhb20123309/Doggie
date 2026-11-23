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
  /** 互动剧情模式（对标 Mufy）：开启后聊天走第三人称剧情链路，与普通私聊互通同一份记忆 */
  storyMode?: boolean;
  /** 会话备注名（微信式"设置备注和标签"，显示优先于角色本名） */
  alias?: string;
  /** 拉黑彩蛋：true 时聊天页变灰、TA 的消息被拦截为"消息已发出，但被对方拒收" */
  blocked?: boolean;
}

/** 展示名：备注优先 */
export function displayName(ch: Character): string {
  return ch.alias?.trim() || ch.name || "未命名角色";
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
  /** 互动剧情模式产出的内容：渲染为聊天区中间浅灰剧情框，不用普通气泡 */
  story?: boolean;
  /** 拉黑后的拒收系统提示（居中灰字，非角色消息） */
  blockedTip?: boolean;
  /** 引用的小消息（微信式 reply）：随本条消息一起发出并持久化；剧情灰框消息不可被引用 */
  quote?: { name: string; content: string };
}

/** AI 引用历史消息协议：拼入私聊链路 system（编号表由调用方现算追加）。
 *  标记语法仿 [表情:名字]，落库前由 extractQuote 消化为 ChatEntry.quote。 */
export const QUOTE_PROTOCOL =
  "\n【引用功能】你可以像真人一样引用对方某句旧话再接吐槽/回应：在回复的第一行单独写 [引用:N]（N 见下方编号表），第二行起写你要说的话，系统会自动渲染成气泡内嵌的引用小块。" +
  "只在真的想回指某句旧话时才用，别每条都引用；标记必须占第一行且只有它自己，不要写在句子中间，也不要自己打「引用」二字模仿它。";

const QUOTE_RE = /^\s*\[引用[:：]\s*(\d+)\]/;

/** 拆出 assistant 回复开头的 [引用:N] 标记 → 序号 + 去掉标记的干净文本（无效/越界由调用方按 null 处理） */
export function extractQuote(text: string): { idx: number | null; clean: string } {
  const m = text.match(QUOTE_RE);
  if (!m) return { idx: null, clean: text };
  return { idx: Number(m[1]), clean: text.slice(m[0].length).replace(/^[\s:：,，]+/, "") };
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
  "4. 输出格式：每条消息单独占一行，按内容自然分条；正文只写角色说出口的话，不带旁白、动作描写、解释或格式标记。\n" +
  "5. 禁止复读：绝对不许重复你自己之前说过的句子和口头禅——翻一遍上面的历史，说过的心事、夸过的话、用过的开场不要再原样说来；同一件事换新的角度、新的说法，或者干脆开新话题。连续几天聊过的事就别天天提。像真人一样：每天说的话都不一样。";

/** 互动剧情模式协议（对标 Mufy）：拼入剧情链路 system，玩家第二人称、男主第三人称 */
export const STORY_PROTOCOL = (name: string) =>
  "\n\n【互动剧情模式】当前不是普通私聊，而是一段小说式互动剧情。硬性要求：\n" +
  `1. 人称铁律：玩家角色一律用第二人称"你"叙述；男主「${name || "他"}」一律用第三人称叙述，绝不写成 TA 直接对"你"发消息的口吻。\n` +
  "2. 文笔细腻、节奏平缓递进：现代言情笔法，重氛围、动作、微表情与心理描写；情感推进必须有前因后果的铺垫，禁止突兀升温或无缘由的大情绪。\n" +
  `3. 严格不OOC：${name || "男主"}的一切言行必须贴合其人设与前文行为逻辑；世界书设定与之前剧情是既定事实，禁止推翻、禁止凭空新增设定。\n` +
  "4. 记忆互通完整：上文包含该角色与普通私聊的完整历史，都是已发生的既定事实——必须承接最近情节自然推进，禁止无逻辑、莫名其妙地跳转或推进剧情。\n" +
  '5. 输出格式：只写剧情正文（可含环境/动作/对话描写），一到两段、每段自成一行；不要消息气泡式分条碎句、不要标题/选项/旁白标注/解释或格式标记；不要替"你"做重大决定，把回应空间留给玩家。';

/** 上一条 assistant 消息（最近成功回复里最后一条） */
export function lastAssistantText(entries: ChatEntry[]): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.role === "assistant" && !e.failed) return e.content;
  }
  return "";
}

/** 归一化：去掉空白与中英标点，只留文字内容参与复读比对 */
function normalizeLine(s: string): string {
  return s.replace(/[\s"'“”‘’、。，,.!?！？~～…：:;；()（）\-—_·]/g, "");
}

/** 两行是否近似重复：完全相同，或较长行包含较短行且长度差 ≤4（治"原句+尾巴微调"式复读） */
function nearDup(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [long, short] = a.length >= b.length ? [a, b] : [b, a];
  return short.length >= 8 && long.includes(short) && long.length - short.length <= 4;
}

/** 复读检测：新回复与近期 assistant 历史逐行比对——任一整行与旧句近似重复即判复读。
 *  窗口取最近 6 条、阈值从宽（命中一行即拦），宁可误拦也不放行明显车轱辘话。 */
export function isRepetitiveReply(reply: string, prevEntries: ChatEntry[]): boolean {
  const banned: string[] = [];
  for (const e of prevEntries.slice(-6)) {
    if (e.role !== "assistant" || e.failed) continue;
    for (const l of e.content.split(/\r?\n/)) {
      const t = normalizeLine(l);
      if (t.length >= 5) banned.push(t);
    }
  }
  if (banned.length === 0) return false;
  const lines = reply
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter((s) => s.length >= 5);
  if (lines.length === 0) return false;
  return lines.some((s) => banned.some((b) => nearDup(s, b)));
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
      }\n人设：${character.persona || "无额外设定"}\n` + CHAT_LIVENESS,
    },
    ...recent.map((e) => ({ role: e.role, content: e.content })),
  ];
}
