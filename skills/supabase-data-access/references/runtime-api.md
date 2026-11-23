# 模板接口速查

React/Expo/Taro 使用相同接口，从项目 `@/features/supabase-data-access` 导入。普通接入核对项目实际 `index.ts`、所需导出及目标文件存在后即可按本文调用，无需读取 `dataAccess.ts`；源码读取条件见 [工程入口与源码读取](../SKILL.md#工程入口与源码读取)。本文不代表模板已经落盘。模板不创建 Client，查询回调由业务用平台 Client 构造。

本文是接口契约的唯一集中说明，只在参数、返回值、默认值或限制不明确时查对应章节。查询与完整列表示例见 [查询指南](query.md)，写入确认、RLS 和页面同步见 [写入指南](mutation.md)。

## 1. 分页读取

两种函数共用回调类型 `fetchPage: (range: PageRange) => Promise<ExactPage<T>>`：

| 类型 | 字段 |
| --- | --- |
| `PageRange` | `{ from: number, to: number }`，零基闭区间，可直接传 `.range(from, to)` |
| `ExactPage<T>` | `{ rows: T[], count: number \| null \| undefined }`；count 须为同一筛选下的精确非负整数，null/undefined 在运行时拒绝 |

回调先检查 SDK error，失败则抛出；成功才返回 rows/count。辅助函数不会识别回调里未处理的 SDK error，也不会自动补筛选、排序或重试。

### readPage(fetchPage, options): Promise<PageResult<T>>

普通列表每次只读一页。

| `ReadPageOptions` | 必填／默认 |
| --- | --- |
| `page: number` | 必填，从 1 开始的安全整数 |
| `pageSize?: number` | 默认 20，允许 1–1000 的整数 |

返回 `{ rows, page, pageSize, total, totalPages, hasPrevious, hasNext }`。total 来自 count；空结果 totalPages 为 0。越界页保留传入页码并返回空 rows，不自动回到第一页；hasPrevious 为 `page > 1 && totalPages > 0`，hasNext 为 `page < totalPages`。

参数非法、范围超出安全整数、rows 不是数组、缺少精确计数或返回行数与当前页应有数量不符时抛错；fetchPage 的错误直接向上传递。

### readAllPages(fetchPage, options): Promise<T[]>

导出等需要完整且有界结果时连续读取多页，普通翻页不使用。

| `ReadAllPagesOptions<T>` | 必填／默认 |
| --- | --- |
| `keyOf: (row: T) => string` | 必填，返回非空唯一稳定键；查询排序末尾也应包含唯一键 |
| `pageSize?: number` | 默认 20，允许 1–1000 的整数 |
| `maxRows?: number` | 默认 100000，正安全整数；超过阈值抛错，不截断返回 |

返回完整行数组；无数据返回 `[]`。参数、计数、单页行数、累计行数异常，提前空页、重复／缺失键或读取期间总数变化时抛错。它不提供数据库快照隔离，不能检测所有同总数的数据变化。

## 2. 写入确认

`confirmMutationRows<T>(result: MutationResult<T>, options: MutationConfirmationOptions<T>): T[]`

result 为 `{ data: T[] | null, error?: PostgrestErrorLike | null }`，必须是实际返回行数组；`.single()` 的单对象结果不能直接传入。

| options | 含义 |
| --- | --- |
| `operation: string` | 必填，错误中的业务动作名，如“更新订单” |
| `minRows?: number` | 默认 1，允许非负安全整数；接受 0 行时显式传 0 |
| `maxRows?: number` | 非负安全整数且不小于 minRows；传 expectedKeys 时默认其长度，否则无上限 |
| `expectedKeys?: readonly string[]` | 与实际返回键做无序、无重复的精确集合比对；传空数组时需同时令 minRows 为 0 |
| `keyOf?: (row: T) => string` | 传 expectedKeys 时必填，业务应返回有效稳定键 |

成功返回原行数组。SDK error 转为 `SupabaseDataAccessError`；缺少返回数组、数量越界、配置非法或键集合不符抛普通 Error。函数只校验响应，不发送写请求、不回滚，也不限制已发生的数据库影响范围。

## 3. 错误分类

`classifyPostgrestError(error: PostgrestErrorLike): ClassifiedPostgrestError`

输入 code/message/details/hint 可为 `string | null`，status/statusCode 可为 `number | null`，均可省略；unknown 值先收窄为对象，不能直接传 null。HTTP 状态在 SDK 响应外层时由调用方一并传入。

返回 `{ kind, code?, status?, message, retry }`。message 是原始开发者信息，空值回退为 `Supabase data request failed`；页面按 kind 映射文案。

| 匹配顺序（先匹配者优先） | `DataAccessErrorKind` |
| --- | --- |
| PGRST201 | relationship_ambiguous |
| PGRST116 或 HTTP 406 | row_shape |
| 23505 / 23503 / 23514 | unique_conflict / foreign_key_conflict / check_violation |
| HTTP 401 | authentication |
| 42501 或 HTTP 403 | permission |
| 42P01 / 42703 | schema_mismatch |
| HTTP 429 | rate_limited |
| HTTP 状态 ≥ 500 | upstream_unavailable |
| 其余 | unknown |

只有 rate_limited/upstream_unavailable 的 retry 为 `'read-only'`，其余为 `'never'`；分类不自动重试，不授权重放写入。

`new SupabaseDataAccessError(operation: string, error: PostgrestErrorLike)` 继承 Error，提供 `.classification`，message 为“动作失败：原始信息”。捕获该类时直接读取 classification；分页与本地校验的普通 Error 不带此字段。

## 4. 只读过滤值分批

`planEncodedFilterBatches(values: readonly string[], options?: EncodedFilterBatchOptions): string[][]`

- `maxEncodedBytes?: number` 默认 3500，安全整数且至少 16；按每个值的 `encodeURIComponent(value).length + 4` 估算预算，不代表整个 URL 长度或网关硬限制。
- `maxValues?: number` 默认 100，正安全整数。
- 按首次出现顺序去重并分组，空输入返回 `[]`；配置非法或单值超预算时抛错。

函数只规划值分组，不查询、不转义 PostgREST 表达式、不控制并发。仅用于有限只读补数，查询仍通过 SDK 构造器；大集合和聚合使用服务端查询。

## 5. 旧请求隔离

`createLatestRequestGate(): LatestRequestGate` 不接收参数。一个需要相互替代的请求序列共享 gate；页面销毁或 effect 清理时使票据失效。

| 方法 | 返回与行为 |
| --- | --- |
| `gate.begin()` | 返回 `LatestRequestTicket`，立即使旧票据失效 |
| `gate.invalidate()` | 返回 void，使当前票据失效 |
| `ticket.isCurrent()` | 返回 boolean，只表示票据是否最新 |
| `ticket.commit(run: () => void)` | 最新票据执行回调并返回 true；旧票据不执行并返回 false；回调抛错向上传递 |

成功、错误和结束 loading 的状态提交都应受同一票据保护。它不会取消网络请求、去重或保证请求成功，commit 用于同步状态提交；异步工作完成后再检查／提交。Hook 示例见 [查询指南](query.md#完整列表接线)。

## 导出默认配置

`DEFAULT_DATA_PAGE_SIZE = 20`、`MAX_SUPPORTED_PAGE_SIZE = 1000`、`DEFAULT_MAX_CLIENT_ROWS = 100000`、`DEFAULT_ENCODED_FILTER_BUDGET = 3500`、`DEFAULT_FILTER_VALUES_PER_BATCH = 100`。这些是模板默认策略，不是 Supabase 服务端配置；业务按实际需求传 options。
