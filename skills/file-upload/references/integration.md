# 业务接线

固定上传 service、队列和生命周期原样复用。页面只写类别/展示、表字段、关联回执与列表回读，不复制控制器实现。已有存量旧接口先读当前调用方再迁移，不混用两种合同。

## 接线所需公开接口（无需展开固定源码）

从 `@/features/file-upload` 导入 `createSupabaseUploadService`、`useUploadQueue`、`FileUploadError` 和 `UploadedFile`。以下签名与当前固定模块一致；新接线直接使用。只有现有项目导出不匹配、编译指出具体类型错误或真实故障时，再读对应实现，已读且未修改的文件不重复读取。

- `createSupabaseUploadService({supabase,bucket,ownership:'user',visibility:'private',pathPrefix?,maxFileSizeBytes?,allowedExtensions?,allowedMimeTypes?})` 返回稳定 service；默认路径为 `users/<uid>/uploads/<唯一段>-<文件名>`。bucket 使用 inventory 的实际 id。
- `service.upload(file):Promise<UploadedFile>`；`service.getAccessUrl(ref,{download?,expiresIn?}):Promise<string>`。引用字段为 `bucket/objectPath/originalName/size/mimeType/visibility/ownerId?`，完整保存，不保存签名URL。
- `useUploadQueue<T>({service,scope,associate,onConfirmed?})`：`T` 是 string/number/boolean/null 的平面字段；scope 为 `{ownerId,parentId}` 或 null。`associate(ref,{ownerId,parentId,data:T},flowScope):Promise<void>`；实际精确回执才 resolve。`onConfirmed` 可同步或异步回读，失败仅记录 refreshError。

| 页面使用 | 返回/含义 |
| --- | --- |
| `items` | 只读数组；每项 `id,file,context,state,ref?,progress?,message?,refreshError?`；context 为选择时 owner/parent/data 快照。 |
| `busy / blocked` | 禁用所有选择入口；未知上传、待关联和失败项会 blocked。 |
| `enqueue(files,data)` | `Promise<boolean>`；首个未确认项停止后续文件。恢复后自动续跑，各文件只上传一次。 |
| `verify(item.id)` | `Promise<boolean>`；只读核验原未知上传，不新建对象或上传。 |
| `retryAssociation(item.id)` | `Promise<boolean>`；仅重试已上传引用的业务保存，不再次上传。 |
| `clear()` | boolean；只清空空闲已确认/写入前失败项，不能丢弃未知写入。 |

state 为 `queued / uploading / upload-unknown / associating / association-pending / confirmed / failed`。progress 为 `{uploadedBytes,totalBytes,percentage}`。Hook 已处理互斥、卸载和 A→B→A 世代；页面只接线，不自建锁、队列、校验控制器，不 dispose 共享 service。独立 service 核验、非 React 队列和完整错误合同按需读 [完整公共合同](public-api.md)。

## 页面适配

```tsx
const queue = useUploadQueue<{kind: AttachmentKind}>({
  service: getAttachmentService(), // 稳定共享实例，页面卸载不 dispose。
  scope: session ? {ownerId: session.user.id, parentId: customerId} : null,
  associate: async (ref, context, flowScope) => {
    // 有异步身份/父对象预检时，每次 await 后、发新写入前调用。
    flowScope.assertCurrent();
    const result = await saveAttachment({
      ref, ownerId: context.ownerId, customerId: context.parentId,
      kind: context.data.kind, title: ref.originalName,
    });
    if (!result.ok) throw new Error(result.message);
  },
  onConfirmed: async (_ref, context, flowScope) => {
    const rows = await fetchAttachments(context.parentId);
    flowScope.assertCurrent(); // 防止切换/卸载后的旧客户结果更新当前列表。
    setAttachments(rows);
  },
});
// 原生 input 与选择/拖拽入口均禁用：queue.busy || queue.blocked。
const files = Array.from(event.currentTarget.files ?? []);
event.currentTarget.value = '';
// 先按当前类别校验类型/大小；非法文件不进入 enqueue。
void queue.enqueue(files, {kind});
```

从 `@/features/file-upload` 导入 useUploadQueue；示例中的 AttachmentKind、关联和回读函数替换为本项目实际业务类型/API。真实原生 input.files 不保留 FileList，先保存数组。metadata 只放平面业务字段；关联使用 context 原快照，不能用当前 props 替换 owner/parent/kind。`upload-unknown` 项只给“核验上传”按钮绑定 `queue.verify(item.id)`；`association-pending` 项只给“重试关联”绑定 `queue.retryAssociation(item.id)`。剩余 queued 项会在首项确认后续跑，不在页面另写循环。

`associate` 与 `onConfirmed` 的第三参 `flowScope` 提供 `isCurrent():boolean / assertCurrent():void`。所有异步身份/父对象预检返回后，发新的业务写入前检查；业务回读返回后，更新页面状态前检查。检查捕获原队列世代，不能仅比较 ownerId/parentId（A→B→A 仍须失效）。已经发出的请求不宣称取消，不因失效重发。

busy/blocked、progress、message 与 refreshError 按公共合同展示；已确认项也必须展示 refreshError，列表不能仅筛选 `state !== 'confirmed'` 后把刷新失败藏掉。展示恢复项可使用 `queue.items.filter(item => item.state !== 'confirmed' || item.refreshError)`。未知结果不显示完成、不暴露开发者实现细节。账号/客户切换、A→B→A、卸载都由 Hook 固定世代处理。不得重建原 FileUploadError、手写字节核验、替换服务实例或重新 upload 进行恢复。

## 真实业务回执

业务表保存完整稳定引用 `bucket/objectPath/originalName/size/mimeType/visibility/ownerId` 与自己的父对象/分类/标题，不保存签名 URL。按当前唯一约束选择幂等键，`.upsert(...).select('*')` 同时检查 error、非空 data、精确 id、父对象、owner、bucket 和 object_path。不同桶可有同名路径，两字段都要比较。回执不符/Promise 异常均 throw，固定队列保留引用，只重试关联。

重复关联必须恢复同一条记录：已有唯一约束 `(bucket, object_path)` 时使用 `.upsert(body, {onConflict:'bucket,object_path'}).select(实际回执列)`；body 复用原引用和 context。不要 `.insert()` 再把重复键当成失败——首次已提交但回执丢失时会无法恢复。项目其他唯一约束按真实 schema 适配。回读必须匹配 bucket、path、owner、parent 与实际记录id，冲突记录不匹配时 throw，不能把任意存在行当成功。

业务关联与 Storage 不是事务。onConfirmed 真实回读；回读失败展示 refreshError，关联已确认不得借此再上传。预览/下载时调用 `service.getAccessUrl(ref)`，私有签名失败不能回退公开 URL。

删除由业务实现：`.delete().eq('id',id).select('id,bucket,object_path')` 恰好返回目标 id 后才清理这个引用；零行、错 id、空 data 保持未确认。检查 Storage.remove 的 error；失败单独提示待清理。网络未知先只读核验原 id/引用，不自动重发删除。

## 父对象权限由数据库兜底

私有对象和附件 owner=auth.uid() 不能证明有权关联父对象。先用当前 Client 读父对象，查不到拒绝；数据库 INSERT/UPDATE 的 WITH CHECK 同时约束附件 owner=auth.uid() 和 `EXISTS(SELECT 1 FROM public.<父表> p WHERE p.id=<附件表>.<父外键> AND p.<owner列>=auth.uid())`。UPDATE/DELETE 的 USING 约束原行归属，父表也开启归属 RLS。按真实 schema 替换列名；检查冲突的 permissive 策略，不能靠增加严格策略抵消宽松策略。不用 service-role 代替用户写入。

资源未准备才读 [Cloud](cloud-setup.md)，取得 inventory 实际 Bucket id 与匹配策略，不把显示名当 id。

## 验收

通过实际业务模块和正常 SDK 验证字节、精确回执、回读和删除；A 关联自己父对象成功，关联 B 的父对象/修改父外键必须拒绝，原引用保持不变。注入零行/空 data/SDK error 不报完成。固定队列验收关联重试只多一次 save、未知只多一次只读核验、恢复后剩余文件各执行一次及切换/卸载拒绝晚到结果。按任务选择代码/API验收，无需强制浏览器。
