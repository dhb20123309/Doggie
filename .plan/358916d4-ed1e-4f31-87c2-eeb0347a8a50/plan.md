# 需求文档

## 1. 改动目标

两件事：
1. **手机打开 GitHub Pages 网页看不到更新**（沙箱预览是新的）——确诊为 Pages 缓存与发布链路问题，修复到"pull+push 后手机上能稳定看到新版"。
2. **用户开口要照片，角色就发图**：当用户说"报备一下""看看照片""分享照片""拍一张"等诸如此类的话时，角色自动生成一张贴合人设的日常照片发给用户，并附上文字消息；若生图不可用（无额度/接口失败），只回文字，不报错、不卡死。

## 2. 现状分析（取证结论）

### 问题① 线上不同步（已实测取证）
- `raw.githubusercontent.com/DHB20123309/Doggie/main/index.html` 返回的是**源码版 index.html**（含 `<script src="./src/main.tsx">`）——说明 main 分支推的是源码而非构建产物。
- Pages 站点 `https://dhb20123309.github.io/Doggie/` 响应头 `cache-control: max-age=600`、`last-modified: Nov 23`——**GitHub CDN 边缘缓存最长 10 分钟 + 手机浏览器自身还会再缓存 HTML**。
- 结论：这是两层叠加——(a) push 后 Pages 生效有延迟属正常；(b) 即便生效了，手机浏览器 10 分钟内仍可能拿旧 HTML 引用旧 JS。项目此前已有 hash 路由改造（刷新不再 404），本次只需解决"缓存穿透"。

### 问题② 被动要照片链路（Explore 测绘）
- 现在只有**主动消息**链路会附带照片（RoleChatApp L1531-1560：photoEnabled + 30% 概率 + 15 分钟冷却 → generateCharPhoto → ChatEntry{photoUrl}）；**用户主动索要照片时完全不会触发**。
- 可照抄的现成模式：
  - `[转账:金额:备注]` 标记协议：`TRANSFER_PROTOCOL` 拼入 buildSys → `digestTransfer`（L615-621）解析标记 → `settleReply` 落库带扩展字段——照片走同款"标记→解析→异步生成→落库"。
  - `looksLikeReceive`（chat-types.ts L121-123）自然语言兜底检测先例。
  - `isOocLine` 的 `MONEY_OK_RE` 白名单先例（L234）——防止 `[照片:]` 标记行被出戏过滤误杀。
  - `lastPhotoAt(charId)`（L154-179）扫描该角色所有 photoUrl 消息算冷却，**主动/被动共用同一张冷却表**，天然防连发爆额度。
- 渲染层 L2886-2892：assistant 消息带 photoUrl+content 时图上文下同条展示，**零改动**。
- `generateCharPhoto` 四级通道全失败时返回定妆照 URL（永不空手）；但"无生图额度"场景需要区分：**网关报错时应回落纯文字而不是硬塞定妆照**——需给生图结果加"真实出图/兜底图"判别。

## 3. 方案

### A. 线上同步修复（不改业务代码）
1. **index.html 加禁缓存 meta**（no-cache/no-store），让手机浏览器每次都向 Pages 询问最新版；配合现有 hash 路由，JS/CSS 带内容哈希文件名天然安全。
2. **deploy.yml 确认发布流程健康**（已有 Verify dist integrity 步骤），并在交付说明里给出正确的发布节奏提示：push 后等 1-2 分钟构建 + 最多 10 分钟 CDN 过期；手机上可长按刷新或清一次站点数据立即见效。
3. 交付时附一段自查命令，供用户在本地验证 main 分支确实包含新 commit。

备选（不做）：给 Pages 配 purge 缓存 API——GitHub Pages 不提供主动清缓存接口，无法实现。

### B. 被动要照片（chat-types.ts + RoleChatApp.tsx + media.ts）
1. **协议层**（chat-types.ts 新增，照 TRANSFER_PROTOCOL 风格）：
   - `PHOTO_PROTOCOL`：教模型——对方想看你的照片/要你报备现场时，在回复里单独一行写 `[照片:一句话场景]`（场景须贴合当前话题与人设，遵守俯拍不露脸协议）；不想发或不方便发就不写，用文字自然带过。拼入 buildSys 私聊分支（TRANSFER_PROTOCOL 旁）。
   - `extractPhoto(text)`：解析 `[照片:场景]` 标记，返回 `{ scene, clean }`（标记行从正文剥离）。
   - `PHOTO_REQUEST_RE` + `looksLikePhotoRequest(text)`：识别用户话术（报备|查岗|视频|照片|拍照|拍一张|给我看|露个脸|长什么样 等），用于兜底注入。
   - `PHOTO_OK_RE = /\[照片[:：]/` 加入 isOocLine 白名单开头，防标记行被出戏过滤误杀。
2. **兜底层**（RoleChatApp requestReply）：本轮最后一条用户消息命中 `looksLikePhotoRequest` 且模型没写标记时，在 system 追加一句强指令"对方在要照片，这次必须用 [照片:场景] 回应（除非人设此刻确实不方便）"重试一次——治模型忘记协议。
3. **落库层**：
   - `digestPhoto(reply, ch, config)`：命中标记 → `matchPhotoScene` 或直接用标记里的场景词 → `generateCharPhoto(...)`；生图成功（返回非定妆照兜底）才把 photoUrl 与清洗后的文字一起 settleReply；**生图失败/无额度 → 只落文字**（模型自己的回复文本天然就是"附上的文字消息"），日志 `[photo] passive fail no-image`。
   - `settleReply` 签名追加 `photoUrl?: string`，落库 `...(photoUrl ? { photoUrl } : {})`。
   - 冷却策略：被动请求**不受 15 分钟冷却限制**（用户开口要就该给），但仍受 `ch.photoEnabled` 开关约束；连续多条要照片请求之间加 60 秒轻冷却防爆额度（新常量 `PHOTO_PASSIVE_COOLDOWN_MS = 60_000`）。
4. **media.ts 小改**：`generateCharPhoto` 返回值改为可判别来源——新增导出 `generateCharPhotoSafe(...): Promise<string>`（成功返回图 URL，全失败返回空串，不自动塞定妆照），被动链路用它，失败即纯文字；主动链路维持原函数（定妆照兜底）不动。

## 4. 涉及文件定位

| 文件 | 改动 |
|---|---|
| `/home/project/index.html` | head 加 no-cache meta |
| `/home/project/src/lib/chat-types.ts` | PHOTO_PROTOCOL / extractPhoto / looksLikePhotoRequest / PHOTO_OK_RE 白名单 |
| `/home/project/src/components/RoleChatApp.tsx` | buildSys 拼 PHOTO_PROTOCOL；requestReply 加 digestPhoto + 兜底强指令重试；settleReply 加 photoUrl 参数 |
| `/home/project/src/lib/media.ts` | 新增 generateCharPhotoSafe（失败返空串版本） |

## 5. 实现步骤
1. chat-types.ts：协议文本 + 三个纯函数 + OOC 白名单。
2. media.ts：generateCharPhotoSafe。
3. RoleChatApp.tsx：buildSys 接线 → digestPhoto → settleReply 扩参 → 兜底重试。
4. index.html 禁缓存 meta。
5. `npx tsc --noEmit` + `pnpm run build` 双门禁 → `pnpm run dev` 重启 → git commit + `git branch -f main HEAD` + bundle 导出 → AGENTS.md 静默增补。

## 6. 验收标准
1. 聊天里对开启照片开关的角色发"报备一下"或"给我看张照片"→ TA 的回复下方出现一张日常照片+文字消息；控制台可见 `[photo] passive ok model=…`。
2. 把生图地址改成无效值（或额度耗尽）再要照片 → TA 只回文字，无红错、无假图。
3. 关闭「会分享写实日常照片」开关的角色，要照片时不发图。
4. 模型自己主动写了 `[照片:…]` 标记（用户没明说要）也会发图。
5. 按 bundle 同步推送后，手机浏览器打开 Pages 地址能看到本轮新版（必要时等几分钟或强刷一次）。

## 7. 风险与回归
- 回归点：主动消息附带照片（30%+15min 冷却）行为不变；转账/定位/订单标记解析不受影响；OOC 过滤仅多一条白名单。
- 风险：兜底强指令重试会让"要照片但模型没写标记"的场景多一次 API 调用（仅命中关键词时发生，成本可控）。
- 风险：`[照片:场景]` 若模型把标记写进行文中间，extractPhoto 按整行剥离，残留标点由既有 trim 处理。

## 8. 本期不做
- 不做聊天输入框旁的"手动拍照"按钮（保持自然语言触发）。
- 不做角色级生图地址/密钥（仍全局一套，角色只绑模型）。
- 不为 Pages 引入 Service Worker 离线缓存体系（与"及时看到更新"目标相反）。