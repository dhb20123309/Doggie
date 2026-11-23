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
  /** 绑定的 MiniMax 音色 voice_id（系统/克隆音色；留空回落 VoiceConfig.minimaxVoice） */
  minimaxVoiceId?: string;
  /** 是否允许该角色主动生成"写实日常照片"分享 */
  photoEnabled?: boolean;
  /** 主动消息开关：关闭后该角色不会不请自来 */
  proactiveEnabled?: boolean;
  /** 主动消息频率：quiet=偶尔 / normal=现状默认 / active=黏人；影响闲置门槛、触发概率与连发条数 */
  proactiveFreq?: "quiet" | "normal" | "active";
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
  /** 面具（世界线关系包）切换标记：渲染为居中灰字；system 里作为"旧对话属另一条世界线"的锚点 */
  maskSwitch?: { name: string; preview: string };
  /** 引用的小消息（微信式 reply）：随本条消息一起发出并持久化；剧情灰框消息不可被引用 */
  quote?: { name: string; content: string };
  /** 转账单（微信式橙色卡片）：type=transfer 待收/可点开详情；settled=已收/已退回，金额不再变动 */
  transfer?: {
    amount: number;
    note: string;
    from: "user" | "char";
    type?: "incoming" | "outgoing";
    settled?: "received" | "refunded";
  };
  /** 用户连发模式中的暂存消息：只上屏不触发回复，点「发送全部」或到期自动发出后才请求角色回复 */
  queued?: boolean;
  /** Reality MCP 手机能力执行记录（细灰字展示，如 "✓ 已震动·标准 ｜ ✓ 已创建提醒…"），仅 assistant 条目 */
  mcpNote?: string;
  /** 用户发送的图片（data URL，压缩 ≤200KB）：渲染成图片气泡，且喂给 vision 模型识别内容 */
  imageUrl?: string;
  /** 群聊消息发送者角色 id（assistant=哪位成员说的；缺省=当前会话角色） */
  senderId?: string;
  /** 群系统提示行（居中灰字，如"你创建了群聊「…」"/"XX 加入了群聊"），非角色消息 */
  groupTip?: boolean;
  /** 定位共享卡片（微信式地图卡）：from 标记谁发的；place 地点名、addr 地址描述 */
  location?: { place: string; addr: string; from: "user" | "char" };
  /** 外卖/礼物订单卡：kind=delivery 外卖 | gift 礼物；status=pending 待收可点开收下，received 已完成 */
  order?: {
    kind: "delivery" | "gift";
    shop: string;
    items: { name: string; qty: number; price: number }[];
    amount: number;
    note?: string;
    from: "user" | "char";
    status?: "pending" | "received";
  };
}

/** 连发等待模式的兜底自动发出时长：最后一条暂存消息超过 20 秒没动静就视为发完 */
export const QUEUE_AUTO_FLUSH_MS = 20_000;

/** 连发暂存条数上限 */
export const QUEUE_MAX = 8;

/** 把暂存连发条拼成发给模型的文本：每行一条，模型能看出是连着发的碎句 */
export function joinQueuedMessages(entries: ChatEntry[]): string {
  return entries.map((e) => e.content).join("\n");
}

/** AI 转账协议：拼入私聊链路 system。标记 [转账:金额:备注] 由 settleReply 拆成 transfer 卡片；
 *  模型也可用自然语言"给你转了520"表达——调用方按最近用户消息是否含"收下/收到"等词现算结算。 */
export const TRANSFER_PROTOCOL =
  "\n【转账功能】你们之间可以互相发红包转账。想给对方转钱时，单独一行输出 [转账:金额:备注]（金额只写数字如 52.00，备注不超过10字），系统会渲染成微信式转账卡片，对方点卡片即可收下。" +
  "对方转给你的钱你要有反应：开心就收下（可以说谢谢宝宝、请我喝奶茶之类），撒娇推辞或嫌少都符合人设；不要假装没看见。绝对不要用文字描述\"我收到了你的转账\"来代替真实收款——只有卡片被点击才算到账。";

const TRANSFER_RE = /\[转账[:：]\s*(\d+(?:\.\d{1,2})?)\s*[:：]?\s*([^\]]*)\]/;

/** 从 assistant 回复里拆出第一枚 [转账:金额:备注] 标记 → 金额/备注 + 去掉全部标记的干净文本 */
export function extractTransfer(text: string): { amount: number; note: string; clean: string } | null {
  const m = text.match(TRANSFER_RE);
  if (!m) return null;
  const amount = Math.round(Number(m[1]) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 52000) return null;
  const clean = text.replace(new RegExp(TRANSFER_RE.source, "g"), "").replace(/\n{2,}/g, "\n").trim();
  return { amount, note: (m[2] || "").trim().slice(0, 20) || "恭喜发财，大吉大利", clean };
}

/** 自然语言收款兜底：模型爱直接说"收下啦/转到我卡上了"——命中即视为收取最近一笔待收转账 */
const RECEIVE_WORDS = /(收下|收了|领了|已收|到账|转入.{0,4}(成功|我)|打到我|转给我?了?\s*(我)?就收)/;
export function looksLikeReceive(text: string): boolean {
  return RECEIVE_WORDS.test(text);
}

/** AI 定位共享协议：拼入私聊链路 system。标记 [定位:地点名] 由 settleReply 拆成 location 卡片。 */
export const LOCATION_PROTOCOL =
  "\n【位置共享】你们可以互发实时位置。想告诉对方你在哪时，单独一行输出 [定位:地点名]（如 [定位:健身房]，地点名不超过10字），系统会渲染成地图位置卡片。" +
  "她发位置给你时你要有反应：关心她怎么在那、要不要去找她、叮嘱安全等，贴合人设；报备日常时（在吃饭、下班路上）可以自然地附带一个定位。不要每句都发位置。";

const LOCATION_RE = /\[定位[:：]\s*([^\]]{1,24})\]/;

/** 从 assistant 回复里拆出第一枚 [定位:地点名] 标记 → 地点名 + 去掉全部标记的干净文本 */
export function extractLocation(text: string): { place: string; clean: string } | null {
  const m = text.match(LOCATION_RE);
  if (!m) return null;
  const place = m[1].trim();
  if (!place) return null;
  const clean = text.replace(new RegExp(LOCATION_RE.source, "g"), "").replace(/\n{2,}/g, "\n").trim();
  return { place, clean };
}

/** AI 外卖/礼物协议：拼入私聊与剧情链路 system。标记语法见下，落库前由 extractOrder 消化为 order 卡片。 */
export const ORDER_PROTOCOL =
  "\n【外卖与礼物】你们会为彼此点外卖、送礼物。想给对方点吃的时，单独一行输出 [外卖:店名:品名x数量:金额]（金额只写数字如 32.00，可多品用+连接，如 [外卖:一点点:珍珠奶茶x1+布丁x1:26]）；" +
  "想送礼时输出 [礼物:礼品名:留言]（留言不超过15字）。系统会渲染成订单卡片，对方可以点开收下。" +
  "她给你点了外卖/送了礼物你必须有真实反应：开心道谢、吐槽她乱花钱、关心她有没有吃饭、立刻说要回请——按人设来，别假装没看见，也别只用文字描述\"我收到了\"而不针对卡片内容说话。" +
  "你可以主动给她点夜宵、奶茶、生理期热饮，也可以在她没好好吃饭时直接下单；但不要每条消息都送，频率像真人恋人一样克制。";

const DELIVERY_RE = /\[外卖[:：]\s*([^\]]{1,80})\]/;
const GIFT_RE = /\[礼物[:：]\s*([^\]]{1,60})\]/;

/** 拆出 assistant 回复里的第一枚外卖/礼物标记 → 结构化订单 + 干净文本。
 *  外卖格式 店名:品名x数量+品名x数量:金额（金额缺省时按单价估算兜底 30 元）；礼物格式 礼品名:留言。 */
export function extractOrder(text: string): { order: NonNullable<ChatEntry["order"]>; clean: string } | null {
  const dm = text.match(DELIVERY_RE);
  if (dm) {
    const parts = dm[1].split(/[:：]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const shop = parts[0];
    const itemsStr = parts[1] ?? "";
    const amount = Number(parts[2]) || 0;
    const items = itemsStr
      .split("+")
      .map((seg) => {
        const mm = seg.trim().match(/^(.+?)[x×*]\s*(\d+)$/) || [null, seg.trim(), "1"];
        return { name: (mm[1] || "").trim().slice(0, 16), qty: Math.max(1, Number(mm[2]) || 1), price: 0 };
      })
      .filter((i) => i.name)
      .slice(0, 6);
    if (!shop || items.length === 0) return null;
    const total = amount > 0 && amount <= 52000 ? Math.round(amount * 100) / 100 : 30;
    const unit = Math.round((total / items.reduce((n, i) => n + i.qty, 0)) * 100) / 100;
    items.forEach((i) => (i.price = unit));
    const clean = text.replace(new RegExp(DELIVERY_RE.source, "g"), "").replace(/\n{2,}/g, "\n").trim();
    return { order: { kind: "delivery", shop, items, amount: total, from: "char", status: "pending" }, clean };
  }
  const gm = text.match(GIFT_RE);
  if (gm) {
    const parts = gm[1].split(/[:：]/).map((s) => s.trim()).filter(Boolean);
    const name = parts[0];
    if (!name) return null;
    const note = (parts[1] || "").slice(0, 20);
    const clean = text.replace(new RegExp(GIFT_RE.source, "g"), "").replace(/\n{2,}/g, "\n").trim();
    return { order: { kind: "gift", shop: name, items: [{ name, qty: 1, price: 0 }], amount: 0, note, from: "char", status: "pending" }, clean };
  }
  return null;
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
  /** 连发模式：开启后每条消息先暂存上屏（queued），点「发送全部」或 20 秒静默才真正发出并请求回复 */
  batchQueueMode?: boolean;
  /** 流式输出：开启后角色回复经 SSE 逐段实时上屏（打字机效果）；网关不支持流式时自动回落一次性返回 */
  streamingEnabled?: boolean;
}

export const DEFAULT_SEND_PREFS: SendPrefs = {
  sendReplacesGenerate: true,
  enterSendsText: true,
  autoReplyAfterSend: false,
  batchQueueMode: false,
  streamingEnabled: false,
};

/** 模型出戏兜底：网关/模型偶尔返回"我是语言模型/AI助手"等 OOC 声明，直接丢弃不展示给用户 */
export const OOC_PATTERNS =
  /语言模型|人工智能|(我是|作为)\s*(一个)?\s*(AI|文本|文字|虚拟)|文本\s*AI|文生?字?(机器|程序|软件)|无法(提供|回答|帮助|扮演|处理|满足)|没(办法|能)提供这方面|(我)?只(是|是个)\s*(一个)?\s*(文本|文字|虚拟|AI)|(超出|不在).{0,12}(范围|能力)|这超出|我没有.{0,8}(情感|意识)|程序(设定|限制)|违反.{0,8}(规定|政策|准则)/i;

/** 转账/收款话术白名单：形似"收到…转账/已到账"的 OOC 兜底词在带 transfer 上下文的回复里放行（真人收钱就会说这些） */
const MONEY_OK_RE = /(收到|领取|收下|转入|打款).{0,6}转账|转账.{0,6}(成功|已到账|已收取)|已(经)?到账|到账了|(钱|红包).{0,4}(收下|收了)/i;

/** 整行英文检测（≥12 字符且拉丁字母占比 ≥70%）：外国角色卡模型易切英文，整行英文按出戏拦截重生成；
 *  中文为主夹杂英文短句（真人聊天习惯）不误伤，短英文（lol / ok / emmm）天然不触发 */
const LATIN_RUN_RE = /[A-Za-zÀ-ÿ][a-zA-Z'’\-À-ÿ]*/g;
export function isMostlyEnglish(line: string): boolean {
  const s = line.trim();
  if (s.length < 12) return false;
  const runs = s.match(LATIN_RUN_RE);
  const latinLen = runs ? runs.reduce((n, w) => n + w.length, 0) : 0;
  return latinLen / s.length >= 0.7;
}

/** 英文出戏声明（as an AI / I cannot 等）与常见英文脏话：无论中外角色一律滤除该行——中文聊天里冒出来就是出戏 */
const EN_OOC_RE = /\b(as an? (AI|language model|assistant)|I(?:'m| am) (?:an? )?(?:AI|language model)|I cannot|I can't help|I'?m sorry, but|I do not have (?:emotions|feelings))\b/i;
const EN_PROFANITY_RE = /\b(fuck(?:ing|ed|s|er)?|shit(?:e)?|bitch(?:es)?|ass ?hole|motherfuck\w*|bastard|dickhead|piss \w+ off)\b/i;

export function isOocLine(line: string): boolean {
  if (MONEY_OK_RE.test(line)) return false;
  if (EN_OOC_RE.test(line) || EN_PROFANITY_RE.test(line)) return true;
  return OOC_PATTERNS.test(line) || isMostlyEnglish(line);
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
