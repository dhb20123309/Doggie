// 外卖 App 数据层：预置店铺/菜单常量池 + 本地订单历史（vp-phone:delivery-orders:v1）
// 定位常用地点池也放这里，供聊天输入栏「发送定位」面板取用。

import { usePersisted } from "./chat-store";

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  /** 角标文案，如"招牌""热销" */
  tag?: string;
}

export interface Shop {
  id: string;
  name: string;
  emoji: string;
  /** 封面渐变的两个色（Tailwind arbitrary class 片段，保持暖色系设计系统） */
  grad: [string, string];
  rating: number;
  /** 配送时长（分钟） */
  eta: number;
  /** 月售文案 */
  sales: string;
  category: string;
  menu: MenuItem[];
}

export const SHOPS: Shop[] = [
  {
    id: "yidian", name: "一点点奶茶", emoji: "🧋", grad: ["#f6c59f", "#ef8b6d"], rating: 4.8, eta: 25, sales: "月售 3200+", category: "饮品",
    menu: [
      { id: "a1", name: "珍珠奶茶", price: 12, tag: "招牌" }, { id: "a2", name: "四季奶青", price: 11 },
      { id: "a3", name: "冰淇淋红茶", price: 13 }, { id: "a4", name: "布丁奶茶", price: 12 }, { id: "a5", name: "柠檬爱玉", price: 14 },
    ],
  },
  {
    id: "jizha", name: "叫了个炸鸡", emoji: "🍗", grad: ["#f7b267", "#e56b6f"], rating: 4.6, eta: 32, sales: "月售 1800+", category: "炸物",
    menu: [
      { id: "b1", name: "香辣鸡腿堡", price: 18, tag: "热销" }, { id: "b2", name: "韩式炸鸡(半只)", price: 32 },
      { id: "b3", name: "薯条(大)", price: 11 }, { id: "b4", name: "洋葱圈", price: 9 }, { id: "b5", name: "可乐", price: 6 },
    ],
  },
  {
    id: "maocai", name: "三顾冒菜", emoji: "🌶️", grad: ["#f08a5d", "#d9506b"], rating: 4.7, eta: 30, sales: "月售 2600+", category: "川渝",
    menu: [
      { id: "c1", name: "经典牛肉冒菜", price: 28, tag: "招牌" }, { id: "c2", name: "毛肚冒菜", price: 34 },
      { id: "c3", name: "素菜拼盘冒菜", price: 21 }, { id: "c4", name: "加一份米饭", price: 3 }, { id: "c5", name: "酸梅汤", price: 8 },
    ],
  },
  {
    id: "riliao", name: "鮨心日料", emoji: "🍣", grad: ["#a1c4fd", "#6b8fd9"], rating: 4.9, eta: 40, sales: "月售 900+", category: "日料",
    menu: [
      { id: "d1", name: "三文鱼寿司(6贯)", price: 42, tag: "招牌" }, { id: "d2", name: "鳗鱼饭", price: 48 },
      { id: "d3", name: "加州卷", price: 32 }, { id: "d4", name: "味增汤", price: 12 }, { id: "d5", name: "抹茶大福(2颗)", price: 16 },
    ],
  },
  {
    id: "tianpin", name: "满记甜品", emoji: "🍮", grad: ["#fbc2eb", "#d483c8"], rating: 4.8, eta: 22, sales: "月售 2100+", category: "甜品",
    menu: [
      { id: "e1", name: "杨枝甘露", price: 24, tag: "招牌" }, { id: "e2", name: "芒果班戟", price: 22 },
      { id: "e3", name: "双皮奶", price: 16 }, { id: "e4", name: "红豆冰", price: 15 }, { id: "e5", name: "芝麻糊", price: 14 },
    ],
  },
  {
    id: "shaokao", name: "深夜烧烤局", emoji: "🍢", grad: ["#8e9eab", "#5b6b7b"], rating: 4.5, eta: 45, sales: "月售 1500+", category: "夜宵",
    menu: [
      { id: "f1", name: "羊肉串(5串)", price: 25, tag: "热销" }, { id: "f2", name: "烤生蚝(2只)", price: 28 },
      { id: "f3", name: "烤茄子", price: 16 }, { id: "f4", name: "掌中宝", price: 18 }, { id: "f5", name: "啤酒(1瓶)", price: 9 },
    ],
  },
  {
    id: "shuiguo", name: "鲜果捞", emoji: "🍓", grad: ["#f5d178", "#ee9a68"], rating: 4.7, eta: 20, sales: "月售 1200+", category: "轻食",
    menu: [
      { id: "g1", name: "草莓酸奶捞", price: 22, tag: "招牌" }, { id: "g2", name: "芒果西米露", price: 20 },
      { id: "g3", name: "综合水果杯", price: 18 }, { id: "g4", name: "椰子冻", price: 15 },
    ],
  },
  {
    id: "coffee", name: "Manner咖啡", emoji: "☕", grad: ["#c79081", "#8a5a44"], rating: 4.8, eta: 18, sales: "月售 4000+", category: "咖啡",
    menu: [
      { id: "h1", name: "燕麦拿铁", price: 15, tag: "热销" }, { id: "h2", name: "冰美式", price: 10 },
      { id: "h3", name: "生椰拿铁", price: 18 }, { id: "h4", name: "摩卡", price: 17 }, { id: "h5", name: "可颂", price: 12 },
    ],
  },
];

/** 礼物精选池（外卖 App 里"送礼物"页签直接选） */
export interface GiftItem {
  id: string;
  name: string;
  price: number;
  emoji: string;
  desc: string;
}

export const GIFTS: GiftItem[] = [
  { id: "gf1", name: "小熊玩偶", price: 89, emoji: "🧸", desc: "抱着睡觉专用" },
  { id: "gf2", name: "永生花盒", price: 199, emoji: "🌹", desc: "不会谢的那种" },
  { id: "gf3", name: "香水礼盒", price: 359, emoji: "🎁", desc: "木质调淡香" },
  { id: "gf4", name: "拍立得相机", price: 499, emoji: "📷", desc: "记录你们的瞬间" },
  { id: "gf5", name: "星空投影灯", price: 129, emoji: "✨", desc: "房间秒变银河" },
  { id: "gf6", name: "情侣手链", price: 168, emoji: "📿", desc: "一人一条刻了字" },
  { id: "gf7", name: "黑胶蓝牙音箱", price: 299, emoji: "🎵", desc: "她歌单外放自由" },
  { id: "gf8", name: "手写信+巧克力", price: 66, emoji: "💌", desc: "老派但杀伤力最大" },
];

/** 聊天发定位的常用地点池 */
export interface PlacePreset {
  place: string;
  addr: string;
  emoji: string;
}

export const PLACE_PRESETS: PlacePreset[] = [
  { place: "家", addr: "阳光花园 3 栋 1201", emoji: "🏠" },
  { place: "公司", addr: "高新区 环球金融中心 T2", emoji: "🏢" },
  { place: "学校", addr: "大学城北区 图书馆旁", emoji: "🎓" },
  { place: "地铁站", addr: "2 号线 人民广场站 3 口", emoji: "🚇" },
  { place: "常去的奶茶店", addr: "一点点 (万达金街店)", emoji: "🧋" },
  { place: "火锅店", addr: "楠火锅 中山路店", emoji: "🍲" },
  { place: "江边", addr: "滨江步道 观景平台", emoji: "🌊" },
  { place: "健身房", addr: "乐刻健身 银泰店", emoji: "🏋️" },
  { place: "医院", addr: "市一医院 门诊楼", emoji: "🏥" },
  { place: "机场", addr: "T2 航站楼 出发层", emoji: "✈️" },
];

/** 本地外卖订单历史（在 App 内下的单，不含聊天卡片） */
export interface DeliveryOrder {
  id: string;
  at: number;
  shopName: string;
  emoji: string;
  itemsText: string;
  amount: number;
  /** 送达对象显示名 */
  to: string;
  kind: "delivery" | "gift";
}

const ORDERS_KEY = "vp-phone:delivery-orders:v1";

export function useDeliveryOrders() {
  return usePersisted<DeliveryOrder[]>(ORDERS_KEY, []);
}

export function addDeliveryOrder(o: DeliveryOrder) {
  try {
    const prev = JSON.parse(localStorage.getItem(ORDERS_KEY) || "[]") as DeliveryOrder[];
    localStorage.setItem(ORDERS_KEY, JSON.stringify([o, ...prev].slice(0, 60)));
  } catch {
    /* ignore */
  }
}

export function orderItemsText(items: { name: string; qty: number }[]): string {
  return items.map((i) => `${i.name}x${i.qty}`).join(" + ");
}
