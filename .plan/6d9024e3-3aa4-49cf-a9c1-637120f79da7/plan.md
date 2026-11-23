# 需求文档

## 1. 问题陈述

当前「虚拟手机恋爱模拟器」的全部数据（角色、聊天记录、群聊、世界书、表情包、相册、钱包、日记、API 配置等约 34 个 localStorage 键）只存在浏览器本地。换设备、清缓存、误删浏览器数据都会导致不可恢复丢失。

用户需要：**注册/登录自己的专属账号，把该账号现有的所有数据保存到云端**，实现跨设备找回与备份。

## 2. 探索结论（现状分析）

- **技术底座**：`@supabase/supabase-js@^2.98.0` 已在 package.json，但项目无任何 `src/supabase/`、无 .env 云配置、无 auth 代码——是从零接入 Meoo Cloud 的干净起点。
- **数据入口收敛**：几乎所有持久化都经由 `src/lib/chat-store.ts` 的 `usePersisted<T>(key, fallback)` hook（L203-233，写入时机 = update() 同步写 localStorage + storage 事件跨实例同步），少数地方直接 `localStorage.setItem`。
- **动态 key 族**：`vp-phone:rolechat-log:{charId}`、`vp-phone:groupchat-log:{gid}` 按角色/群 id 拼接，快照必须枚举 `vp-phone:` 前缀全量收集，不能白名单硬编码。
- **大体积风险**：聊天 `imageUrl`(≤280KB base64)、`stickerUrl`、相册 `Photo.url`、用户上传壁纸（readAsDataURL 无压缩，500KB~2MB）。整包 JSON 可能远超数据库单行合理体量。
- **挂载点**：`PhoneShell.tsx` L161 锁屏判断处是"进入手机"唯一闸门；`SettingsApp.tsx` 已有 VoiceSection（测试并保存范式）、PasscodeSection 等可参照的 Section 写法。
- **既有约定**：锁屏密码默认 0517、URL 参数 `?vpDesk=1&vpApp=xxx` 供截图验收直达。

## 3. 方案与备选

**选定方案：整包快照 + 图片自动上云 + 登录后选择恢复**

- 每个账号在云端保存一份"手机数据快照"（全部 `vp-phone:*` 键值打包成 JSONB），外加一个二进制附件表存放被抽出的 base64 图片。
- 备份时自动扫描快照内所有 data URL：抽出上传到 Storage，原位替换为云端 URL——彻底解决体积问题，且恢复后图片仍可显示。
- 不做静默实时双向同步（多设备下互相覆盖风险高、且本应用是单人单机场景），采用**手动备份/恢复 + 退出/切后台自动备份**的明确语义。

备选（已排除）：
- *逐键实时同步*：改造面波及全部 store、冲突处理复杂，过度工程。
- *只存文本不存图*：恢复后满屏裂图，体验不可接受。
- *导出/导入 JSON 文件*：不满足"注册账号云端保存"的诉求，仅作为补充逃生通道保留。

## 4. 功能设计（用户视角）

### 4.1 开机引导（首次解锁后一次）
解锁手机后弹出一张 iOS 风格卡片：「云存档 · 周氏双子等你回家」，说明登录后可跨设备找回全部数据；提供【稍后再说】【去登录】两个按钮，"稍后再说"永不再弹（设置里随时可进）。

### 4.2 登录/注册页（手机端形态，全屏）
- 邮箱 + 密码，登录/注册两个 tab 切换；注册需二次输入密码，弱校验（≥6 位）。
- 展示当前 Meoo Cloud 邮箱确认策略：若平台要求确认邮箱则如实提示去邮箱验证；若免确认则注册即登录。
- 底部"暂不登录，继续使用本机数据"出口。
- 错误翻译成人话（邮箱格式不对/密码错误/该邮箱已注册/网络异常）。

### 4.3 设置 →「云端账号」Section
- 未登录：登录/注册入口按钮。
- 已登录：显示账号邮箱；【立即备份】按钮（进度反馈：正在上传 N 张图片 → 备份完成 ✓ / 失败原因）；上次备份时间；【从云端恢复】按钮（二次确认弹窗：将覆盖本机现有数据，建议先本机备份）；【自动备份】开关（默认开：每次退出登录、切后台、以及备份成功后 30 分钟节流快照）；【退出登录】（退出前若有未备份改动提示先备份）。

### 4.4 恢复流程
登录后（或点恢复）拉取云端快照元信息（备份时间、条目数、占用大小），确认后：下载快照 → 图片 URL 已是云端地址直接写回 localStorage → 广播刷新 → 回到桌面，数据完整回来（角色、聊天、群聊、世界书、钱包、壁纸全部一致）。

### 4.5 边界与异常
| 场景 | 处理 |
|------|------|
| 云端尚无快照就点备份 | 正常创建首份快照 |
| 登录后云端有数据、本机也有数据 | 引导页/设置里让用户选"上传本机→云端"或"下载云端→本机"，绝不自动覆盖任何一边 |
| 备份中途断网 | 快照写入为单事务，失败不留半成品；图片附件幂等（按内容哈希命名，重传覆盖） |
| 恢复时个别图片 URL 失效 | 文字记录不受影响，图片位显示占位灰块 |
| 未登录用户 | 一切照旧纯本地运行，零打扰 |
| 同账号多设备 | 以最后一次成功备份为准，恢复前展示云端备份时间供判断 |

## 5. 实现步骤

1. **Cloud 开通**：加载 meoo-cloud / meoo-cloud-auth 技能，`meoo-cli cloud init` 启用数据库+认证+Storage；按技能文档建表与 RLS（快照表 owner 仅本人可读写；附件桶同理）。
2. **数据层**：新建 `src/lib/cloud-store.ts` —— supabase client 消费模板注入的 `src/supabase/client.ts`；`captureSnapshot()`（枚举 vp-phone: 全键 + data URL 抽取上传替换）、`pushSnapshot()`、`fetchSnapshotMeta()`、`restoreSnapshot()`（含旧数据本机留底）、`lastBackupAt` 状态。
3. **认证 UI**：新建 `src/components/AuthSheet.tsx`（登录/注册表单，参照 VoiceSection 的"测试并保存"反馈范式）。
4. **设置接线**：`SettingsApp.tsx` 新增 CloudAccountSection（账号信息/备份/恢复/自动备份开关/退出）。
5. **开机引导**：新建 `src/components/CloudOnboard.tsx`，在 `PhoneShell.tsx` 解锁分支挂载（一次性标记存 `vp-phone:cloud-onboard:v1`）。
6. **自动备份钩子**：PhoneShell 内 visibilitychange/beforeunload + 30 分钟节流。
7. **验证**：`pnpm run build` + `npx tsc --noEmit` 双门禁；`meoo-cli cloud create-test-user` 造测试账号；dev 重启后用截图验收登录页、设置 Section、备份/恢复闭环（含一张带图聊天记录的跨"清本地→恢复"演练）。

## 6. 涉及文件

| 文件 | 动作 |
|------|------|
| `src/supabase/client.ts`、`.env*` | 由 Meoo Cloud 平台流程生成（不手改） |
| `src/lib/cloud-store.ts` | 新建：快照捕获/上传/恢复/图片抽取 |
| `src/components/AuthSheet.tsx` | 新建：登录/注册全屏页 |
| `src/components/CloudOnboard.tsx` | 新建：开机引导卡 |
| `src/components/SettingsApp.tsx` | 修改：新增 CloudAccountSection |
| `src/components/PhoneShell.tsx` | 修改：挂载引导卡 + 自动备份钩子 |
| 数据库 | 新表 `vp_snapshots`(user_id, data jsonb, size, updated_at) + Storage 桶 `vp-assets`（RLS 限本人） |

## 7. 验收标准

1. 新用户可注册→自动登录，看到"已登录"状态；老邮箱可再登录。
2. 点【立即备份】：带 base64 图片的聊天记录备份成功，日志可见上传图片数量，云端快照不含裸 data URL。
3. 清空浏览器 localStorage（或无痕窗口）→ 登录同账号 → 【从云端恢复】→ 角色、私聊记录（含图片）、群聊、世界书、表情包、钱包余额、壁纸、API 配置全部还原。
4. 未登录时应用行为与现在完全一致，无任何弹窗骚扰（除一次性引导卡，可永久跳过）。
5. 退出登录前提示未备份改动；自动备份开关关闭后不再后台写云。
6. A 账号无法读取/覆盖 B 账号快照（RLS 生效）。

## 8. 本期不做

- 多设备实时增量同步 / 冲突合并（手动备份恢复已覆盖核心诉求）
- 云端历史版本回溯（只保留每账号最新一份快照；恢复前本机旧数据会留一份本地保险副本）
- 角色卡/世界书的社区分享库
- 手机号/第三方 OAuth 登录（仅邮箱+密码）
- 端到端加密存储