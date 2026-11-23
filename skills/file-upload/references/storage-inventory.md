# Storage 资源检查接线

上传模板负责固定 SDK 生命周期与清理；Bucket、策略、父对象关联表是当前业务接线。

现有 CLI 没有 `meoo-cli cloud storage list` 子命令。资源管理检查使用已有 `cloud query`，不要为 inventory 猜子命令：

```sh
meoo-cli cloud query --sql "SELECT id, name, public FROM storage.buckets ORDER BY id;"
meoo-cli cloud query --sql "SELECT policyname, cmd, roles, qual, with_check FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';"
```

先核对当前项目自己的 Bucket 与 policy，再制定必要迁移，不因存量差异修改其他项目资源。业务上传、下载、删除和签名仍使用生成 Client 的 `supabase.storage` 及上传模板。

托管 `cloud test-request` 有允许的路由范围，不能拿它请求被禁止的 Storage 路由，再用裸 fetch/key 绕过。真实文件上传和私有读取通过当前用户正常 SDK 验证实际字节与另一账号拒绝；页面停止可以执行生成处理器做代码断言；管理 inventory 或构建成功不替代这一验收。父对象关联同时检查父对象归属与对象路径归属，不能只看页面过滤。
