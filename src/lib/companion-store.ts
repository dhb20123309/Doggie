// Companion OS 数据层：日记 / 随写便签 / 心动羁绊 / 偏好记忆 / 查手机缓存 / 个人资料 + 小剧场剧本
import { usePersisted } from "./chat-store";
import type { Character, ChatEntry } from "./chat-types";

type Setter<T> = (next: T | ((prev: T) => T)) => void;

/* ---------- 图标素材（AI 生成透明底，CDN auth_key 必须完整保留） ---------- */
export const ICON_URLS = {
  theater: "https://g.cdn.meoo.host/xn5qwuicmstz/ai-images/companion-icons-1.png?auth_key=86df4ff8c730062b9605d43266a9383c519f3fa95803347ac5c660d04c5d5a49",
  phone: "https://g.cdn.meoo.host/xn5qwuicmstz/ai-images/companion-icons-2.png?auth_key=5877a33887f1b03d6c0146f8fc28f488484da54e70f179cd26bdebf7a9aaeb68",
  bond: "https://g.cdn.meoo.host/xn5qwuicmstz/ai-images/companion-icons-3.png?auth_key=5936851cd8cb5e10bf1f3d980394a3006f5daee9e96705a3cb4417a0b029ff1f",
  worldbook: "https://g.cdn.meoo.host/xn5qwuicmstz/ai-images/companion-icons-4.png?auth_key=9aa414df5979c3ea25eb36b99ffb40945a61323572a0c1cffd3f5ef8ca2e4e20",
  memory: "https://g.cdn.meoo.host/xn5qwuicmstz/ai-images/companion-icons-5.png?auth_key=37e14449f3415466c3082c2af92d270cc482616277247263ad47e44184124af6",
  diary: "https://g.cdn.meoo.host/xn5qwuicmstz/ai-images/companion-icons-6.png?auth_key=19d3faaeaa21093615c4da8f6b69faa321867fdf20cb0a5f6cc76855be94bc23",
  memo: "https://g.cdn.meoo.host/xn5qwuicmstz/ai-images/companion-icons-7.png?auth_key=9c453d005c35c32740d054f8c59ad20b60a0fb40e4092310e6d8a5a667b49fb7",
  weather: "https://g.cdn.meoo.host/xn5qwuicmstz/ai-images/companion-icons-8.png?auth_key=94afaf8be008c6e7868d328cb7e60610752ce68b8f837d144158a750d3879482",
  music: "https://g.cdn.meoo.host/xn5qwuicmstz/ai-images/companion-icons-9.png?auth_key=b495f38abf19a485ed2c11ffb89a42e2d9467955603e1b2d4c9d93c240b616ac",
};
/** 头像底座梦幻背景 */
export const AVATAR_BG =
  "https://g.cdn.meoo.host/xn5qwuicmstz/ai-images/%E5%A4%B4%E5%83%8F%E5%BA%95%E5%BA%A7%E8%83%8C%E6%99%AF.png?auth_key=38385574f2560e0b2e4aa846fd14ab7a21d7a959c708c48b3de78a0e2344bfd3";

/* ---------- 日记 ---------- */
export interface DiaryEntry {
  id: string;
  charId: string;
  title: string;
  content: string;
  at: number;
}

const DIARY_FALLBACK: Record<string, { title: string; content: string }[]> = {
  "zhou-chenyan": [
    { title: "关于那些被风吹散的秘密", content: "今天排练间隙往窗外看了一眼，风把操场边的梧桐叶吹得乱七八糟。突然想起你上次说喜欢秋天，那等你来看我比赛的时候，应该刚好是最舒服的季节。就这么定了，到时候占最好的位置给你。" },
    { title: "赢了七个球没人夸", content: "篮球赛我拿了全场最高分，回更衣室路上总觉得少了点什么。哦，少了个在场边喊加油的人。下次再装路过不带你的话，某人的汽水就没了。" },
  ],
  "zhou-fengyan": [
    { title: "速写本里不能给你看的那页", content: "美术社自由活动，我画了张侧脸速写，画到一半发现嘴角的弧度太明显了——那是想到某人时的表情。撕下来夹进书签了，等一个合适的时机。" },
    { title: "白茶玛奇朵的第二杯", content: "奶茶店做活动买一送一。店员问我为什么一直笑，我说没什么，只是觉得这杯多出来的，终于有地方放了。" },
  ],
};

export function useDiaries(): [DiaryEntry[], Setter<DiaryEntry[]>] {
  return usePersisted<DiaryEntry[]>("vp-phone:diaries:v1", []);
}

export function seedDiaries(charId: string): DiaryEntry[] {
  return (DIARY_FALLBACK[charId] ?? []).map((d, i) => ({
    id: `seed-${charId}-${i}`,
    charId,
    title: d.title,
    content: d.content,
    at: Date.now() - (i + 1) * 26 * 3600_000,
  }));
}

/* ---------- 桌面随写便签 ---------- */
export function useMemo(): [string, Setter<string>] {
  return usePersisted<string>("vp-phone:memo:v1", "");
}

/* ---------- 心动羁绊 ---------- */
export interface BondInfo {
  /** 恋爱开始日（首次聊天自动记录） */
  startDate: number;
  /** 纪念日名称 → 时间戳 */
  anniversaries: Record<string, number>;
}

export function useBond(): [BondInfo, Setter<BondInfo>] {
  return usePersisted<BondInfo>("vp-phone:bond:v1", { startDate: 0, anniversaries: {} });
}

/* ---------- 偏好记忆 ---------- */
export interface Preference {
  id: string;
  text: string;
  at: number;
}

export function usePreferences(): [Preference[], Setter<Preference[]>] {
  return usePersisted<Preference[]>("vp-phone:prefs-about-me:v1", []);
}

/* ---------- 查手机缓存 ---------- */
export interface PhonePeek {
  charId: string;
  battery: number;
  searches: string[];
  drafts: string[];
  /** 今日行踪：时间 + 地点 + 一句话 */
  movements: { time: string; place: string; note: string }[];
  /** 今日应用使用记录：图标 + 名称 + 时长 */
  appUsage: { icon: string; name: string; mins: number }[];
  at: number;
}

export function usePhonePeek(): [PhonePeek | null, Setter<PhonePeek | null>] {
  return usePersisted<PhonePeek | null>("vp-phone:phone-peek:v1", null);
}

const SEARCH_POOL: Record<string, string[][]> = {
  "zhou-chenyan": [["女生围巾 显脸小 怎么挑", "送女朋友手链 银还是玫瑰金", "摩托车后座 乘客安全带的正确姿势", "她说过喜欢的歌 高潮部分叫什么", "直男拍照 怎么把人拍瘦十斤"]],
  "zhou-fengyan": [["白茶玛奇朵 家庭版做法", "速写 人物侧脸 光影参考", "怎样让人毫无察觉地记住自己", "针织开衫 搭配 垂感衬衫", "下雨天没带伞 借口大全"]],
};
const DRAFT_POOL: Record<string, string[]> = {
  "zhou-chenyan": ["其实那天你说要冷静一下，我在琴房坐到熄灯。有些话当面说不出口，先记这里。", "今天看到一对情侣吵架，男生先低头了。行吧，我也不是不行。", "写给某个偷走年级第一名次的家伙：下次月考我还得赢，但周末的时间归你。"],
  "zhou-fengyan": ["哥哥今天又在你面前晃了吧。没关系，我会等到你自己走过来。", "草稿箱第 17 条：要不要直接告诉你，那年初吻的时候我在场。", "速写背面写了句话，不敢正面递给你，先放这里。"],
};

const MOVEMENT_POOL: Record<string, { time: string; place: string; note: string }[][]> = {
  "zhou-chenyan": [
    [
      { time: "07:10", place: "校门口早餐铺", note: "买了两份小笼包，有一份没动" },
      { time: "08:30-11:50", place: "高三(2)班教室", note: "早自习+三节课，趴桌睡了半节数学" },
      { time: "12:40", place: "体育馆", note: "校队对抗训练，赢了首发位" },
      { time: "16:20", place: "琴房走廊", note: "路过时站了十分钟，没进去" },
      { time: "19:00", place: "江边步道", note: "骑摩托兜了一圈，风很大" },
    ],
    [
      { time: "07:45", place: "地下车库", note: "洗车，副驾上发现一根你的头发丝" },
      { time: "10:00-12:00", place: "年级办公室", note: "被叫去补月考卷面分" },
      { time: "14:30", place: "篮球场", note: "单人投篮两小时，进了 148 个" },
      { time: "18:10", place: "奶茶店", note: "点了两杯，另一杯说是顺手买的" },
    ],
  ],
  "zhou-fengyan": [
    [
      { time: "08:00", place: "美术楼天台", note: "写生，画的全是同一个方向" },
      { time: "10:20", place: "图书馆三楼", note: "借了本《色彩心理学》，翻到某页折了角" },
      { time: "13:00", place: "甜品工坊", note: "白茶玛奇朵买一送一，第二杯装进了保温袋" },
      { time: "15:40", place: "旧音乐教室", note: "弹了四十分钟琴，门没锁" },
      { time: "20:30", place: "家里画室", note: "速写本新起一页，标题被涂掉了" },
    ],
    [
      { time: "09:15", place: "花艺工作室", note: "买了一束洋桔梗，说是给社团活动用" },
      { time: "11:30", place: "文创市集", note: "逛了两小时，摊位老板说他一直盯着某个挂件看" },
      { time: "14:00", place: "摄影棚", note: "拍社刊封面，要求加拍一组胶片" },
      { time: "17:50", place: "便利店门口", note: "躲雨时买了把伞——和你上次那把同款" },
    ],
  ],
};

const APP_POOL: Record<string, { icon: string; name: string; mins: number }[]> = {
  "zhou-chenyan": [
    { icon: "🏀", name: "虎扑", mins: 87 },
    { icon: "🎵", name: "网易云音乐", mins: 64 },
    { icon: "💬", name: "微信", mins: 52 },
    { icon: "📷", name: "醒图", mins: 31 },
    { icon: "🛵", name: "高德地图", mins: 18 },
    { icon: "🎮", name: "王者荣耀", mins: 45 },
  ],
  "zhou-fengyan": [
    { icon: "📷", name: "Instagram", mins: 92 },
    { icon: "🎵", name: "Spotify", mins: 78 },
    { icon: "✏️", name: "Procreate", mins: 66 },
    { icon: "💬", name: "微信", mins: 41 },
    { icon: "📖", name: "豆瓣", mins: 27 },
    { icon: "🗺️", name: "小红书", mins: 55 },
  ],
};

export function makePeek(charId: string): PhonePeek {
  const searches = SEARCH_POOL[charId]?.[Math.floor(Math.random() * (SEARCH_POOL[charId]?.length ?? 1))] ?? ["搜索记录为空"];
  const drafts = (DRAFT_POOL[charId] ?? []).slice(0, 3);
  const pool = MOVEMENT_POOL[charId] ?? [];
  const movements = pool.length ? pool[Math.floor(Math.random() * pool.length)] : [{ time: "全天", place: "未知", note: "行程神秘失踪" }];
  const apps = (APP_POOL[charId] ?? []).map((a) => ({ ...a, mins: Math.max(5, a.mins + Math.floor(Math.random() * 24) - 12) })).sort((x, y) => y.mins - x.mins);
  return { charId, battery: 15 + Math.floor(Math.random() * 70), searches, drafts, movements, appUsage: apps, at: Date.now() };
}

/** 旧版缓存（无行踪/应用记录字段）或角色不匹配时视为失效，需重新生成 */
export function isPeekFresh(p: PhonePeek | null, charId: string): boolean {
  return !!p && p.charId === charId && Array.isArray(p.movements) && Array.isArray(p.appUsage);
}

/* ---------- 个人资料（称呼昵称） ---------- */
export interface Profile {
  nickname: string;
}

export function useProfile(): [Profile, Setter<Profile>] {
  return usePersisted<Profile>("vp-phone:profile:v1", { nickname: "Dreaming" });
}

/* ---------- 心事短句 ---------- */
export const HEART_LINES: Record<string, string[]> = {
  "zhou-chenyan": ["“别以为我不知道，你刚才在偷看别人班。”—— 寄自周晨砚", "“我赢了比赛，但你得承认你最想看的是我。”—— 寄自周晨砚"],
  "zhou-fengyan": ["“今天的白茶有点苦，大概是因为你没在旁边。”—— 寄自周风砚", "“我不着急，反正你会走过我身边的。”—— 寄自周风砚"],
};

/* ---------- 小剧场剧本（纯本地分支引擎） ---------- */
export interface SceneNode {
  id: string;
  text: string[];
  choices?: { label: string; next: string }[];
  ending?: string;
}

export interface Script {
  id: string;
  title: string;
  sub: string;
  start: string;
  nodes: Record<string, SceneNode>;
}

export const SCRIPTS: Script[] = [
  {
    id: "rainy-day",
    title: "雨停之前",
    sub: "放学 · 教学楼门厅",
    start: "s1",
    nodes: {
      s1: {
        id: "s1",
        text: ["暴雨毫无预兆地砸下来，你站在教学楼门厅发愁。", "一把黑伞从旁边斜过来，周晨砚靠在柱子上，下巴一抬：“愣着干嘛，走啊。”", "他身后半步，周风砚抱着画板轻声说：“姐姐，我这儿也有一把哦。”"],
        choices: [
          { label: "跟哥哥走（他没耐心等第二遍）", next: "chen" },
          { label: "接弟弟的伞（他都开口了欸）", next: "feng" },
        ],
      },
      chen: {
        id: "chen",
        text: ["周晨砚把伞整个压向你这边，自己半边肩膀淋透，“笨蛋，躲我伞底下很难吗”。", "走到街角他忽然停住：“下周篮球赛，来看。不是商量。”"],
        choices: [{ label: "问他肩膀不冷吗", next: "chen2" }, { label: "答应去看比赛", next: "e1" }],
      },
      chen2: {
        id: "chen2",
        text: ["他低头看了眼湿透的袖子，咧嘴一笑：“冷啊，所以你得赔我一晚上——视频通话那种。”", "雨声很大，你听见自己的心跳假装没听见他的。"],
        ending: "结局 · 淋湿的告白：他的肩膀是热的，话也是。",
      },
      e1: {
        id: "e1",
        text: ["“这还差不多。”周晨砚难得没呛你，耳尖却红了，“……到时候坐第一排，方便我进球的时候看你。”"],
        ending: "结局 · 第一排：他的每个进球都朝你的方向。",
      },
      feng: {
        id: "feng",
        text: ["周风砚的伞很小，两个人的肩膀贴得很近，谁都没说挤。", "“哥哥的伞总是偏向你那边呢。”他轻声笑着，“我的伞，只偏向你一个人哦。”"],
        choices: [{ label: "告诉他刚才其实想选哥哥", next: "feng2" }, { label: "安静走完这段路", next: "e3" }],
      },
      feng2: {
        id: "feng2",
        text: ["他脚步一顿，笑容还挂在脸上，眼底的光却暗了半度：“……现在才说，晚了哦。”", "下一秒他又笑起来，把伞柄整个塞进你手里：“骗你的。伞给你，我跑两步就到车库了。”"],
        ending: "结局 · 白切黑：他说“晚了”的时候，声音比雨还轻。",
      },
      e3: {
        id: "e3",
        text: ["你们谁都没说话，雨点敲着伞面，像给这段路打着节拍。", "分别时他忽然说：“明天见。我会带两杯奶茶——你知道口味的。”", "你确实知道。他也知道你记得。"],
        ending: "结局 · 无声的默契：有些偏爱不用说破。",
      },
    },
  },
  {
    id: "music-room",
    title: "琴房十二点",
    sub: "深夜 · 学校音乐教室",
    start: "p1",
    nodes: {
      p1: {
        id: "p1",
        text: ["你半夜睡不着溜进琴房，里面竟然亮着一盏灯。", "周风砚坐在三角钢琴前，弹的是你听过的旋律——是你随口哼过一次的那段。", "他指尖没停：“既然来了，就别站在门口。”"],
        choices: [
          { label: "走过去坐到他旁边", next: "p2" },
          { label: "转身想装作没看见", next: "p3" },
        ],
      },
      p2: {
        id: "p2",
        text: ["他把琴凳挪出半个位置，谱架上摊着的笔记本露出一角——上面记的全是你的习惯：几点睡、爱喝什么、讨厌什么香水味。", "“弹完这首，”他说，“你有一个问题可以问我，一个。”"],
        choices: [{ label: "问：那段旋律你取好名字了吗", next: "e4" }, { label: "问：为什么是我", next: "e5" }],
      },
      e4: {
        id: "e4",
        text: ["他按下最后一个音，转头看你，眼神浓得化不开：“取了。就叫你的名字。”", "琴房里那盏灯，好像又亮了一点。"],
        ending: "结局 · 以你为名的曲子：从此这首曲子不许别人点。",
      },
      e5: {
        id: "e5",
        text: ["“因为从你说‘随便哼哼’的那天起，”他的手指重新落在琴键上，“我脑子里就再也关不掉它了。”", "“这个问题犯规了，姐姐。下次换我问你。”"],
        ending: "结局 · 犯规的问题：他记下了，迟早连本带利讨回来。",
      },
      p3: {
        id: "p3",
        text: ["你刚转身，琴声停了。脚步声很轻，快得不像话。", "“看清楚再走。”周风砚的声音贴着耳边响起，“——刚才弹的每一个音，都是弹给你听的。”", "走廊的灯在他身后亮起，他的表情你第一次没读懂。"],
        choices: [{ label: "留下来听完最后一首", next: "e4" }, { label: "逃走了（他会来找你的）", next: "e6" }],
      },
      e6: {
        id: "e6",
        text: ["第二天早自习，你的桌肚里多了一张乐谱，扉页只有一行小字：", "“逃票的惩罚是——下次坐第一排，听到我亲口邀请为止。”落款画了一小片茶叶。"],
        ending: "结局 · 逃票罚单：他说到做到。",
      },
    },
  },
];

/** 会话是否已有用户消息（用于自动记录恋爱开始日） */
export function firstUserAt(log: ChatEntry[]): number {
  const u = log.find((e) => e.role === "user");
  return u?.at ?? 0;
}

export function dayName(ch: Character): string {
  return ch.name || "TA";
}
