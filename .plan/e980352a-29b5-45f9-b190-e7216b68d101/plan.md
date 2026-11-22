# 需求文档

## 应用概述
在现有「浏览器虚拟小手机」网页应用中完成两项迭代：①语音朗读新增 MiniMax TTS 通道，玩家在设置里填入 MiniMax API Key 即可接入，接入成功时界面明确提示"已成功"；②聊天页开场白完整档案卡的"一键收起"按钮从卡片底部移到卡片最上方。

## 用户与使用场景
- 目标用户：已在用小手机、手里有 MiniMax API Key 的玩家
- 场景1：设置 → 外部语音（TTS）→ 选择 MiniMax 通道 → 粘贴 Key → 点"测试并保存" → 显示绿色"已成功"，回聊天页消息旁出现朗读按钮，点击即听到 MiniMax 合成语音
- 场景2：进入角色会话，开场白完整档案卡顶部就有"收起开场白"按钮，不用滑到卡片末尾才能收起

## 页面结构与功能说明
### 1. 设置页 · VoiceSection（外部语音 TTS）
- 顶部新增通道切换按钮组：**通用网关（OpenAI 兼容）/ MiniMax**（参照生图 ImageSection 的 OpenAI/Pollinations 切换样式）
- 选 MiniMax 时表单变为：
  - **API Key** 输入框（必填，password 型）
  - **接口区域** 切换：国内 `api.minimax.chat` / 国际 `api.minimaxi.com`（默认国内）
  - **模型** 输入框（默认 `speech-02`，可改 `speech-2.5-hd-preview` 等）
  - **音色** 输入框 + 常用男声快捷选择（如 male-qn-qingse 青涩青年等，MiniMax voice_id 直接填角色绑定的 voiceId 即可复用现有"角色绑音色"链路）
- 底部按钮改为 **"测试并保存"**：先真实调用一次 MiniMax t2a_v2 接口合成一小段试听文本（如"你好"），成功后才写入 localStorage 并把按钮文字变为绿色 **"已成功"**（停留约 2.5s 恢复）；失败则红色提示具体原因（Key 无效 / 余额不足 / 网络不通），不保存
- 选通用网关时保持现有 baseUrl/apiKey/model/音色列表 UI 不变，保存逻辑不变

### 2. 语音数据层（src/lib/tts.ts）
- VoiceConfig 新增字段：`provider: "openai" | "minimax"`（默认 "openai"）、`minimaxKey: string`、`minimaxRegion: "cn" | "global"`（默认 cn）、`minimaxModel: string`（默认 speech-02）、`minimaxVoice: string`（默认 male-qn-qingse）
- `loadVoiceConfig` 的 `{...DEFAULT, ...parsed}` 浅合并天然兼容旧存档（已验证），无需迁移
- `voiceReady`：provider=minimax 时只要求 minimaxKey 非空（不再依赖聊天接口回落）
- 新增 `synthesizeMiniMaxSpeech(vc, text, voiceId)`：POST `https://api.minimax.chat|api.minimaxi.com/v1/t2a_v2`，header `Authorization: Bearer <key>`，body `{model, text(截600字), voice_id, audio:{format:"mp3", sample_rate:32000}}`；响应校验 `base_resp.status_code===0` 且 `data.audio` 存在，把 hex 字符串转 Uint8Array → Blob("audio/mpeg") → objectURL 返回；status_code≠0 时翻译成中文错误（1002=限流、1004/1001=Key无效、1008=余额不足等）
- `synthesizeSpeech` 开头按 provider 分流：minimax 走新函数，openai 走原逻辑不动
- 新增 `testMiniMaxVoice(vc)`：调一次极短合成供设置页"测试并保存"用

### 3. 聊天页朗读链路（RoleChatApp.tsx）
- speak() / canSpeak 均通过 loadVoiceConfig+voiceReady/synthesizeSpeech 工作，**无需改动**——provider 分流在 tts.ts 内闭环；日志 `[tts] synth ok provider=minimax` / `[tts] synth fail …` 打印关键结果

### 4. 开场白卡收起按钮上移（ProfileSheet.tsx）
- InlineProfileCard：把 sticky bottom-0 的"一键收起"按钮行从 ProfileBody 之后移到卡片内容最顶部（非 sticky，随卡片自然置顶），底部渐变遮罩条删除
- OpenerCard 同步：收起按钮同样置于卡片最上方，两处样式统一（圆角胶囊、ChevronDown 图标保留）

## 业务规则
- MiniMax Key 只存 localStorage，代码中不出现任何真实密钥
- "已成功"仅在真实合成一段音频返回后才显示；仅填 Key 不点测试不算接入成功
- 角色编辑页音色绑定：provider=minimax 时，voiceId 直接手填 MiniMax voice_id（现有"不绑定"选项保留）
- 切回通用网关通道后，原 OpenAI 兼容配置仍完整保留（两套字段并存互不覆盖）

## 异常与边界情况
| 场景 | 处理方式 |
|------|---------|
| Key 为空点测试 | 按钮禁用，提示"先填 Key" |
| 网络不通/CORS 失败 | 红色提示"连不上 MiniMax 服务器，检查网络或换区域重试"，不保存 |
| base_resp.status_code≠0 | 按状态码翻译成人话显示，不保存 |
| data.audio 为空 | 提示"接口通了但没返回音频，检查模型/音色名" |
| 旧版 voiceconfig 无 provider 字段 | 浅合并自动回落 "openai"，行为与现在完全一致 |
| 国际区账号填了国内 Key（反之亦然） | 区域切换按钮明示，测错区域会报 Key 无效，切换重测即可 |

## 验收标准
1. 设置页语音区能看到"通用网关 / MiniMax"两个通道按钮，切 MiniMax 出现 Key/区域/模型/音色四个输入项
2. 填入有效 MiniMax Key 点"测试并保存"，按钮变绿显示"已成功"，刷新设置页配置仍在
3. 故意填错 Key 点测试，显示失败原因且不保存（重开仍是旧值）
4. 接入成功后回聊天页，角色回复旁出现朗读按钮，点击能播放 MiniMax 语音；控制台有 [tts] 成功日志
5. 进任意角色会话，开场白完整档案卡**第一屏顶部**就能看到"收起开场白"按钮，点击立即收为折叠白条；卡片底部不再有按钮残留
6. 切回"通用网关"通道，原有 baseUrl/apiKey 配置和朗读行为不受影响

## 本期不实现
- 不做 MiniMax 试听音色列表在线拉取（手填 voice_id + 预置几个常用男声快捷项）
- 不动克隆音色、字幕对齐等其他 MiniMax 能力
- 不改剧情模式渲染逻辑与朋友圈配图

## 涉及文件定位
- `/home/project/src/lib/tts.ts`：VoiceConfig 扩展、synthesizeMiniMaxSpeech、testMiniMaxVoice、provider 分流
- `/home/project/src/components/SettingsApp.tsx`（第427-473行 VoiceSection）：通道切换 + MiniMax 表单 + 测试并保存反馈
- `/home/project/src/components/ProfileSheet.tsx`（第471-529行 OpenerCard/InlineProfileCard）：收起按钮移至顶部
- `/home/project/src/components/RoleChatApp.tsx`：预计零改动（链路自动生效），仅必要时补日志

## 风险与回归
- speak/canSpeak 由 voiceReady 控制，需确认 provider=minimax 且无聊天接口配置时朗读按钮仍能出现（voiceReady 分支已覆盖）
- MiniMax 浏览器直连可能存在 CORS 限制：若实测被拦，降级方案是提示"需在支持跨域的网关环境使用"并如实告知，不引入自建后端（平台不支持）
- 收起按钮上移不影响 openerCollapsed/滚动触底自动收起等既有状态机