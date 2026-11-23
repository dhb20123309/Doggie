# 上传公共合同

从 `@/features/file-upload` 导入 createSupabaseUploadService、FileUploadError 和类型；业务只适配配置/表/页面，固定模块保持原样。先核对公开 index 一次，以下合同完整时不展开 types 或 supabaseUploadService 内部。

```ts
createSupabaseUploadService({
  supabase, bucket: actualBucketId, pathPrefix: 'attachments',
  ownership: 'user', visibility: 'private',
  maxFileSizeBytes: 20 * 1024 * 1024,
  allowedExtensions: ['png', 'jpg', 'jpeg', 'pdf'],
  allowedMimeTypes: ['image/png', 'image/jpeg', 'application/pdf'],
});
```

配置类型 SupabaseUploadServiceConfig。bucket 必填且取 inventory 的实际 id；其余可选。私有模式必须 ownership:'user'。项目可以降低 50 MiB 上限；扩展名/MIME 列表是项目允许范围，按附件类别有不同限制时在业务选择前校验，不接受 PDF 作为仅允许照片的类别。

| 调用 | 返回 / 边界 |
| --- | --- |
| `service.upload(file, {onProgress, metadata}?)` | Promise<UploadedFile>；file 提供 name/size/type?/arrayBuffer。onProgress 为 uploadedBytes/totalBytes/percentage；metadata 为只读字符串键值。 |
| `service.verifyUpload(error)` | Promise<UploadedFile>；只读核验本实例 upload 抛出的原 FileUploadError，逐字节比较实际上传内容；不上传、不删除。 |
| `service.getAccessUrl(ref, {download, expiresIn}?)` | Promise<string>；download 为 boolean，expiresIn 以秒计，默认300、上限3600。不持久化 URL。 |
| `service.dispose()` | void；销毁监听，之后不能复用此实例。 |

UploadedFile = `{bucket, objectPath, originalName, size, mimeType, visibility, ownerId?}`；visibility 为 public/private。完整保存此引用，再追加业务 parentId/kind/title；业务记录不是固定内核输出。

FileUploadError 是公共导出类，先 instanceof 再取 code/message/recoverable/bucket/objectPath/resultUnknown。常见 code：FILE_TOO_LARGE、INVALID_FILE_TYPE、AUTH_REQUIRED、AUTH_CHANGED、STORAGE_UPLOAD_FAILED、UPLOAD_VERIFICATION_FAILED、ACCESS_URL_FAILED。resultUnknown=true 保留原 error 对象及同一个 service，核验调用 verifyUpload；不能只保留 message 或自行构造引用。服务销毁、身份切换或刷新丢失现场后保持未确认。

## 固定队列与页面生命周期

业务关联/恢复/多文件直接用 `useUploadQueue<T>({service,scope,associate,onConfirmed?})`。`T` 是平面业务 metadata（值为 string/number/boolean/null），如 `{kind:string}`；scope 为 `{ownerId:string,parentId:string}`，未登录/未选择父对象时传 null。

- `associate(ref, context, flowScope):Promise<void>`：context=`{ownerId,parentId,data:T}` 是选择时快照；实际关联确认才 resolve，空回执/错误/未知结果一律 throw。`onConfirmed(ref,context,flowScope)` 用于真实业务回读；失败单独记 refreshError，不重新上传。
- 返回 `{items,busy,blocked,enqueue,verify,retryAssociation,clear}`。`enqueue(files,data):Promise<boolean>`；busy/blocked 时拒绝新队列，首个未确认项停止后续执行。恢复确认后自动继续原队列剩余文件，各文件只上传一次。
- `items` 只读；每项有 id、file、context、state、可选 ref/progress/message/refreshError。state 为 queued / uploading / upload-unknown / associating / association-pending / confirmed / failed。
- `verify(id)` 只读核验未知上传；`retryAssociation(id)` 只重试已确认引用的关联。两者返回 Promise<boolean>。`clear():boolean` 仅允许空闲已确认/写入前失败，不得丢弃未确认上传/关联。
- Hook 已处理 scope 世代与卸载；A→B→A 不会接收旧任务。页面不添加 generation key、不重写锁/队列/核验，也不销毁共享 service。非 React 调用 `createUploadQueue<T>(同一配置)`，自行按生命周期调用 setScope(scope)、invalidate()、dispose()；队列从不替调用方 dispose service。

页面、业务精确回执与父对象授权见 [业务接线](integration.md)。资源未准备时再读 [Cloud](cloud-setup.md)。只有具体类型错误/真实故障才读对应固定实现；接线无需展开 types/service/queue/Hook。

## 异步业务回调边界

associate/onConfirmed 第三参 `flowScope` 是固定世代检查：`isCurrent():boolean`、`assertCurrent():void`。异步预检后、下一次业务写入前，以及异步回读后、更新页面状态前调用 assertCurrent。卸载/切换/A→B→A 后拒绝旧副作用；已发送的请求不宣称取消。不能仅比较当前父对象id。已确认项的 refreshError 也应展示，不被只筛选待处理项隐藏。具体接线见 [业务接线](integration.md)。
