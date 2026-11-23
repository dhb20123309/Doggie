# 写入与页面同步

用于新增、修改、删除、upsert 和原子业务更新。本文包含写入规则、确认示例与失败处理；函数参数、返回值或限制不明确时再查 [模板接口速查](runtime-api.md) 对应章节。仅实现保存无需读取完整查询示例。

按任务定位：[所有权与 RLS](#rls-所有权写入)、[影响行确认](#写入确认)、[写后同步](#写后同步)、[原子更新](#原子更新)、[不确定写入](#不确定写入)、[约束与错误反馈](#约束与错误反馈)。示例使用项目已验证的 schema 和平台 Client。

## RLS 所有权写入

写入带 `user_id`、`owner_id` 等所有权字段的表之前，先把四项证据对齐：当前用户 ID、实际请求体、字段默认值、Policy 的 `USING` / `WITH CHECK`。Bearer JWT 只提供调用身份，使 `auth.uid()` 可用；它不会修改 INSERT 请求体，也不会自动填充业务表的所有权字段。

若 INSERT Policy 要求 `user_id = auth.uid()`，采用以下两种方式之一：

1. 业务代码从现有 Auth 状态取得当前用户，并把 `user_id` 显式写入；不得硬编码或信任用户可编辑的任意 ID。
2. 经 `meoo-cloud/references/database.md` 的迁移流程确认 `user_id` 已有 `DEFAULT auth.uid()`，且字段和 Policy 的匿名/登录语义一致，业务代码才可以省略该字段。

```ts
import { confirmMutationRows } from '@/features/supabase-data-access';

const { data: { user }, error: userError } = await supabase.auth.getUser();
if (userError || !user) throw new Error('请先登录');

const result = await supabase
  .from('conversations')
  .insert({ title, user_id: user.id })
  .select('id,title,user_id,created_at');

const [created] = confirmMutationRows(result, {
  operation: '创建会话',
  minRows: 1,
  maxRows: 1,
});
```

上例追加 `.select(...)`，是因为调用方需要新建记录的 `id` 和数据库最终值；如果业务只需要确认 INSERT 请求成功且不消费返回记录，可以不追加 `.select()`，但仍必须检查结构化 `error`。

诊断 `42501`、403 或 `new row violates row-level security policy` 时按顺序检查：

1. 请求是否使用平台生成的 Client，并携带有效 Session；只确认存在 Authorization Header 不够。
2. JWT 对应的当前用户 ID 与请求体所有权字段是否一致；字段缺失通常会以 `NULL = auth.uid()` 检查失败。
3. 字段是否真的存在 `DEFAULT auth.uid()`；不能因为用户已登录就假定数据库会自动填值。
4. Policy 的目标角色是否符合业务。`TO public` 包含匿名和登录角色，但不会绕过 `WITH CHECK`；仅允许登录用户时优先使用 `TO authenticated`。
5. 选择通过 `.select()` 或 `return=representation` 返回记录时，除写入权限外，是否还有允许读取返回字段和行的权限。

修复时不能把 `WITH CHECK` 改成无条件 `true`、删除 RLS、伪造用户 ID 或降级为 LocalStorage。用户提供 cURL 或日志时，只核对 JWT 的角色、用户声明与请求体差异，不复述完整 Token、Cookie 或密钥。

## 写入确认

`.select(...)` 是按需的返回与确认机制，不是每次写操作的固定步骤：

- 需要数据库生成的主键/默认值/触发器结果、需要确认预期记录确实受影响，或需要以数据库最终值刷新页面时，返回必要字段并调用 `confirmMutationRows`。
- 只关心请求是否成功且不消费返回记录时，可以不追加 `.select()`；此时 `data === null` 属于正常返回，必须检查 `error`。
- UPDATE/DELETE 可能因过滤条件或 RLS 命中 0 行但不报错。业务若必须区分 0 行，应返回稳定键、取得可靠 count，或改用返回受控结果的 RPC。
- 不要默认 `.select('*')`；只返回校验和页面同步所需字段，避免扩大权限与数据暴露面。

```ts
import { confirmMutationRows } from '@/features/supabase-data-access';

const result = await supabase
  .from('orders')
  .update({ status: nextStatus })
  .eq('id', orderId)
  .select('id,status,updated_at');

const [saved] = confirmMutationRows(result, {
  operation: '更新订单',
  keyOf: row => row.id,
  expectedKeys: [orderId],
});
setOrder(saved);
```

上例需要确认指定订单确实被更新，因此返回 `id` 和页面需要的最终字段。DELETE 也仅在需要确认实际删除键时追加 `.select('id')`。批量操作设置预期键及最大影响行数；范围删除在 UI 展示范围并经用户确认。`confirmMutationRows` 是响应校验，不能阻止已发送的越界写入或回滚结果；写入范围必须由请求过滤条件、RLS 或数据库函数事先约束。

## 写后同步

- 提交逻辑放在已有业务数据层，表单管理输入、提交中和可见错误，阻止重复提交。
- 需要最终字段时使用确认后的返回行；影响列表排序、筛选、总数或聚合时，刷新现有查询／缓存。回读失败应提示“已保存，刷新失败”，只重试回读，不重新写入。
- 未确认写入结果前不显示成功。允许乐观更新的业务须处理失败恢复；本地状态不是数据库成功证据。
- 数据层返回形状变化时，同步适配 Hook/store 和页面，保留现有状态源；旧的查询响应不能覆盖写后新状态。

## 原子更新

客户端读改写会丢并发更新。计数、余额、库存、配额等应写成数据库函数或单条原子 SQL，再通过 `supabase.rpc()` 调用并检查返回值。函数内部同时完成边界校验和更新，必要时锁定目标行。

## 不确定写入

写请求超时或上游 5xx 不代表一定失败。以业务唯一键或请求幂等键独立查询确认；确认前不自动重放。只有设计了真实唯一约束和幂等协议后，才可以安全恢复。

## 约束与错误反馈

- 每次写入都检查结构化 error；需要分类时连同 SDK 响应外层的 HTTP status 传入。接口见 [错误分类](runtime-api.md#3-错误分类)，原始数据库信息用于诊断，页面显示业务文案。
- 唯一键 23505、外键 23503、校验 23514 和 schema 错误应修正数据或模型，不原样重试。upsert 的 onConflict 必须对应真实唯一约束。
- 401 处理身份失效；403／42501 按上文核对所有权及 Policy。0 行但无 error 时先检查请求过滤条件、目标记录及 RLS 可见性，不直接提示保存成功。
- 错误分类中的 read-only 重试标记不适用于写操作；超时和上游错误按“不确定写入”核对结果。

实测范围和时机见 [Skill 验收与交付](../SKILL.md#验收与交付)。
