# 需求文档

## 1. 改动目标

两件事：
1. **修正生图通道的"连接测试"**：现在它调用的是聊天接口的 `testConnection`（发最小 chat 请求），测的根本不是生图能力——用户截图里 503 报错就是拿聊天模型名去撞生图网关的结果。改成**真正测试生图通道本身**：用当前填写的生图模型实际发起一次小尺寸生图请求，能出图才算通过。
2. **生图功能绑定角色**：每个角色可以单独选择生图模型（覆盖全局配置），角色"分享日常照片"（主动消息附带照片）时走该角色绑定的生图通路生成日常照发给用户。

## 2. 现状分析（Explore 取证结论）

- `src/lib/media.ts` L223-251 `generateCharPhoto(cfg, prompt, fallbackUrl)`：通道顺序 = pollinations → 自定义 OpenAI 网关（ic.baseUrl）→ 回落聊天接口 `/images/generations` → 全失败返回定妆照；**所有角色共用一套 ImageConfig，无角色级配置**。
- `src/components/SettingsApp.tsx` L627-648 `ImageSection.testChannel()`：❌ 误用 `testConnection`（ai-api 的最小 chat 请求），这就是要修的点；L709-711 为按钮 UI。
- `src/components/RoleChatApp.tsx` L1531-1560 主动照片链路：`ch.photoEnabled && Math.random()<0.3 && 距上次>15min` → `matchPhotoScene(recentText)` 匹配场景 → 模型现写配文 → `generateCharPhoto(config, photoPrompt(ch.name, ch.persona, scene), presetPhoto(ch.id))` → 写入 `ChatEntry{photoUrl}`（渲染层 L2881-2887 已支持展示）。
- `src/lib/chat-types.ts` L3-27 `Character`：已有 `voiceId/minimaxVoiceId/photoEnabled/proactiveFreq` 等角色级字段先例，新字段可选、旧数据零迁移。
- 角色设定页开关参照：RoleChatApp L3454-3465（photoEnabled Switch）+ L1767 onTogglePhoto 回调。
- `images/generations` 全仓仅 media.ts 5 处调用，无其他入口需要动。

## 3. 方案

### A. 真实生图连接测试（media.ts + SettingsApp.tsx）
- media.ts 新增导出 `testImageChannel(ic: ImageConfig, cfg: AiConfig): Promise<{ ok: boolean; detail: string }>`：
  - pollinations 模式：fetchPollinations 拉一张 256x256 测试图，成功即 ok；
  - openai 模式：对生效网关（ic.baseUrl 留空回落聊天 baseUrl）POST `/images/generations`，model 用 ic.model、size 取小尺寸（gpt-image* 用 1024x1024，其余 512x512）、prompt 固定测试句；按状态码翻译人话（401 Key 错 / 404 地址或模型不支持生图 / 503 渠道不可用直接透传对方 error.message）；
  - 返回耗时 ms 供 UI 显示。
- SettingsApp `testChannel()` 改调 `testImageChannel`，按钮文案「测试生图」，成功绿字带耗时与模型名，失败红字带原因；日志 `[image] channel test ok/fail model=… ms=…`。
- 「拉取模型列表」保留（仍用 /models，这是网关通用能力），但说明文案改为"列出该网关全部模型，图像类排前"。

### B. 生图绑定角色（chat-types.ts + media.ts + RoleChatApp.tsx）
- `Character` 新增可选字段 `imageModel?: string`（角色专属生图模型，留空=跟随全局设置）。
- `generateCharPhoto` 增加第 4 参 `charModel?: string`：openai/回落通道请求体 model 优先取 charModel，pollinations 同理；不传则维持全局 ic.model——老调用点行为不变。
- RoleChatApp 主动照片处（L1550）把 `ch.imageModel` 传入；这样"分享日常照片"就走角色绑定的生图通路。
- 角色设定页在「会分享写实日常照片」开关下方加一行「生图模型」选择：胶囊按钮组 = GPT_IMAGE_MODELS + 若已拉取过列表可手填 Input（占位"留空=跟随全局"），保存进 characters:v2（复用 onTogglePhoto 同款 setCharacters 映射，日志 `[photo] model bind char=… model=…`）。
- 兼容性：字段可选，旧存档 undefined 自动走全局模型，无需迁移逻辑。

## 4. 涉及文件定位
| 文件 | 改动 |
|---|---|
| `/home/project/src/lib/media.ts` | 新增 testImageChannel；generateCharPhoto 加 charModel 参数 |
| `/home/project/src/components/SettingsApp.tsx` | ImageSection.testChannel 改调 testImageChannel，按钮/文案/日志更新 |
| `/home/project/src/lib/chat-types.ts` | Character 加 imageModel? |
| `/home/project/src/components/RoleChatApp.tsx` | L1550 传 ch.imageModel；角色设定页加生图模型选择 UI + 保存回调 |

## 5. 风险与回归
- 测试请求会真实消耗一次生图额度（小尺寸、单次点击才发，成本可控）；UI 注明"将实际生成一张测试图"。
- generateCharPhoto 签名扩展为可选参数，通话/其他调用点零改动。
- 回归点：主动照片仍按 30% 概率+15 分钟冷却触发；关闭 photoEnabled 的角色不发图；未绑模型的角色效果与现在完全一致。

## 6. 验收标准
1. 生图板块点「连接测试」→ 用所填生图模型真实出一张小图并显示"✓ 生图可用（xxms·模型名）"；Key 错/模型不支持时红字给出对应人话原因，不再出现拿聊天模型撞出的 503 误导。
2. 某角色设定页选 `gpt-image-2.5-sunburst` 后，TA 主动分享日常照片时请求体 model=sunburst（控制台 `[photo] attach` 日志可见），另一未绑定角色仍用全局模型。
3. 免费网关（pollinations）模式下测试与角色分享均正常走免 Key 直链。

## 7. 本期不做
- 不做多套生图配置档（每角色只绑模型名，地址/Key 仍全局一套）。
- 不加聊天内手动"让 TA 拍照"按钮（保持既有"小概率自动附带"机制）。