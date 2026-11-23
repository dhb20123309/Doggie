# 需求文档

## 1. 改动目标
在手机模拟器里新增两项"真实情侣日常"能力：
- **发送/共享定位**：聊天输入栏可把位置作为卡片发给 TA；TA 也能主动发定位、对你发的定位做出反应。
- **外卖 App（点外卖 + 送礼物）**：桌面新增一个外卖软件，可选店下单，把"外卖订单卡"或"礼物卡"直接送到 TA 的聊天里；TA 能感知订单内容并像真人恋人一样回应（收到、道谢、催你吃饭、嫌弃你乱花钱等）。

## 2. 现状 vs 目标
| 项 | 现状 | 目标 |
|---|---|---|
| 富媒体消息 | 只有转账卡、表情包、照片 | 新增定位卡、外卖订单卡、礼物卡三种卡片 |
| 输入栏工具 | 工具箱 + 转账按钮 | 增加「定位」按钮（MapPin 图标） |
| 桌面 App | 日记/查手机/羁绊/偏好/剧场/档案等 | 新增「外卖」App 入口与完整页面 |
| AI 感知 | 转账单以【转账往来】清单进 system | 定位/外卖/礼物同样转文本喂模型，并有专属协议教 TA 用标记主动发出 |

## 3. 改动点说明
### 3.1 发送/共享定位
- 输入栏新增定位按钮，弹出「选择位置」面板：预置常用地点池（家、公司、学校、常去的奶茶店、火锅店、江边、TA 的城市等，每个带一句地址描述），也支持手动输入自定义地点名。
- 选中后向当前会话发送**定位卡片**（仿微信地图卡：地点名 + 地址行 + 迷你地图样式占位图 + "查看位置"角标），随即触发 TA 回复。
- 存储字段：`ChatEntry.location = { place, addr, from: 'user'|'char' }`。
- AI 侧协议 `LOCATION_PROTOCOL`：教 TA 用 `[定位:地点名]` 标记主动发位置（如报备"我在健身房"时附带）；回复解析层拆标记生成 incoming 定位卡。
- TA 对定位的反应纳入既有【实时上下文】注入：最近一张定位卡会描述进 system（"她刚把定位发到了 XX"），配合既有主动报备协议自然接话。

### 3.2 外卖 App（为对方点外卖、送礼物）
- 桌面 App 网格新增「外卖」图标（复用现有 grid9 抠图图标风格，若无空位则用 lucide UtensilsCrossed 圆形渐变底兜底），路由 ScreenId 新增 `"delivery"`。
- App 内结构：
  - **店铺列表页**：预置 6~8 家店（奶茶、炸鸡、火锅冒菜、日料、甜品、烧烤、水果捞、咖啡），每店有名称、评分、配送时长、封面（渐变色块+emoji 或已有 CDN 素材）、菜单 4~6 项（品名+价格）。
  - **选品下单页**：勾选菜品→右侧数量加减→小计；底部两种交付方式二选一：**①点外卖送到 TA 那里**（生成外卖订单卡发到当前活跃角色会话，从用户钱包扣款，余额不足提示）；**②包装成礼物送出**（可选一条留言，生成礼物卡发送）。
  - **订单历史页**：列出本地下过的单（时间/店/品项/金额/送达对象），纯 localStorage。
- 存储字段：`ChatEntry.order = { kind: 'delivery'|'gift', shop, items: [{name, qty, price}], amount, note?, from: 'user'|'char', status: 'pending'|'received' }`。
- 卡片渲染：外卖卡=橙色系仿美团/饿了么订单条（店名+品项摘要+预计送达+状态）；礼物卡=粉紫礼盒样式（品项+留言便签）。待收状态可点开详情弹层「收下」（复用 transferSheet 弹层模式），收下后 wallet 入账语义对齐（礼物不退款、外卖收下即完成）。
- AI 感知三层：
  1. `ORDER_PROTOCOL` 拼入 buildSys 私聊与剧情分支：教会 TA 识别【外卖/礼物卡片】、可用 `[外卖:店名:品项x数量:金额]` / `[礼物:品名:留言]` 标记回赠（走角色余额挂账，掏空口袋也可发生）；
  2. `orderCtx` IIFE 把最近 3 张订单/礼物卡描述进 system（参照 transferCtx）；
  3. `toHist.fmt` 把订单消息转文本 `[外卖卡片 ¥xx 店:… 品项:… 待收/已收]`。
- 结算联动：`walletUserSend` 扣用户余额下单；TA 回赠外卖/礼物由 `walletCharSend` 挂账；用户点「收下」`walletUserReceive` 入账。

## 4. 影响面与调用链
```
输入栏(1620-1658) ──新按钮──▶ LocationPanel ──sendLocation──▶ setLog+writeLogNow ─▶ requestReply
settleReply(≈839) ─digestTransfer─▶ digestLocation/digestOrder ◀─ extractLocation/extractOrder (chat-types)
buildSys(657-715) ─TRANSFER_PROTOCOL后─▶ + LOCATION_PROTOCOL + ORDER_PROTOCOL
toHist.fmt(758) ─转账分支旁─▶ + location/order 转文本分支
transferCtx(746) ─并列─▶ orderCtx/locationCtx
PhoneShell(60-87) ─screen分支─▶ DeliveryApp ◀─ types.ts ScreenId + HomeCarousel APPS[]
wallet-store ◀─ 下单扣款/回赠挂账/收下入账（零改动复用）
wrapCitable(493) ─排除条件─▶ + !entry.location && !entry.order（卡片不挂重新回复）
MessageActions ─长按引用仍可用（fmt 已覆盖卡片文本）
```

## 5. 回归与兼容风险
| 风险点 | 是否破坏现有行为 | 兼容策略 | 回归测试点 |
|---|---|---|---|
| ChatEntry 新增 location/order 可选字段 | 否 | 旧存档无字段天然 undefined | 老会话打开、继续聊天 |
| buildSys 追加两段协议 | token 变长 | 放在 TRANSFER_PROTOCOL 之后集中拼接 | 普通文字聊天回复正常 |
| toHist fmt 改分支 | 是（共用函数） | 只在有对应字段时走新分支 | 转账卡、剧情模式、重新回复不受影响 |
| HomeCarousel APPS 加项 | 布局挤压 | 网格自动换行，必要时屏2 Bento 加入口 | 桌面两屏轮播、Dock 未读角标 |
| 钱包扣款 | 与转账共账 | 复用同一 wallet key | 余额校验、负数挂账、流水记录 |

## 6. 涉及文件定位
- `/home/project/src/lib/chat-types.ts`：location/order 字段、LOCATION_PROTOCOL、ORDER_PROTOCOL、extractLocation/extractOrder
- `/home/project/src/components/RoleChatApp.tsx`：输入栏按钮、LocationPanel、sendLocation/sendOrder、digest*、settleReply、buildSys、toHist、fmt、卡片渲染组件（LocationCard/OrderCard）、详情弹层、wrapCitable 排除
- `/home/project/src/lib/delivery-store.ts`（新建）：店铺/菜单常量池、订单历史 usePersisted(`vp-phone:delivery-orders:v1`)
- `/home/project/src/components/DeliveryApp.tsx`（新建）：店铺列表/下单/历史三视图
- `/home/project/src/lib/types.ts`：ScreenId 加 `"delivery"`
- `/home/project/src/components/PhoneShell.tsx`：import + screen 分支
- `/home/project/src/components/HomeCarousel.tsx`：APPS 数组加入口
- `/home/project/src/styles.css`：如需定位卡/礼物卡专属渐变类再补（优先 Tailwind 内联）

## 7. 验收标准
1. 桌面出现「外卖」图标，点进可见店铺列表，进店可选品、调数量、看小计。
2. 选「送到 TA 那里」下单 → 回到与该角色的聊天，出现外卖订单卡，TA 在正在输入中后针对外卖内容回应（提到店名/品项/让你破费等）。
3. 选「包装成礼物」带留言发送 → 聊天出现礼物卡；点卡片可查看详情并「收下」。
4. 用户余额不足时下单被拦并提示；TA 回赠的外卖/礼物会扣角色余额（允许负数）。
5. 输入栏定位按钮 → 选地点 → 聊天出现定位卡片，TA 对地点作出符合人设的反应。
6. TA 主动消息/报备时可自行发出定位卡或外卖卡（概率性，靠协议引导）。
7. 刷新页面后定位卡、订单卡、订单历史仍在；旧会话（无新字段）打开不报错。
8. 剧情模式下历史订单/定位以文本承接，不出现渲染错乱；转账、重新回复、连发等既有功能不受影响。
9. `pnpm run build` 通过、预览无白屏。

## 8. 不改动范围
- 不接任何真实外卖/地图 API，全部为模拟数据与本地持久化；
- 不改动转账、语音、生图、世界书、热梗、人物档案模块；
- 不新增后端云服务（沿用 localStorage 单机存档）。