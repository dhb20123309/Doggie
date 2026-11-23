/** Portable Supabase/PostgREST data guards. No client, endpoint, schema, or UI is embedded. */

/** 通用列表的默认单页行数，在请求次数和响应体积之间取保守值。 */
export const DEFAULT_DATA_PAGE_SIZE = 20;
/** 单次分页的模板上限；更大的服务端配置也应拆页读取。 */
export const MAX_SUPPORTED_PAGE_SIZE = 1000;
/** 前端完整读取的安全阈值，不代表业务数据最多只能有这些行。超限应缩小筛选或改用 View/RPC 聚合。 */
export const DEFAULT_MAX_CLIENT_ROWS = 100_000;
/** `.in(...)` 值的保守 URL 编码预算，不是 PostgREST 协议声明的绝对上限。 */
export const DEFAULT_ENCODED_FILTER_BUDGET = 3500;
/** 即使单个值很短，每个 `.in(...)` 查询默认也不超过该数量。 */
export const DEFAULT_FILTER_VALUES_PER_BATCH = 100;
/** 防止把无实际容纳能力的极小预算误当作有效配置。 */
const MIN_ENCODED_FILTER_BUDGET = 16;

export interface PostgrestErrorLike {
  /** PostgreSQL SQLSTATE（如 23505）或 PostgREST code（如 PGRST201）。 */
  code?: string | null;
  /** 面向开发者的原始错误文本；展示给用户前应由业务层转换。 */
  message?: string | null;
  /** 数据库或 PostgREST 返回的补充上下文，可能为空，不能用于稳定分支判断。 */
  details?: string | null;
  /** 服务端修复提示，可能为空且不应直接展示给最终用户。 */
  hint?: string | null;
  /** 不同 Client/包装层可能使用 status 或 statusCode，因此同时兼容。 */
  status?: number | null;
  statusCode?: number | null;
}

/** 可被 UI 和日志稳定消费的错误类别；unknown 必须保留原始 message 继续诊断。 */
export type DataAccessErrorKind =
  | 'relationship_ambiguous'
  | 'row_shape'
  | 'unique_conflict'
  | 'foreign_key_conflict'
  | 'check_violation'
  | 'authentication'
  | 'permission'
  | 'schema_mismatch'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'unknown';

export interface ClassifiedPostgrestError {
  /** 供业务层分支处理的稳定类别。 */
  kind: DataAccessErrorKind;
  /** 保留原始结构化 code，便于日志和进一步诊断。 */
  code?: string;
  /** 归一化后的 HTTP 状态码。 */
  status?: number;
  /** 原始开发者错误信息，不是最终 UI 文案。 */
  message: string;
  /** 仅表示只读请求可考虑有界重试；绝不授权自动重放写操作。 */
  retry: 'never' | 'read-only';
}

function errorStatus(error: PostgrestErrorLike): number | undefined {
  const value = error.status ?? error.statusCode;
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

export function classifyPostgrestError(error: PostgrestErrorLike): ClassifiedPostgrestError {
  const code = error.code?.trim() || undefined;
  const status = errorStatus(error);
  const message = error.message?.trim() || 'Supabase data request failed';
  let kind: DataAccessErrorKind = 'unknown';
  let retry: ClassifiedPostgrestError['retry'] = 'never';

  if (code === 'PGRST201') kind = 'relationship_ambiguous';
  else if (code === 'PGRST116' || status === 406) kind = 'row_shape';
  else if (code === '23505') kind = 'unique_conflict';
  else if (code === '23503') kind = 'foreign_key_conflict';
  else if (code === '23514') kind = 'check_violation';
  else if (status === 401) kind = 'authentication';
  else if (code === '42501' || status === 403) kind = 'permission';
  else if (code === '42P01' || code === '42703') kind = 'schema_mismatch';
  else if (status === 429) { kind = 'rate_limited'; retry = 'read-only'; }
  else if (status !== undefined && status >= 500) {
    kind = 'upstream_unavailable';
    retry = 'read-only';
  }

  return { kind, code, status, message, retry };
}

export class SupabaseDataAccessError extends Error {
  readonly classification: ClassifiedPostgrestError;

  constructor(operation: string, error: PostgrestErrorLike) {
    const classification = classifyPostgrestError(error);
    super(`${operation}失败：${classification.message}`);
    this.name = 'SupabaseDataAccessError';
    this.classification = classification;
  }
}

export interface MutationResult<T> {
  /** 调用 confirmMutationRows 前需通过 `.select(...)` 等方式返回实际影响行。 */
  data: T[] | null;
  error?: PostgrestErrorLike | null;
}

export interface MutationConfirmationOptions<T> {
  /** 用于错误信息的业务动作名，例如“更新订单”，不是表名。 */
  operation: string;
  /** 默认至少影响 1 行；确实允许 0 行时必须显式传 0。 */
  minRows?: number;
  /** expectedKeys 存在时默认等于其长度，防止范围条件误伤更多记录。 */
  maxRows?: number;
  /** expectedKeys 存在时必填，返回值必须是稳定且非空的业务键。 */
  keyOf?: (row: T) => string;
  /** 与返回行做无序、无重复的精确集合比对。 */
  expectedKeys?: readonly string[];
}

/** Require returned affected rows; `error: null` with zero rows is not success. */
export function confirmMutationRows<T>(
  result: MutationResult<T>,
  options: MutationConfirmationOptions<T>,
): T[] {
  if (result.error) throw new SupabaseDataAccessError(options.operation, result.error);
  if (!Array.isArray(result.data)) throw new Error(`${options.operation}失败：数据库未返回影响行`);
  const minRows = options.minRows ?? 1;
  const maxRows = options.maxRows ?? options.expectedKeys?.length;
  if (!Number.isSafeInteger(minRows) || minRows < 0
    || (maxRows !== undefined && (!Number.isSafeInteger(maxRows) || maxRows < minRows))) {
    throw new Error('Invalid mutation confirmation limits');
  }
  if (result.data.length < minRows) throw new Error(`${options.operation}失败：实际影响 ${result.data.length} 行`);
  if (maxRows !== undefined && result.data.length > maxRows) {
    throw new Error(`${options.operation}失败：影响范围超过预期`);
  }
  if (options.expectedKeys) {
    if (!options.keyOf) throw new Error('keyOf is required with expectedKeys');
    const expected = new Set(options.expectedKeys);
    const actual = result.data.map(options.keyOf);
    if (expected.size !== options.expectedKeys.length || new Set(actual).size !== actual.length
      || actual.length !== expected.size || actual.some(key => !expected.has(key))) {
      throw new Error(`${options.operation}失败：返回记录与预期键不一致`);
    }
  }
  return result.data;
}

export interface PageRange {
  /** Supabase `.range(from, to)` 使用的零基、闭区间起点。 */
  from: number;
  /** Supabase `.range(from, to)` 使用的闭区间终点。 */
  to: number;
}

export interface ExactPage<T> {
  rows: T[];
  /** 必须来自 `select(..., { count: 'exact' })`；null/undefined 会被拒绝。 */
  count: number | null | undefined;
}

export interface ReadAllPagesOptions<T> {
  /** 唯一稳定键；调用方查询还必须用确定排序，并以该键作为最终 tie-breaker。 */
  keyOf: (row: T) => string;
  /** 1..MAX_SUPPORTED_PAGE_SIZE，默认 DEFAULT_DATA_PAGE_SIZE。 */
  pageSize?: number;
  /** 客户端内存安全阈值；不是数据库总量限制。 */
  maxRows?: number;
}

export interface ReadPageOptions {
  /** 从 1 开始的页面编号。 */
  page: number;
  /** 1..MAX_SUPPORTED_PAGE_SIZE，默认 DEFAULT_DATA_PAGE_SIZE。 */
  pageSize?: number;
}

export interface PageResult<T> {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

/**
 * 读取普通列表的一页，并返回页面导航所需的精确总数和边界状态。
 * 调用方负责组合真实表、筛选和稳定排序；本函数只处理 `.range(from, to)` 的页码换算与返回校验。
 */
export async function readPage<T>(
  fetchPage: (range: PageRange) => Promise<ExactPage<T>>,
  options: ReadPageOptions,
): Promise<PageResult<T>> {
  const page = options.page;
  const pageSize = options.pageSize ?? DEFAULT_DATA_PAGE_SIZE;
  if (!Number.isSafeInteger(page) || page < 1
    || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_SUPPORTED_PAGE_SIZE) {
    throw new Error('Invalid pagination limits');
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to)) {
    throw new Error('Pagination range exceeds safe integer limits');
  }

  const result = await fetchPage({ from, to });
  if (!Array.isArray(result.rows)) throw new Error('Page rows must be an array');
  if (!Number.isSafeInteger(result.count) || (result.count as number) < 0) {
    throw new Error('Exact row count is required');
  }
  if (result.rows.length > pageSize) throw new Error('Page exceeded requested range');

  const total = result.count as number;
  const expectedRows = Math.min(pageSize, Math.max(total - from, 0));
  if (result.rows.length !== expectedRows) {
    throw new Error('Page rows do not match exact count; refresh');
  }
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  return {
    rows: result.rows,
    page,
    pageSize,
    total,
    totalPages,
    hasPrevious: page > 1 && totalPages > 0,
    hasNext: page < totalPages,
  };
}

/**
 * 读取一个有界的完整结果集。
 * 调用方负责服务端稳定排序；本函数能发现重复键和 count 漂移，但不提供数据库快照隔离。
 */
export async function readAllPages<T>(
  fetchPage: (range: PageRange) => Promise<ExactPage<T>>,
  options: ReadAllPagesOptions<T>,
): Promise<T[]> {
  const pageSize = options.pageSize ?? DEFAULT_DATA_PAGE_SIZE;
  const maxRows = options.maxRows ?? DEFAULT_MAX_CLIENT_ROWS;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_SUPPORTED_PAGE_SIZE
    || !Number.isSafeInteger(maxRows) || maxRows < 1) {
    throw new Error('Invalid pagination limits');
  }

  const rows: T[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  do {
    const page = await fetchPage({ from: rows.length, to: rows.length + pageSize - 1 });
    if (!Number.isSafeInteger(page.count) || (page.count as number) < 0) {
      throw new Error('Exact row count is required');
    }
    if (page.rows.length > pageSize) throw new Error('Page exceeded requested range');
    if ((page.count as number) > maxRows) throw new Error('Result exceeds limit; narrow filters or use server aggregation');
    if (total !== undefined && total !== page.count) throw new Error('Dataset changed during pagination; refresh');
    total = page.count as number;
    if (!page.rows.length && rows.length < total) throw new Error('Pagination ended before all rows were read');
    for (const row of page.rows) {
      const key = options.keyOf(row);
      if (!key || seen.has(key)) throw new Error('Pagination returned a missing or duplicate stable key');
      seen.add(key);
      rows.push(row);
    }
    if (rows.length > total) throw new Error('Pagination returned too many rows');
  } while (rows.length < total);
  return rows;
}

export interface EncodedFilterBatchOptions {
  /** 每批 URL 编码后的保守预算；不能据此推断网关的真实硬限制。 */
  maxEncodedBytes?: number;
  /** 每批最多值数，避免大量短值形成过长查询。 */
  maxValues?: number;
}

/**
 * 为少量只读补数拆分 `.in(...)` 值；输入会按首次出现顺序去重。
 * 大集合、聚合和写操作不应使用此函数规避服务端建模，应改用 View/RPC/临时表等方案。
 */
export function planEncodedFilterBatches(
  values: readonly string[],
  options: EncodedFilterBatchOptions = {},
): string[][] {
  const maxEncodedBytes = options.maxEncodedBytes ?? DEFAULT_ENCODED_FILTER_BUDGET;
  const maxValues = options.maxValues ?? DEFAULT_FILTER_VALUES_PER_BATCH;
  if (!Number.isSafeInteger(maxEncodedBytes) || maxEncodedBytes < MIN_ENCODED_FILTER_BUDGET
    || !Number.isSafeInteger(maxValues) || maxValues < 1) {
    throw new Error('Invalid filter batch limits');
  }
  const unique = [...new Set(values)];
  const batches: string[][] = [];
  let batch: string[] = [];
  let bytes = 0;
  for (const value of unique) {
    const size = encodeURIComponent(value).length + 4;
    if (size > maxEncodedBytes) throw new Error('A filter value exceeds the encoded query limit');
    if (batch.length && (batch.length >= maxValues || bytes + size > maxEncodedBytes)) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(value);
    bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export interface LatestRequestTicket {
  /** 只表示该票据仍是最新请求，不代表网络请求已成功。 */
  isCurrent(): boolean;
  /** 仅在票据仍最新时执行状态提交；旧请求返回 false 且不执行回调。 */
  commit(run: () => void): boolean;
}

export interface LatestRequestGate {
  /** 创建新票据，并立即使此前所有票据失效。 */
  begin(): LatestRequestTicket;
  /** 页面卸载或筛选重置时使当前票据失效；不会主动中断底层网络请求。 */
  invalidate(): void;
}

/** 防止较早完成的请求覆盖较新的分页或筛选状态；实际取消仍应配合 AbortSignal。 */
export function createLatestRequestGate(): LatestRequestGate {
  let current = 0;
  return {
    begin() {
      const token = ++current;
      return {
        isCurrent: () => token === current,
        commit(run: () => void) {
          if (token !== current) return false;
          run();
          return true;
        },
      };
    },
    invalidate() { current++; },
  };
}
