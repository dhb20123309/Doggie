# AGENTS.md

## 依赖
- 无额外第三方依赖（仅使用模板内置的 shadcn/ui、lucide-react、TanStack Router）。

## 架构
- `src/lib/types.ts`：共享契约（AiConfig 含 temperature / TestResult / ScreenId：home|settings|chat|rolechat|worldbook|sticker / normalizeBaseUrl）。
- `src/lib/ai-api.ts`：OpenAI 兼容对接层。getCandidates 候选地址兜底（不带 /vN 时自动补 /v1 再试一次，404 才换候选）；fetchModelList 拉模型列表；testConnection/chatCompletion 均走候选；错误按状态码翻译成人话。
- `src/lib/chat-types.ts`：Character（含 boundWorldBookIds）/ ChatEntry / SendPrefs / splitBubbles。
- `src/lib/worldbook.ts`：世界书（global/local 过滤 + 拼 system prompt）与表情包（buildStickerHint 名单约束 + parseReplyToMessages 解析 [表情:名字]，未知名字退回文字、结尾未闭合标记丢弃）。
- `src/lib/config-store.ts`：API 配置存 localStorage（vp-phone:aiconfig:v1）；代码中禁止出现真实密钥。
- `src/lib/chat-store.ts`：usePersisted 通用 hook；角色/聊天记录/发送习惯/世界书/表情库存 vp-phone:* 各 key。
- `src/components/RoleChatApp.tsx`：聊天主页，内部视图 chat/edit/prefs/worldbooks/stickers；发送前现算 system = 人设+分条指令+生效世界书+表情名单。
- `src/styles.css`：jelly-btn/jelly-icon/jelly-blob 果冻反馈类——按下 ≤0.08s 快压、松开 cubic-bezier 过冲慢弹回，只动 transform，不与美化层冲突；交互组件统一挂这些类。毛玻璃原子类 glass/glass-strong/glass-input/glass-nav/app-icon-glass；锁屏专用 lock-scrim（整屏压暗层）/key-soft（半透明白底数字键，无 backdrop-filter）/lock-content（仅 opacity 入场）。
- `src/lib/lock-store.ts`：密码 vp-phone:lockpass:v1（默认 0517）+ 锁屏/桌面壁纸 vp-phone:*-wallpaper:v1（默认 CDN 粉彩壁纸 URL），usePasscode/useLockWallpaper/useHomeWallpaper。
- `src/lib/photo-store.ts`：相册 usePhotos（复用 chat-store 的 usePersisted，key vp-phone:photos:v1），相机拍照与导入均写这里。
- `src/components/LockScreen.tsx`：壁纸独立 absolute 层 + lock-scrim 遮罩 + 内容 relative z-10；数字键盘校验通过才触发 lock-unlock 上滑动画。
- `src/components/ShellApps.tsx`：相册/相机/记忆中枢/音乐四个壳应用 + 共享 ShellNav（glass-nav 顶栏）；音乐为本地演示曲库不含真实音源。
- `src/lib/chat-store.ts`：多角色持久化——characters:v2（首次预置周晨砚/周风砚，人设由导入的角色卡提炼）、rolechat-log:{charId} 分会话、active-character:v1；世界书首次预置《周氏双子》local 条目；PROACTIVE_LINES 主动消息示例池；usePersisted 已导出。
- `src/lib/import-parse.ts`：角色卡 md 解析（标题提取角色名 + [System Note] 起正文为人设）、世界书 md 按 ## 分节拆 local 条目、cardToCharacter 生成完整角色。
- `src/lib/tts.ts`：外部语音通道 VoiceConfig（vp-phone:voiceconfig:v1，地址/Key 留空回落聊天接口）；synthesizeSpeech 走 /audio/speech 候选兜底；角色 voiceId 单独绑音色。
- `src/lib/media.ts`：音乐真机播放（vp-phone:music-urls:v1 音频直链列表）+ generateCharPhoto 走 /images/generations、失败回落预置 CDN 日常照（auth_key 必须完整保留）。
- `src/components/RoleChatApp.tsx`：微信式会话列表（ConversationList）→ 单会话 chat；view 含 import 一键导入；前情提要小灰框（仅角色主动找过且用户未回复时一句话）；主动消息定时器（闲置 5 分钟概率触发写对应会话）；表情库可点发（stickerUrl）；朗读按钮（voiceReady 才显示）。
- `src/components/PhoneShell.tsx`：locked 状态入口，LockScreen → 桌面路由分发；SettingsApp 收 wallpapers setter 与 onLock；URL 参数 vpDesk/vpApp 仅供截图验收直达页面。
- 聊天背景可上传替换：lock-store.useChatBackground（key vp-phone:chat-bg:v1，默认 CDN 奶油图）→ PhoneShell → SettingsApp 第三个 WallpaperPicker + RoleChatApp background prop。
- 暖淡黄设计系统：styles.css token hue 75-92；气泡用 .bubble-cream/.bubble-me（大圆角奶油毛玻璃、无粗边框）；时间戳 .msg-time（读 ChatEntry.at 纯展示）；Avatar status 属性叠加在线/输入中/离线圆点。

## Lessons
- 祖先元素做 transform 动画会破坏后代 backdrop-filter（内容变糊/半透明）：入场动画容器只动 opacity（lock-fade），玻璃子元素不做 transform 祖先；壁纸放独立 absolute 层。
- 浅色壁纸上白字对比度不足：用整屏 rgba 压暗层（lock-scrim）+ textShadow，不要用渐变遮罩（截图时机易出现局部空白）。
- Button 没有 "success" variant；成功态用自定义 CSS token（--color-success）配合边框/背景类。
- 外部网关返回 401 属鉴权业务失败（Key 错误/缺失），不是前端代码问题。
- 非 async 回调里不能 await（如 onChange 处理压缩图片），改 .then 写法。
- 表情/头像图片必须转 base64 data URL 持久化，blob URL 刷新即失效导致裂图；上传时 canvas 压缩到 200KB 内。
