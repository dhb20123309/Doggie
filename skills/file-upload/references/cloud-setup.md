# Cloud 资源与权限

首次创建或调整 Bucket、Storage policy、登录范围或业务关联表时先读取 `meoo-cloud` 及其 [Storage 边界](../../meoo-cloud/references/storage.md)。已有资源先 inventory；不要把示例 SQL 直接重跑到存量环境，也不要在本 Skill 中自动修改共享资源。

## 首次接线先取得实际资源

```sh
meoo-cli cloud query --sql "SELECT id, name, public FROM storage.buckets ORDER BY id;"
meoo-cli cloud query --sql "SELECT policyname, cmd, roles, qual, with_check FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';"
```

使用查到的 `id` 配置 service.bucket 和 policy.bucket_id；name 只是显示名，平台实例可能以 UUID 作为实际 Storage 地址，不能假设二者相同。保留现有 Bucket 与策略，已存在时不盲目 INSERT，也不猜 pg_policy 内部字段。盘点一次即可；改策略按当前自己的资源范围迁移。完整边界见 [资源清单](storage-inventory.md)。

## 选择上传模式

| 模式 | Service 配置 | 需要确认的云端边界 |
| --- | --- | --- |
| 公开共享 | `ownership:'none'`, `visibility:'public'` | Bucket 对象可公开读取；写入权限仍由 Storage policy 决定 |
| 用户隔离、公开内容 | `ownership:'user'`, `visibility:'public'` | 当前用户只能写入和操作自己的 `users/<uid>/` 前缀；对象 URL 可被转发 |
| 用户隔离、私有内容 | `ownership:'user'`, `visibility:'private'` | Storage policy 限制当前用户；访问时由当前会话签发短期 URL |

`ownership` 只决定默认路径和客户端边界检查，不能替代 Storage RLS。私有签名也不能替代真实授权；签名接口必须由平台策略保护。用户前缀不是父对象授权，客户、工单、巡检或团队共享需要业务 API/关联表按实际权限校验。

## 资源检查

- 复用生成的 `src/supabase/client.ts` 导出的 `supabase`，不要重新 `createClient()` 或硬编码 URL/key。
- 核对 Bucket 的 public/private 状态、对象 INSERT/SELECT/UPDATE/DELETE policy、`storage.objects` 的 RLS、角色 grants 和业务关联表的 RLS。
- `ownership:'user'` 时核对新建路径确实是 `users/<auth.uid()>/...`，并拒绝伪造其他用户路径；页面过滤不是授权。
- 以实际 Bucket **id** 筛选策略，再对照路径谓词：固定内核第一段是 `users`、第二段是 uid，所以对应 `(storage.foldername(name))[1] = 'users' AND (storage.foldername(name))[2] = auth.uid()::text`。现有策略若要求第一段等于 uid，就无法接受本模板路径；仅查到策略存在不代表适配完成。只迁移当前获授权 Bucket 的 INSERT WITH CHECK / SELECT、DELETE USING / UPDATE USING 与 WITH CHECK，保持本人边界；存量对象的旧路径读取按实际需要保留，不能修改其它 Bucket 或放宽跨用户权限。
- private 模式验证匿名请求、另一用户和已退出会话不能直接读取对象或签发新的 URL；已发出的签名 URL 在有效期内仍是可转发 bearer 地址，退出登录不会撤销它。public 模式单独确认“内容公开”和“业务记录可见”是两个决定。
- 父对象关联至少同时核对附件 owner、父对象 owner/tenant、Bucket 和 objectPath；不能只验证 `created_by`。

新建项目可以使用平台现有 Cloud init/迁移流程完成 Bucket 与 policy；本 Skill 不提供固定附件表或通用 DDL。现有 Bucket 或业务表有差异时记录差异并制定单独迁移，不能通过客户端路径约定放宽访问。
