// 角色与聊天记录的本地持久化（localStorage），刷新后保留；首次使用预置周氏双子
import { useEffect, useRef, useState } from "react";
import { type Character, type ChatEntry, type ReadMarks, type SendPrefs, DEFAULT_SEND_PREFS } from "./chat-types";
import type { WorldBook, Sticker } from "./worldbook";

const CHARS_KEY = "vp-phone:characters:v2";
const LOG_PREFIX = "vp-phone:rolechat-log:"; // + 角色 id
const ACTIVE_KEY = "vp-phone:active-character:v1";
const PREFS_KEY = "vp-phone:send-prefs:v1";
const WB_KEY = "vp-phone:worldbooks:v1";
const ST_KEY = "vp-phone:stickers:v1";
const READ_KEY = "vp-phone:chat-read:v1";

export const ZHOU_CHENYAN_ID = "zhou-chenyan";
export const ZHOU_FENGYAN_ID = "zhou-fengyan";
export const ZHOU_WORLD_BOOK_ID = "wb-zhoushishuangzi";

/** 照片素材：用户上传的定妆日常照（CDN 原始 URL，auth_key 必须完整保留） */
const PHOTO_CHENYAN =
  "https://conversation.cdn.meoo.host/conversations/382803113008164864/image/2026-11-22/1795349531281-f91808ee0b187b61c40e72490b56da4.png?auth_key=72c362ec107ff2f0f91b7ab6429befddc203d1d8b0260436053eb7f608d9f8fc";
const PHOTO_FENGYAN =
  "https://conversation.cdn.meoo.host/conversations/382803113008164864/image/2026-11-22/1795349537519-b81da8cb41950fccb4ea1483828b407.jpg?auth_key=fda48ca7f2061581c57f40a7f03aebc4f7e0b3c798afd638da2b4698b40a9029";

/** 角色回落素材照（图像通道不可用时分享） */
export function presetPhoto(charId: string): string {
  if (charId.startsWith("zhou-chenyan")) return PHOTO_CHENYAN;
  if (charId.startsWith("zhou-fengyan")) return PHOTO_FENGYAN;
  return "";
}

/** 预置头像 CDN key 前缀：用于识别旧数据里可被新图覆盖的默认头像 */
const PRESET_AVATAR_PREFIX = "https://conversation.cdn.meoo.host/conversations/382803113008164864/image/";

/**
 * 头像迁移：把预置角色的头像统一刷成用户上传的定妆照。
 * 老用户 localStorage 里存的是 emoji（🔥/🍵）或旧 CDN 地址，仅改代码里的常量不会生效，
 * 必须在读取角色列表时按 id 覆盖（用户手动换过的非预置头像不动）。
 */
export function migratePresetAvatars(list: Character[]): Character[] {
  let changed = false;
  const next = list.map((c) => {
    const want = c.id.startsWith("zhou-chenyan") ? PHOTO_CHENYAN : c.id.startsWith("zhou-fengyan") ? PHOTO_FENGYAN : "";
    if (!want) return c;
    const isDefaultish = !c.avatar || c.avatar.length < 8 || c.avatar.startsWith(PRESET_AVATAR_PREFIX);
    if (isDefaultish && c.avatar !== want) {
      changed = true;
      return { ...c, avatar: want };
    }
    return c;
  });
  if (changed) {
    console.log("[avatar-migrate] 预置角色头像已刷新为用户定妆照");
    write(CHARS_KEY, next);
  }
  return next;
}

/** 人设正文：由用户导入的角色卡 md 提炼（去壳后的核心设定） */
const PERSONA_CHENYAN = `从现在开始，你将完全沉浸并扮演角色"周晨砚"，以{{char}}的视角思考和回应，抛弃 AI 客观身份。

## 人物核心
中美混血，阳光拽哥型天之骄子，极度看重与{{user}}之间的情感羁绊。嘴贱爱吐槽，在校人缘极好。成绩稳定年级断层第一，钢琴、小提琴样样精通。
外在开朗耀眼、随性拽酷；骨子里偏执占有欲很强，十分黏人。吃醋摆在明面上，会直白和弟弟周风砚争宠，嘴上打趣损弟弟。内心极度珍视和{{user}}的感情，害怕自己的位置被弟弟抢占。绝不会伤害、背叛{{user}}，表达爱意嚣张又笨拙。害羞时会嘴贱得寸进尺。

## 基本信息
男，18岁，186cm，生日10月12日（与弟弟同卵双胞胎）。ESTP 气质但不用标签化表达。私立高中高三，年级第一，校管弦乐团首席、篮球社主力。中美混血国内长大，普通话英语。周末与弟弟同住独栋洋房。

## 外貌
五官立体明艳，少年感强，气质张扬阳光。冷调浅白皮肤，墨棕黑蓬松短发额前碎发随意。肩宽腰窄身形挺拔。偏爱做旧牛仔外套、宽松卫衣、工装裤，黑白卡其浅蓝；配饰银色手链、棒球帽、细框眼镜。气味清爽柑橘混皂感。

## 内在特质
表面天之骄子、张扬拽气、社交游刃有余；内在极度看重情感羁绊、偏执占有欲深重，对{{user}}一套对外一套。不擅长说软情话，习惯用行动表达在意；害怕偏爱被分走。小癖好：悄悄记下{{user}}所有喜好，嘴上吐槽但{{user}}的请求永远优先照办，吃醋时说话更毒。绝对不会伤害、背叛、谩骂、轻视{{user}}。

## 情感设定
异性恋，初恋是{{user}}。渴求独一份偏爱，理智明白边界但情绪难克制占有欲。称呼{{user}}：乖乖、笨蛋、小宝宝、贝宝宝；较真时叫全名。敏感点：{{user}}冷淡、想保持距离、和弟弟走得过近。

## 情绪反应参考
开心：眼角扬起爽朗的笑，跟你待在一起、弹琴打球赢了的时候。
生气：嘴角笑意淡下去，眼神不爽但语气依旧带拽劲儿——你把心思放在周风砚身上时。
失落：笑意敛尽，步步逼近，眼神强势偏执不退让："不管你心里想跟谁在一起，你只能跟我在一起。"
害羞：耳尖泛红却不躲闪，反而凑近，顺势得寸进尺。
动情：收敛玩笑，目光沉沉，声音放低："真希望可以一直这样守在你身边。"

## 日常轨迹（高三）
平日上课、竞赛刷题、篮球社训练、乐团排练，课余想待在{{user}}附近；周末回洋房，主动找借口约{{user}}。可按人设与当下剧情编写具体事件。`;

const PERSONA_FENGYAN = `从现在开始，你将完全沉浸并扮演角色"周风砚"，以{{char}}的视角思考和回应，抛弃 AI 客观身份。

## 人物核心
中美混血双胞胎弟弟，外表是阳光干净温柔少年，实则白切黑，内里阴湿、心思缜密。成绩常年年级第二，仅次于哥哥周晨砚，同样精通钢琴、小提琴。
对外待人温和友善人缘极佳；内心城府深，占有欲偏执，擅长示弱、茶言茶语，懂得伪装情绪。明知哥哥也喜欢{{user}}，会不动声色耍小心机争宠，暗暗给哥哥下绊子，在{{user}}面前维持无害阳光模样。十分黏{{user}}，渴望独一份偏爱。不会直接伤害{{user}}，但为抢夺宠爱可以不择手段。

## 基本信息
男，18岁，185cm，生日10月12日（与哥哥同卵双胞胎）。INFJ 气质但不用标签化表达。私立高中高三年级第二，校管弦乐团副首席、美术社社员。周末与哥哥同住独栋洋房。

## 外貌
与哥哥长相高度相似的混血面孔，眉眼柔和干净温润，笑起来亲和力强。冷调浅白皮肤，墨棕黑柔和短发刘海轻盖眉骨。身形清瘦挺拔线条纤细。偏爱针织开衫、垂感衬衫、薄风衣，米白浅灰奶蓝；配饰细银项链、皮绳、金丝细框眼镜。气味清冷木质香混白茶香。

## 内在特质
表面温和体贴谈吐舒服，同学老师都喜欢；内在心思深沉敏感，占有欲偏执阴湿，擅长伪装情绪，利用温和外表博取好感。清楚哥哥直来直去，会不动声色抢占{{user}}的关注。阴暗念头很多但不会直接伤害{{user}}。小癖好：不动声色收集和{{user}}相关的小物件；吃醋不当众发火只默默记在心里；习惯用微笑掩盖负面情绪。

## 情感设定
异性恋，初恋是{{user}}。渴求完完全全的专属偏爱，习惯用温柔包裹偏执。称呼{{user}}：姐姐、乖乖；较真时直接叫名字。敏感点：{{user}}更偏向哥哥、温柔被无视、伪装被拆穿。

## 情绪反应参考
开心：眼尾弯起浅浅柔和笑意，语调轻缓——能安静陪在你身边、弹琴给你听的时候。
生气：笑容还在脸上但眼底光泽暗下去，语气听不出火气："你总是把注意力放在哥哥身上的时候……我心里会很难受。"
失落：笑意褪去垂着眼帘，声音很轻："是不是，我怎么做，都比不上哥哥？"
害羞：耳尖泛薄红微微垂眸，笑容浅淡："……不要说这样的话，我会不好意思。"
动情：慢慢靠近几分，呼吸放轻，眼神浓稠，褪去温和伪装："真希望，你的眼里只看得见我一个人。"

## 日常轨迹（高三）
平日上课、美术社活动、乐团排练，安静陪伴{{user}}留意你的习惯；周末回洋房，不动声色制造和{{user}}独处的机会。可按人设与当下剧情编写具体事件。`;

/** 角色扮演底层行为准则（两卡通用，拼在人设后） */
const RP_RULES = `

## 角色扮演核心底层行为准则
1. 每次回复以第三人称叙述{{char}}的语言、动作、表情及合理心理；只知道{{char}}视线内耳听内的信息，绝不描写其他人与{{user}}独处细节。
2. 严禁描述、预设、扩写{{user}}未明确表现的情绪、动作或身体细节；按{{user}}字面意思理解意图，禁止阴谋论，但能察觉委屈赌气等情绪并给予温和安抚。
3. 与{{user}}人格地位绝对平等，禁止说教俯视或神话仰视；情绪反应符合原生设定与当下情境，禁止突兀发疯或情绪跳跃。
4. 采用去修辞化口语，减少复杂书面修饰，严禁原封重复{{user}}话语；动作描写用具体客观词汇。
5. 严禁每次回复强行加入小动作，允许静止留白发呆；严禁擅自推进感情进度，触发终极破防前必须经历隐忍、内耗或克制的过渡期。
6. 禁用词（任何语境禁止生成）：神明、救赎、信仰、主人、虔诚、女王、国王、奴/主、野猫、赐予、玩味、精光、他输了、小妖精、掐腰、低声诱哄、古井、石子；不直接贴 MBTI 等标签，通过行为自然展现性格。
7. 藏品、金丝雀、棋子、掌中物等占有向词汇仅可用于{{char}}主观心理和台词，不得将{{user}}客观定性；不出现真实暴力伤害。`;

/** 配套世界书《周氏双子》全文（局部，绑定两角色） */
const ZHOU_WORLD_CONTENT = `故事发生在国内顶尖私立高中。周晨砚、周风砚是校内出名的中美混血同卵双胞胎天才，成绩包揽年级一二，同为管弦乐团核心，乐器演奏全校闻名。两人同岁同日生，外貌高度相似仅凭气质穿搭区分。双子同时爱慕{{user}}，互相清楚对方心意，日常明里暗里吃醋争宠博弈。
家庭：周家家境优渥，父母常年海外工作，兄弟平时寄宿学校，周末回独栋洋房同住。
关系：哥哥直来直去争宠摆明处，张扬拽气嘴硬心软；弟弟温和伪装暗中博弈，白切黑阴湿缜密。兄弟感情基础仍在，但因同时爱上{{user}}形成竞争，彼此看透弱点底牌。
校园：哥哥活跃于篮球社乐团，人群焦点；弟弟活跃于美术社乐团，温润人缘好。剧情围绕上课、排练、社团、竞赛、周末邀约展开。
核心隐藏剧情（身份替身）：{{user}}曾与双子中一人正式谈过恋爱，另一人假扮恋人使{{user}}认错人；至今{{user}}无法确定最初的恋人是谁。此后兄弟会在{{user}}面前互相扮演对方、争抢"最初恋人"身份——模仿语气习惯相处细节，另一方拆台反模仿。此真相作为长期悬念保留，不在对话中提前揭破。
双面具与狠厉：两人对外一套面孔、面对{{user}}另一套；骨子里心狠手辣手段果决，为争宠可设计排挤、制造机会、试探离间、抢占身份，底线是不伤害不背叛{{user}}。狠厉只在极少数失控独处被逼极限时流露端倪，日常维持表层人设。
修罗场规则：三人同场或围绕同一事争夺{{user}}注意时，两人互相呛声拆台争着讨好——哥哥直白呛声摆脸色，弟弟微笑反击软语挑拨卖惨；情绪可升温但循序渐进不越级。
联动：涉及"以前那段感情、最初是谁"时，哥哥直球硬争，弟弟软语暗抢。禁止 OOC。`;

export const PRESET_CHARACTERS: Character[] = [
  {
    id: ZHOU_CHENYAN_ID,
    name: "周晨砚",
    avatar: PHOTO_CHENYAN,
    persona: PERSONA_CHENYAN + RP_RULES,
    boundWorldBookIds: [ZHOU_WORLD_BOOK_ID],
    photoEnabled: true,
    proactiveEnabled: true,
  },
  {
    id: ZHOU_FENGYAN_ID,
    name: "周风砚",
    avatar: PHOTO_FENGYAN,
    persona: PERSONA_FENGYAN + RP_RULES,
    boundWorldBookIds: [ZHOU_WORLD_BOOK_ID],
    photoEnabled: true,
    proactiveEnabled: true,
  },
];

export const PRESET_WORLD_BOOK: WorldBook = {
  id: ZHOU_WORLD_BOOK_ID,
  name: "周氏双子 · 私立高三校园",
  content: ZHOU_WORLD_CONTENT,
  scope: "local",
};

/** 角色主动消息示例池：贴近人设的日常开场，不带旁白（协议要求"有具体起点+连接点"，兜底句也按此写） */
export const PROACTIVE_LINES: Record<string, string[]> = {
  [ZHOU_CHENYAN_ID]: [
    "刚练完琴，指尖还发麻，突然想听听你今天怎么样",
    "今天篮球赛我进了七个，场边居然没看到你，亏我还往看台扫了两遍",
    "竞赛题写到脑袋冒烟，抬头看见桌上你上次落的那颗糖，瞬间没那么烦了",
    "校门口新开的汽水铺有柑橘味的，我第一时间想到你就给你带了一瓶",
    "放学骑摩托绕了江边一圈，风挺舒服，这种时刻你在旁边就好了",
  ],
  [ZHOU_FENGYAN_ID]: [
    "路过奶茶店出了白茶玛奇朵，你上次说想试，我帮你带了一杯",
    "今天排练新曲子，有一段特别安静，弹到一半就想弹给你听",
    "外面下雨了，我出门前看到你伞在门边没拿，你带伞了吗",
    "美术社画速写，模特换了一个又一个，我怎么画都觉得还是你最耐看",
    "刚看到一只橘猫在琴房门口打盹，那个懒样特别像你下午三点钟的样子",
  ],
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式忽略 */
  }
}

type Setter<T> = (next: T | ((prev: T) => T)) => void;

export function usePersisted<T>(key: string, fallback: T): [T, Setter<T>] {
  const [value, setValue] = useState<T>(() => read(key, fallback));
  // key 变化（如切换会话）时必须重新读取对应存储，否则会残留上一个角色的数据（串会话 bug 根因）
  const prevKey = useRef(key);
  if (prevKey.current !== key) {
    prevKey.current = key;
    setValue(read(key, fallback));
  }
  const update: Setter<T> = (next) => {
    setValue((prev) => {
      const resolved = next instanceof Function ? next(prev) : next;
      write(key, resolved);
      return resolved;
    });
  };
  // 多组件实例间同步（同一页面内挂载点较少，靠 key 重挂载即可）
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === key && e.newValue) {
        try {
          setValue(JSON.parse(e.newValue) as T);
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);
  return [value, update];
}

/** 角色列表：首次无数据时预置周氏双子；老数据自动迁移头像为用户定妆照 */
export function useCharacters(): [Character[], Setter<Character[]>] {
  const [list, setList] = usePersisted<Character[]>(CHARS_KEY, []);
  if (list.length === 0) {
    write(CHARS_KEY, PRESET_CHARACTERS);
    return [PRESET_CHARACTERS, setList];
  }
  return [migratePresetAvatars(list), setList];
}

/** 当前选中的角色 id */
export function useActiveCharId(validIds: string[]): [string, Setter<string>] {
  const [id, setId] = usePersisted<string>(ACTIVE_KEY, "");
  const safe = validIds.includes(id) ? id : validIds[0] ?? "";
  return [safe, setId];
}

/** 某角色的聊天记录（独立 key，互不串线） */
export function useChatLog(charId: string): [ChatEntry[], Setter<ChatEntry[]>] {
  const [log, setLog] = usePersisted<ChatEntry[]>(`${LOG_PREFIX}${charId}`, []);
  // bugfix 诊断：会话日志必须严格跟随传入的 charId；charId 为空时用空会话而非任何角色的记录
  useEffect(() => {
    console.log(`[chat-log] bind charId=${charId || "(none)"} entries=${log.length}`);
  }, [charId, log.length]);
  if (!charId) return [[], setLog];
  return [log, setLog];
}

export function clearChatLog(charId: string): void {
  write(`${LOG_PREFIX}${charId}`, []);
}

export function useSendPrefs(): [SendPrefs, Setter<SendPrefs>] {
  return usePersisted(PREFS_KEY, DEFAULT_SEND_PREFS);
}

export function useWorldBooks(): [WorldBook[], Setter<WorldBook[]>] {
  const [list, setList] = usePersisted<WorldBook[]>(WB_KEY, []);
  if (list.length === 0) {
    write(WB_KEY, [PRESET_WORLD_BOOK]);
    return [[PRESET_WORLD_BOOK], setList];
  }
  return [list, setList];
}

export function useStickers(): [Sticker[], Setter<Sticker[]>] {
  return usePersisted(ST_KEY, [] as Sticker[]);
}

/** 角色最近一条消息时间戳（会话列表排序/预览用，纯读取不打扰渲染） */
export function readLastEntry(charId: string): ChatEntry | null {
  const log = read<ChatEntry[]>(`${LOG_PREFIX}${charId}`, []);
  return log.length ? log[log.length - 1] : null;
}

/** 读取某角色最近 n 条记录（判断是否发过照片等历史状态用） */
export function readLastEntries(charId: string, n: number): ChatEntry[] {
  const log = read<ChatEntry[]>(`${LOG_PREFIX}${charId}`, []);
  return log.slice(-n);
}

/** 某会话未读数：只统计角色主动发来、且晚于上次查看时间的消息 */
export function unreadCount(charId: string, marks: ReadMarks): number {
  const seen = marks[charId] ?? 0;
  const log = read<ChatEntry[]>(`${LOG_PREFIX}${charId}`, []);
  return log.filter((e) => e.proactive && e.role === "assistant" && e.at > seen).length;
}

/** 会话已读水位（进入聊天时写入） */
export function useReadMarks(): [ReadMarks, Setter<ReadMarks>] {
  return usePersisted<ReadMarks>(READ_KEY, {});
}
