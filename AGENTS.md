# AGENTS.md

## 依赖
- 无额外第三方依赖（仅使用模板内置的 shadcn/ui、lucide-react、TanStack Router）。

## 架构
- `src/lib/types.ts`：共享契约（AiConfig 含 temperature / TestResult / ScreenId：home|settings|chat|rolechat|worldbook|sticker|diary|phonepeek|bond|preference|theater|profile / normalizeBaseUrl）。
- `src/lib/ai-api.ts`：OpenAI 兼容对接层。getCandidates 候选地址兜底（不带 /vN 时自动补 /v1 再试一次，404 才换候选）；fetchModelList 拉模型列表；testConnection/chatCompletion 均走候选；错误按状态码翻译成人话。
- `src/lib/proactive-protocol.ts`：主动消息活人感协议（改编自用户提供的 by小K Avail 文档，话题库按原文全量收录不删减）——PROACTIVE_PROTOCOL 拼入 fireOne 的 system（具体起点+连接点+落脚点三段式、话题型70%/报备型30%、禁"在干嘛/醒了没/想你了"等句式）；TOPIC_LIBRARY 十大类话题种子 + pickTopicSeeds() 每次随机取两类作引子、明令禁止照抄。PROACTIVE_LINES 兜底池同步改为带细节句式。
- `src/lib/worldbook.ts`：世界书（global/local 过滤 + 拼 system prompt）与表情包（buildStickerHint 名单约束 + parseReplyToMessages 解析 [表情:名字]，未知名字退回文字、结尾未闭合标记丢弃）。
- `src/lib/config-store.ts`：API 配置存 localStorage（vp-phone:aiconfig:v1）；代码中禁止出现真实密钥。
- `src/lib/chat-store.ts`：usePersisted 通用 hook（key 变化时必须重读 localStorage——曾因此串会话；渲染期比对 prevKey + setValue，不用 useEffect）；角色/聊天记录/发送习惯/世界书/表情库存 vp-phone:* 各 key。预置角色头像=用户上传定妆照 CDN（PHOTO_CHENYAN 白帽/FENGYAN 条纹衬衫），migratePresetAvatars 在 useCharacters 读取时把老数据的 emoji/旧头像按 id 覆盖回定妆照（用户手动换过的长地址不动）。
- **互动剧情模式（对标 Mufy）**：Character.storyMode 开关——聊天页顶栏「剧情」按钮与角色设定页 Switch 均可切换；开启后 buildSys(ch, true) 换拼 STORY_PROTOCOL（玩家第二人称"你"、男主第三人称、文笔细腻平缓递进、严格不OOC、承接全部历史禁无逻辑推进、一到两段正文不分条）；该链路 toHist 给玩家消息包装前文叙述转"二你"+人称锚点，assistant 历史原样保留（记忆与私聊互通同一份 rolechat-log）；settleReply 只标记新产出 reply 为 story（含触发用户消息），渲染层 entry.story/prevStory 统一进中间浅灰剧情框（whitespace-pre-wrap，用户消息显示"你：xxx"，不用气泡）；fireOne 主动 tick 跳过 storyMode 角色（剧情模式无不请自来碎句）；关键日志 [story] toggle / [reply] start story=on/off。
- `src/lib/chat-types.ts` 的 CHAT_LIVENESS：活人感对话铁律（接话优先——必须先回应对方最后一条消息、绝对禁止无视话题自说自话、答非所问算严重失败；短句口语化、一次最多两三条；记忆连贯，顺带提起聊过的事；每行一条无旁白；禁复读——不许复用之前说过的句子和口头禅，同一件事换新角度或开新话题），拼入 buildHistory 与 RoleChatApp buildSys 的 system（历史 messages 原样保留不清空）；buildSys 另有【最近对话】锚点标注对方身份；requestReply start 日志带 sysLen 可确认协议生效。isRepetitiveReply(reply, prevEntries)：新回复与最近两条 assistant 逐行（≥6 字的行）重合 ≥50% 判复读；被动链路 requestReply 复读命中即带"换全新说法"指令 regen（regenWith 内二级抢救），主动链路 fireOne 同样检测（readLastEntries 取最近两条）、重生成仍复读则本轮跳过不发；关键日志 [reply] repetitive / [proactive] repetitive。
- `src/components/RoleChatApp.tsx`：聊天主页，内部视图 chat/edit/prefs/worldbooks/stickers；发送前现算 system = 人设+分条指令+生效世界书+表情名单。回复链路：flushDraft 发完立即 requestReply（不再只靠倒计时 effect）；requestReply 至少显示 1.2s"正在输入中"再出字，失败自动退避重试一次（401/403/400 不重试），倒计时 effect 仅作兜底补发；关键日志 [reply] start/ok/fail。**后台回复不打断**：requestReply 开头快照角色/config/system，结果经 settleReply 直写 vp-phone:rolechat-log:{charId}（退出聊天页、切会话都不丢），当前仍打开该会话才同步刷新界面；用户消息 flushDraft/generate 先 setLog 同步上屏再 writeLogNow 直写存储（顺序反了会被进会话对齐的旧快照覆盖，曾导致自己发的消息要退出重进才可见）；进入会话时 logKeyRef 比对、JSON.stringify 全量比对存储与界面（只比长度会漏掉"本地多一条待发用户消息"的场景），不一致则以存储为准对齐并打 [reply] align 日志。OOC 出戏话过滤两级抢救：sanitizeReply 整条滤空时先普通提示 regen，仍出戏用强指令（恋人身份接话、禁"AI/模型/程序/能力范围"字眼）重试第二次，三次都出戏才标记可重试，关键日志 [reply] OOC filtered/regen still OOC/regen ok/fail。
- `src/styles.css`：jelly-btn/jelly-icon/jelly-blob 果冻反馈类——按下 ≤0.08s 快压、松开 cubic-bezier 过冲慢弹回，只动 transform，不与美化层冲突；交互组件统一挂这些类。毛玻璃原子类 glass/glass-strong/glass-input/glass-nav/app-icon-glass；锁屏专用 lock-scrim（整屏压暗层）/key-soft（半透明白底数字键，无 backdrop-filter）/lock-content（仅 opacity 入场）。
- `src/lib/lock-store.ts`：密码 vp-phone:lockpass:v1（默认 0517）+ 锁屏/桌面壁纸 vp-phone:*-wallpaper:v1（默认 CDN 粉彩壁纸 URL），usePasscode/useLockWallpaper/useHomeWallpaper。
- `src/lib/photo-store.ts`：相册 usePhotos（复用 chat-store 的 usePersisted，key vp-phone:photos:v1），相机拍照与导入均写这里。
- `src/components/LockScreen.tsx`：壁纸独立 absolute 层 + lock-scrim 遮罩 + 内容 relative z-10；数字键盘校验通过才触发 lock-unlock 上滑动画。
- `src/components/ShellApps.tsx`：相册/相机/记忆中枢/音乐四个壳应用 + 共享 ShellNav（glass-nav 顶栏）；音乐为本地演示曲库不含真实音源。
- `src/lib/chat-store.ts`：多角色持久化——characters:v2（首次预置周晨砚/周风砚，人设由导入的角色卡提炼）、rolechat-log:{charId} 分会话、active-character:v1、chat-read:v1 已读水位；世界书首次预置《周氏双子》local 条目；PROACTIVE_LINES 仅作模型调用失败兜底；presetPhoto(charId) 返回用户定妆照 CDN URL（auth_key 必须完整保留）；unreadCount/useReadMarks 供未读角标。
- `src/lib/import-parse.ts`：角色卡 md 解析（标题提取角色名 + [System Note] 起正文为人设）、世界书 md 按 ## 分节拆 local 条目、cardToCharacter 生成完整角色。
- `src/lib/tts.ts`：外部语音通道 VoiceConfig（vp-phone:voiceconfig:v1，地址/Key 留空回落聊天接口）；synthesizeSpeech 走 /audio/speech 候选兜底；角色 voiceId 单独绑音色。
- `src/lib/media.ts`：音乐真机播放（vp-phone:music-urls:v1 音频直链列表）+ 独立生图通道 ImageConfig（vp-phone:imageconfig:v1，mode=openai 自定义网关/pollinations 免费免 Key；留空回落聊天接口 /images/generations，全失败回落预置 CDN 日常照，auth_key 必须完整保留）；pollinations 结果必须转 data URL 持久化（blob URL 刷新裂图）。
- `src/components/RoleChatApp.tsx`：微信式会话列表（ConversationList）→ 单会话 chat；view 含 import 一键导入；发送习惯默认 sendReplacesGenerate=true（点发送即自动回复、无需手动确认，旧数据经 vp-phone:send-prefs:migrated-v1 标记一次性迁移）；主动消息闲置 1 分钟即可能触发（每 20s 检查、75% 概率、一轮可连发 1-2 条间隔数秒），模型实时生成（失败回落 PROACTIVE_LINES），entry.proactive 标记；照片由主动消息小概率附带自动发（30% 概率、同角色 15 分钟冷却，配文先由模型现写、失败回落场景模板池，无手动分享按钮）；未打开会话头像红字未读角标、进入即清；列表顶栏"TA 们正在酝酿消息…"徽标；前情提要小灰框；表情库可点发（stickerUrl）；朗读按钮（voiceReady 才显示）。
- `src/components/PhoneShell.tsx`：locked 状态入口，LockScreen → 桌面路由分发；SettingsApp 收 wallpapers setter 与 onLock；URL 参数 vpDesk/vpApp 仅供截图验收直达页面。
- 聊天背景可上传替换：lock-store.useChatBackground（key vp-phone:chat-bg:v1，默认 CDN 奶油图）→ PhoneShell → SettingsApp 第三个 WallpaperPicker + RoleChatApp background prop。
- 暖淡黄设计系统：styles.css token hue 75-92；气泡用 .bubble-cream/.bubble-me（大圆角奶油毛玻璃、无粗边框）；时间戳 .msg-time（读 ChatEntry.at 纯展示）；Avatar status 属性叠加在线/输入中/离线圆点。
- Companion OS（第17轮）：`src/lib/companion-store.ts` 数据层——ICON_URLS（grid9 抠图萌系图标 CDN，auth_key 完整保留）、AVATAR_BG、日记 useDiaries/diaries:v1+seedDiaries 种子、便签 memo:v1、羁绊 bond:v1（startDate 自动取最早聊天）、偏好 prefs-about-me:v1、查手机缓存 phone-peek:v1、昵称 profile:v1、两个分支剧本 SCRIPTS；桌面默认壁纸改为 lock-store.DEFAULT_HOME_WALLPAPER=奶油渐变 CDN 图。`src/components/HomeCarousel.tsx` 双屏轮播（Pointer Events 拖拽 >8px 接管、±140 阻尼、|dx|>60 翻页；屏1=时钟/问候胶囊/头像底座/日记预览/音乐胶囊/5 App 网格，屏2=Bento 番茄钟+天色+便签+心事卡；底部 glass Dock 相册/消息/设置三键平齐+未读红点）。`src/components/CompanionApps.tsx` 六子应用（Diary/PhonePeek/Bond/Preference/Theater/Profile），PhoneShell 按 ScreenId 路由分发；旧 HomeScreen.tsx 已删除。头像底座用实底 oklch 渐变（半透明 backdrop-blur 会透壁纸）。

## Lessons
- 祖先元素做 transform 动画会破坏后代 backdrop-filter（内容变糊/半透明）：入场动画容器只动 opacity（lock-fade），玻璃子元素不做 transform 祖先；壁纸放独立 absolute 层。
- 浅色壁纸上白字对比度不足：用整屏 rgba 压暗层（lock-scrim）+ textShadow，不要用渐变遮罩（截图时机易出现局部空白）。
- Button 没有 "success" variant；成功态用自定义 CSS token（--color-success）配合边框/背景类。
- 外部网关返回 401 属鉴权业务失败（Key 错误/缺失），不是前端代码问题。
- 非 async 回调里不能 await（如 onChange 处理压缩图片），改 .then 写法。
- 表情/头像图片必须转 base64 data URL 持久化，blob URL 刷新即失效导致裂图；上传时 canvas 压缩到 200KB 内。
