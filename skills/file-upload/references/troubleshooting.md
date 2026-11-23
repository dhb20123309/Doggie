# 上传排障

先读取项目实际的上传入口、Service 配置和调用方，再对照以下边界；使用本模板时入口为 `index.ts`。旧项目按现有上传实现维护，不为排障强制迁移模板。

遇到 `Bucket not found`、Storage 502 或开发正常但线上异常，先按 [Cloud 上传故障排查](../../meoo-cloud/references/troubleshooting.md#上传故障先确认请求阶段) 核对失败阶段、实际桶 ID 与发布版本，再处理下面的内核错误。

- `INVALID_FILE`、`INVALID_FILE_TYPE`、`FILE_TOO_LARGE`：在 Storage 请求前处理。检查文件快照、声明 MIME/扩展名和配置上限；基础内核最大 50 MiB。
- `AUTH_REQUIRED` / `AUTH_CHANGED`：检查生成 Client 的当前 session、用户 ID 和 Storage policy。账号变化期间的晚到结果必须丢弃；用户模式不能用 anon key 代替用户 token。
- `STORAGE_UPLOAD_FAILED`：保留错误中的 `bucket`/`objectPath`。若 `resultUnknown:true`，先用该引用核验对象，再决定业务处理；不要自动重传或删除。
- `ACCESS_URL_FAILED`：分别检查 Bucket public 状态或签名接口/RLS。私有签名失败不能回退公开 URL，也不要持久化旧短链。
- 401/403/空结果：区分会话、Bucket policy、对象前缀和业务父对象授权。前端隐藏或列表过滤不能当作权限证明。

受控验证至少覆盖：真实字节上传和返回路径、`upsert:false`、身份切换、未知结果引用、公开访问、私有签名失败、另一用户访问拒绝、50 MiB 内普通上传和超过 50 MiB 的拒绝。

普通上传没有自动删除、自动重试或跨服务事务。业务关联失败只重试业务 API；需要垃圾回收、版本和去重时先形成单独业务设计。
