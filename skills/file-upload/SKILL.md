---
name: file-upload
hidden: true
description: 为 React 网页应用提供真实的对象存储附件上传、访问地址和按需图片处理。用户要求上传附件、图片、PDF、Office、压缩包、音视频或对象存储时使用；解析 Excel/CSV 内容并写入业务表使用 data-batch-upload；仅本地预览或展示已有文件不使用。
allowed_create_modes:
  - create-desktop
component_keywords:
  - '(^|/)src/features/file-upload/index\.ts$'
  - '(^|/)src/features/file-upload/supabaseUploadService\.ts$'
---

# React 文件上传

模板提供固定上传/访问内核及通用队列 `useUploadQueue`，公开入口是 `@/features/file-upload`。7 个固定文件原样复用；模板不生成页面、业务表、附件列表、业务关联接口、普通删除或去重。`UploadedFile` 是稳定引用：`bucket`、`objectPath`、`originalName`、`size`、`mimeType`、`visibility` 和可选 `ownerId`。

先按任务选择一个接线入口：有业务关联/恢复/多文件时读 [业务接线（含所需公开接口）](references/integration.md)，只有对象上传/访问时读 [公共调用合同](references/public-api.md)。使用 `@/features/file-upload` 公开导出直接接当前调用方；合同足够时无需逐个读取 index/types/service/queue/Hook。仅现有项目版本不匹配、具体编译错误或真实故障时读取对应文件，同一路径未变不重复读取。已有项目若仍使用旧的记录状态机或自定义 API，先按现状维护；不要把新合同和旧实现混用。新项目按本 Skill 的入口接入。

## 最短接入

```tsx
import { supabase } from '@/supabase/client';
import { createSupabaseUploadService } from '@/features/file-upload';

const service = createSupabaseUploadService({
  supabase,
  bucket: attachmentBucketId, // 从当前实例 inventory 的 id 取得；不是显示名。
  ownership: 'user',
  visibility: 'private',
});

const fileRef = await service.upload(file);
const accessUrl = await service.getAccessUrl(fileRef, { download: true });
```

必须复用生成的 `supabase` Client，不重建 Client、不猜域名、不读取环境变量。`bucket` 必填；`pathPrefix` 默认 `uploads`；`ownership` 默认 `none`，需要本人前缀隔离时使用 `user`；`visibility` 默认 `public`，私有访问使用 `private` 且必须使用 `ownership:'user'`。可选配置 `allowedExtensions`、`allowedMimeTypes` 和 `maxFileSizeBytes`；基础内核单文件上限固定为 50 MiB，项目可以进一步缩小上限。

默认上传保留原始字节，不计算 checksum、不压缩、不解析文件头。核心使用最终 `ArrayBuffer`、唯一对象路径和 `upsert:false`；会在异步读取、Storage 写入前后检查当前身份。大于 50 MiB 的文件返回 `FILE_TOO_LARGE`，不会自动改用其他传输方式。图片处理只在显式读取 [按需图片处理](references/optional-image.md) 并调用时发生。

## 应用侧流程

涉及业务关联、恢复或多文件的新项目，直接复用 `useUploadQueue`，只传 service、当前 `{ownerId,parentId}`、关联回调和回读回调。队列已处理互斥、原上下文、卸载、未知结果、关联重试和剩余文件续跑；不在页面重新编写这些控制器。仅需要对象引用且没有业务关联时直接调用 service.upload。页面负责选择、分类、展示和预览，选择前按业务类别校验。清空文件输入前保存 `Array.from(input.files ?? [])` 快照。基础上传可报告 0% 和 100%；项目降低上限时展示实际上限。

上传成功只表示 Storage 返回了本次稳定引用。应用应把完整引用保存到自己的业务记录，再真实回读业务记录用于刷新展示。业务关联失败只重试关联接口，不重新上传；上传、业务保存和业务回读不是一个事务。不要保存签名 URL，访问时按需调用 `getAccessUrl`。

`FileUploadError` 保留 `code`、`bucket`、`objectPath`、`resultUnknown` 和 `recoverable`。队列内部保留原 error 与同一个 service；用户通过 queue.verify(id) 触发 `service.verifyUpload(error)`，只下载并逐字节比较，不自动重传、删除。缺少现场或身份变化保持未确认。私有签名失败不能回退公开 URL。公开/私有选项和固定队列不能代替真实 Storage RLS 和业务父对象授权。

首次上传接线先做 [资源清单](references/storage-inventory.md)，取得实际 Bucket id 与策略；之后需要复查时再读，使用已有 cloud query，不猜 Storage CLI 子命令。

按当前任务读取：有业务关联时读 [应用接入](references/integration.md)；资源未准备时读 [Cloud 建议](references/cloud-setup.md)；需排查归属时读 [本人隔离](references/owner-isolation.md)；具体异常读 [排障](references/troubleshooting.md)。页面、表字段、父对象权限和列表按项目适配，不把所有资料作为起步必读。

解析 Excel/CSV/SQLite 内容并写入固定业务表使用 `data-batch-upload`，不要用本 Skill 代替导入流程。
